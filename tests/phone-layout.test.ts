import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SideProvider } from "@/components/side";

const page = vi.hoisted(() => ({ state: null as any, board: null as any }));

vi.mock("@/components/data", async () => {
  const actual = await vi.importActual<typeof import("@/components/data")>("@/components/data");
  return {
    ...actual,
    useLive: () => ({ state: page.state, updated: "", liveClass: "live", tick: () => {}, board: page.board }),
    useApi: () => ({ data: undefined, mutate: async () => {} }),
  };
});

const { Dashboard } = await import("@/components/dashboard");

const card = (repo: string, number: number, lane: string) => ({
  repo,
  number,
  title: `Card ${number}`,
  url: `https://github.com/dividendsolo/${repo}/issues/${number}`,
  lane,
  priority: "P2",
  created: "2026-11-01T00:00:00Z",
  type: null,
  checking: false,
});

const fixture = () => {
  page.state = {
    at: 0,
    machines: [],
    warnings: [
      {
        level: "error",
        text: "Hermes gateway is down on altair",
        action: { label: "Start Hermes", post: "/api/hermes" },
        since: 1,
      },
      {
        level: "error",
        text: "Tailscale is stopped on altair",
        action: { label: "Start Tailscale", post: "/api/tailscale" },
        since: 1,
      },
      { level: "warn", text: "The nightly backup failed", debug: { machine: "ezio", id: "abc" }, since: 1 },
      { level: "warn", text: "A plan runs low", ack: { key: "plan|nous", next: null }, since: 1 },
    ],
    github: {},
  };
  page.board = {
    tickets: {
      loaded: true,
      each: ["needs-info", "needs-triage"],
      working: [],
      done: [],
      count: [],
      tickets: [card("collector", 162, "needs-info"), card("collector", 163, "needs-triage")],
    },
    work: null,
  };
};

const draw = (side: "mac" | "phone"): string => {
  fixture();
  return renderToStaticMarkup(createElement(SideProvider, { side }, createElement(Dashboard)));
};

const MAC_ONLY_TEXT = ["Start Hermes", "Start Tailscale", "Debug and fix", "release-btn"];

describe("the Dashboard on a phone", () => {
  it("draws every Mac-only action on the Mac", () => {
    const html = draw("mac");
    for (const text of MAC_ONLY_TEXT) expect(html, text).toContain(text);
    expect(html).toMatch(/aria-label="Triage /);
  });

  it("draws none of them on a phone request", () => {
    const html = draw("phone");
    for (const text of MAC_ONLY_TEXT) expect(html, text).not.toContain(text);
    expect(html).not.toMatch(/aria-label="Triage /);
    expect(html).not.toContain("Close");
  });

  it("still lets an alert be acknowledged, and the card's lane stay readable", () => {
    const html = draw("phone");
    expect(html).toContain("Acknowledge");
    expect(html).toContain("needs-info");
    expect(html).toContain("needs-triage");
  });

  it("shows Priority tasks, then Current work, then Briefs", () => {
    const html = draw("phone");
    const at = (id: string) => html.indexOf(id);
    expect(at('id="attention"')).toBeGreaterThan(-1);
    expect(at('id="current-work"')).toBeGreaterThan(-1);
    expect(at('id="briefs-panel"')).toBeGreaterThan(-1);
    expect(at('id="attention"')).toBeLessThan(at('id="current-work"'));
    expect(at('id="current-work"')).toBeLessThan(at('id="briefs-panel"'));
  });

  it("keeps the Briefs panel off the Mac dashboard", () => {
    expect(draw("mac")).not.toContain('id="briefs-panel"');
  });
});

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("the page at 412px (a Pixel 8 Pro)", () => {
  it("is one column at that width: the paired panels only split from 900px", () => {
    expect(rule(".pair")).toMatch(/display:\s*grid/);
    const split = css.slice(css.indexOf("@media (min-width: 900px)"));
    expect(split.slice(0, split.indexOf("}"))).toContain(".pair");
  });

  it("lets its panels shrink, so nothing pushes the page sideways", () => {
    expect(rule(".content")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/\.page > \*,\s*\.pair > \* \{\s*min-width: 0;/);
  });

  it("scrolls a wide table inside its own panel rather than the page", () => {
    expect(rule(".wrap")).toMatch(/overflow-x:\s*auto/);
  });
});
