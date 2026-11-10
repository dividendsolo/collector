import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Brief } from "@/lib/briefs";

/**
 * The Briefs page as drawn (collector#64, the PR #81 review): the rows carry no global `.mark` box, Archived shares
 * the Inbox's columns, unread is told from read by its class, and a click updates the sidebar's count on the spot.
 */
const swr = vi.hoisted(() => ({ mutate: vi.fn(), data: undefined as unknown }));
vi.mock("swr", () => ({ default: () => ({ data: swr.data }), mutate: swr.mutate }));

const { BriefsPage, postBrief } = await import("@/components/briefs");

const brief = (file: string, read: boolean, archived = false): Brief =>
  ({ machine: "ezio", file, brief: file, subject: `Subject ${file}`, sent_at: null, read, archived }) as Brief;

const draw = () => renderToStaticMarkup(createElement(BriefsPage));

describe("the Briefs page as drawn (collector#64)", () => {
  beforeEach(() => {
    swr.data = {
      at: 0,
      inbox: [brief("a.md", false), brief("b.md", true)],
      archived: [brief("c.md", true, true), brief("d.md", true, true)],
    };
  });

  it("draws no dot and no .mark box on any row; bold alone tells unread (James, 2026-11-10)", () => {
    const html = draw();
    expect(html).not.toMatch(/class="mark"/);
    expect(html).not.toMatch(/class="dot"/);
    expect(html).not.toMatch(/unread-dot/);
  });

  it("draws the Archived rows in the Inbox's own table, under one full-width Archived row", () => {
    const html = draw();
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toMatch(/<td colSpan="3" class="section-head">Archived<\/td>/);
    expect(html.indexOf("Archived<")).toBeLessThan(html.indexOf("Subject c.md"));
  });

  it("marks each row unread or read, so the weight follows the class", () => {
    const html = draw();
    expect(html.match(/<tr class="row unread">/g)).toHaveLength(1);
    expect(html.match(/<tr class="row read">/g)).toHaveLength(3);
  });
});

describe("a click on a brief (collector#64)", () => {
  beforeEach(() => swr.mutate.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("hands the POST's answer to the shared /api/briefs read, so the sidebar count changes at once", async () => {
    const view = { at: 1, inbox: [], archived: [brief("a.md", true, true)] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(view), { status: 200 })),
    );
    const r = await postBrief("ezio", "a.md", { archived: true });
    expect(r.ok).toBe(true);
    expect(swr.mutate).toHaveBeenCalledWith("/api/briefs", view, { revalidate: false });
  });

  it("leaves the shared read alone when the write is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ why: "no" }), { status: 409 })),
    );
    const r = await postBrief("ezio", "a.md", { archived: true });
    expect(r).toEqual({ ok: false, why: "no" });
    expect(swr.mutate).not.toHaveBeenCalled();
  });
});

describe("a Briefs row opens its brief on a click anywhere in the row (James, 2026-11-10)", () => {
  it("uses the shared clickable-row class, like Cron Jobs and Projects", async () => {
    swr.data = { at: 0, inbox: [brief("a.md", false), brief("b.md", true)], archived: [] };
    const html = draw();
    expect(html.match(/<tr class="row (unread|read)"/g)).toHaveLength(2);
  });

  it("sets the hash to the brief's own page when the row is clicked", async () => {
    const { BriefRow } = await import("@/components/briefs");
    const loc = { hash: "" };
    vi.stubGlobal("location", loc);
    const row = BriefRow({ b: brief("a.md", false) }) as { props: { onClick: (e: unknown) => void } };
    row.props.onClick({ target: { closest: () => null } });
    expect(loc.hash).toBe("#/briefs/ezio/a.md");
    vi.unstubAllGlobals();
  });
});

