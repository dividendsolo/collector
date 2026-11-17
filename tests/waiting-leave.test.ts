import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => ({ board: null as any }));
vi.mock("@/components/data", async () => {
  const actual = await vi.importActual<typeof import("@/components/data")>("@/components/data");
  return {
    ...actual,
    useLive: () => ({ state: null, updated: "", liveClass: "live", tick: () => {}, board: page.board }),
    useApi: () => ({ data: undefined, mutate: async () => {} }),
  };
});

const { Waiting } = await import("@/components/dashboard");
const { transitionOut } = await import("@/lib/view-transition");

const src = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = src("app/globals.css");
const dashboard = src("components/dashboard.tsx");

const card = (repo: string, number: number) => ({
  repo,
  number,
  title: `Card ${number}`,
  url: `https://github.com/dividendsolo/${repo}/issues/${number}`,
  lane: "needs-info",
  priority: "P2",
  created: "2026-11-01T00:00:00Z",
  type: null,
  checking: false,
});

const rowsOf = (html: string) => html.split("<tr").filter((r) => r.includes("#/card/"));

const nameOf = (row: string) => (row.match(/style="view-transition-name:([^";]+)/) || [])[1] ?? "";

describe("transitionOut", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("changes the state inside the browser's own transition callback", () => {
    const order: string[] = [];
    vi.stubGlobal("document", {
      startViewTransition: (update: () => void) => {
        order.push("start");
        update();
        order.push("end");
        return {};
      },
    });
    transitionOut(() => order.push("update"));
    expect(order).toEqual(["start", "update", "end"]);
  });

  it("takes the change when the browser has no view transitions", () => {
    const order: string[] = [];
    vi.stubGlobal("document", {});
    transitionOut(() => order.push("update"));
    expect(order).toEqual(["update"]);
  });
});

describe("a Waiting on you row", () => {
  beforeEach(() => {
    page.board = {
      tickets: {
        loaded: true,
        each: ["needs-info"],
        working: [],
        done: [],
        count: [],
        tickets: [card("collector", 162), card("collector", 163), card("situation", 965)],
      },
      work: null,
    };
  });

  it("carries a transition name of its own, so the browser pairs it with where it moves to", () => {
    const names = rowsOf(renderToStaticMarkup(createElement(Waiting))).map(nameOf);
    expect(names).toEqual(["wait-collector-162", "wait-collector-163", "wait-situation-965"]);
  });

  it("leaves through that transition rather than disappearing in one frame", () => {
    expect(dashboard).toMatch(/done=\{\(\) => transitionOut\(\(\) => setGone\(/);
  });
});

describe("the view transition a row leaves through", () => {
  it("runs at 200ms on the page's own ease-out curve", () => {
    const r = css.slice(css.indexOf("::view-transition-group(*)"));
    expect(r).toMatch(/animation-duration: 200ms/);
    expect(r).toMatch(/animation-timing-function: var\(--ease-out\)/);
    expect(css).toMatch(/--ease-out: cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  });

  it("leaves the root crossfade off, so only the rows that moved change", () => {
    const r = css.slice(css.indexOf("::view-transition-old(root)"));
    expect(r.slice(0, r.indexOf("}"))).toContain("::view-transition-new(root)");
    expect(r).toMatch(/animation: none/);
  });

  it("keeps the fade and drops the movement when motion is reduced", () => {
    const vt = css.slice(css.indexOf("::view-transition-group(*)"));
    const reduce = vt.slice(vt.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduce).toMatch(/::view-transition-group\(\*\) \{\s*animation: none;/);
    expect(reduce).toMatch(
      /::view-transition-old\(\*\),\s*::view-transition-new\(\*\) \{\s*animation-duration: 200ms;/,
    );
  });
});
