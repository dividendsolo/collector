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

  it("never gives a row's first cell the global .mark box, and dots only the unread row", () => {
    const html = draw();
    expect(html).not.toMatch(/class="mark"/);
    expect(html.match(/class="dot"/g)).toHaveLength(1);
  });

  it("draws the Archived rows in the Inbox's own table, under one full-width Archived row", () => {
    const html = draw();
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toMatch(/<td colSpan="4" class="section-head">Archived<\/td>/);
    expect(html.indexOf("Archived<")).toBeLessThan(html.indexOf("Subject c.md"));
  });

  it("marks each row unread or read, so the weight follows the class", () => {
    const html = draw();
    expect(html.match(/<tr class="unread">/g)).toHaveLength(1);
    expect(html.match(/<tr class="read">/g)).toHaveLength(3);
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