describe("Briefs text is 16px at least (James, 2026-11-10)", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf("/* Briefs (collector#64)"), css.indexOf("/* Outside the layers on purpose"));

  it("sets no font size under 16px anywhere in the Briefs styles", () => {
    const sizes = [...block.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.filter((n) => n < 16)).toEqual([]);
  });

  it("lifts the shared 12px table heads and dates to 16px inside a Briefs panel", () => {
    expect(block).toMatch(/\.briefs-panel th[\s\S]*?\.briefs-panel \.mono[\s\S]*?font-size:\s*16px/);
  });

  it("lifts the panel head's title and the inbox count badge too (the browser measured 13px and 11px)", () => {
    const rule = block.slice(block.indexOf(".briefs-panel,"), block.indexOf("}", block.indexOf(".briefs-panel,")));
    expect(rule).toMatch(/\.briefs-panel h2/);
    expect(rule).toMatch(/\.briefs-panel \.count/);
  });

  it("puts the Inbox panel under .briefs-panel", () => {
    swr.data = { at: 0, inbox: [brief("a.md", false)], archived: [] };
    expect(draw()).toMatch(/<section class="panel briefs-panel">/);
  });
});

describe("the brief page's way back to the Inbox (James, 2026-11-10)", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf("/* Briefs (collector#64)"), css.indexOf("/* Outside the layers on purpose"));

  it("draws Inbox with a back arrow, as a button-shaped link", async () => {
    const { BriefPage } = await import("@/components/briefs");
    swr.data = { brief: brief("a.md", true), markdown: "# Hi" };
    const html = renderToStaticMarkup(createElement(BriefPage, { machine: "ezio", file: "a.md" }));
    expect(html).toMatch(
      /<a class="btn ghost back" href="#\/briefs"><svg[^>]*><use href="#i-back"><\/use><\/svg>Inbox<\/a>/,
    );
  });

  it("never underlines it, and centers its arrow and word on the Archive button's line", () => {
    const rule = block.slice(
      block.indexOf(".briefs-panel a.back"),
      block.indexOf("}", block.indexOf(".briefs-panel a.back")),
    );
    expect(rule).toMatch(/text-decoration:\s*none/);
    expect(rule).toMatch(/display:\s*inline-flex/);
    expect(rule).toMatch(/align-items:\s*center/);
  });

  it("has a back arrow in the icon sprite", () => {
    const ui = readFileSync(path.join(process.cwd(), "components", "ui.tsx"), "utf8");
    expect(ui).toMatch(/\| "back"/);
    expect(ui).toMatch(/<symbol id="i-back"/);
  });
});

describe("Briefs says its name once, in the top bar (James, 2026-11-10)", () => {
  beforeEach(() => {
    swr.data = { at: 0, inbox: [brief("a.md", false)], archived: [] };
  });

  it("draws no page title block", () => {
    const html = draw();
    expect(html).not.toMatch(/class="page-head"/);
    expect(html).not.toMatch(/<h1/);
  });

  it("gives its one panel no title, only the count", () => {
    const html = draw();
    expect(html).not.toMatch(/<h2/);
    expect(html).toMatch(/in the inbox/);
  });

  it("heads the name column From, not Brief", () => {
    const html = draw();
    expect(html).toMatch(/<th>From<\/th>/);
    expect(html).not.toMatch(/<th>Brief<\/th>/);
  });
});

describe("the Briefs dot on the closed sidebar (James, 2026-11-10)", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

  it("gives the Briefs tag the inbox count and a dot while the inbox has a brief", async () => {
    const { briefsTag, tagClass } = await import("@/components/app");
    expect(briefsTag(3)).toEqual({ text: "3", hot: false, dot: true });
    expect(tagClass(briefsTag(3))).toBe("tag inbox-dot");
  });

  it("draws no dot and no number when the inbox is empty", async () => {
    const { briefsTag, tagClass } = await import("@/components/app");
    expect(briefsTag(0)).toEqual({ text: "", hot: false, dot: false });
    expect(tagClass(briefsTag(0))).toBe("tag");
  });

  it("draws the dot on the icon while the sidebar is closed, like the red one", () => {
    expect(css).toMatch(/\.rail a\.item:has\(\.tag\.inbox-dot\)::after/);
  });
});
