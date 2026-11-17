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
const { transitionName, transitionOut } = await import("@/lib/view-transition");

const src = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const css = src("app/globals.css");
const dashboard = src("components/dashboard.tsx");

const card = (repo: string, number: number, owner = "dividendsolo") => ({
  repo,
  number,
  title: `Card ${number}`,
  url: `https://github.com/${owner}/${repo}/issues/${number}`,
  lane: "needs-info",
  priority: "P2",
  created: "2026-11-01T00:00:00Z",
  type: null,
  checking: false,
});

const rowsOf = (html: string) => html.split("<tr").filter((r) => r.includes("#/card/"));

const nameOf = (row: string) => (row.match(/style="view-transition-name:([^";]+)/) || [])[1] ?? "";

describe("transitionOut", () => {
  beforeEach(() =>
    vi.stubGlobal("CSS", { supports: (p: string, v: string) => `${p}:${v}` === "view-transition-group:contain" }),
  );
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

  it("takes the change without a transition when the browser cannot keep the rows inside their panel", () => {
    const order: string[] = [];
    vi.stubGlobal("CSS", { supports: () => false });
    vi.stubGlobal("document", { startViewTransition: () => order.push("start") });
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
    expect(names).toEqual([
      "wait-dividendsolo_2fcollector-162",
      "wait-dividendsolo_2fcollector-163",
      "wait-dividendsolo_2fsituation-965",
    ]);
  });

  it("gets a name of its own when another owner has a repo of the same name and a card of the same number", () => {
    page.board.tickets.tickets = [card("dotfiles", 12, "a"), card("dotfiles", 12, "b")];
    const names = rowsOf(renderToStaticMarkup(createElement(Waiting))).map(nameOf);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("gets a valid name when the repo name holds characters a CSS name cannot", () => {
    const names = [
      transitionName("wait", "a/my.repo", 1),
      transitionName("wait", "a/my-repo", 1),
      transitionName("wait", "a/my_repo", 1),
    ];
    for (const n of names) expect(n).toMatch(/^[A-Za-z_-][A-Za-z0-9_-]*$/);
    expect(new Set(names).size).toBe(3);
  });

  it("leaves through that transition rather than disappearing in one frame", () => {
    expect(dashboard).toMatch(/done=\{\(\) => transitionOut\(\(\) => setGone\(/);
  });
});

describe("the view transition a row leaves through", () => {
  it("stays inside the Waiting on you scroll box, under its column heads", () => {
    const box = css.slice(css.indexOf("#waiting-panel .wrap.scroll {"));
    expect(box.slice(0, box.indexOf("}"))).toMatch(
      /view-transition-name: waiting-rows;\s*view-transition-group: contain;/,
    );
    expect(css).toMatch(/#waiting-panel thead \{\s*view-transition-name: waiting-head;/);
    expect(css).toMatch(/::view-transition-group\(waiting-rows\) \{\s*overflow: clip;/);
    expect(css).toMatch(/::view-transition-group\(waiting-head\) \{\s*z-index: 1;/);
  });

  it("keeps the column heads above the scrolled rows at rest, though every row and the head is its own stacking context", () => {
    const head = css.slice(css.indexOf("#waiting-panel thead {"));
    const r = head.slice(0, head.indexOf("}"));
    expect(r).toMatch(/position: relative;/);
    const z = Number((r.match(/z-index: (\d+);/) || [])[1] ?? 0);
    expect(z).toBeGreaterThan(0);
  });

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
