import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Opening a brief (James, 2026-11-16): "when I click to open a brief, it's blank and then it just sort of pops in."
 * While the body is on its way the page shows the brief's own head from the inbox list and a skeleton of text
 * lines, never an empty panel.
 */
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown> }));
vi.mock("swr", () => ({ default: (key: string) => ({ data: swr.byKey[key] }), mutate: vi.fn() }));

const { BriefPage } = await import("@/components/briefs");

const file = "2026-11-16T123044Z-weekly-web-analytics-a4a987.md";
const one = `/api/brief?machine=ezio&file=${encodeURIComponent(file)}`;
const listed = {
  machine: "ezio",
  file,
  brief: "Weekly Web Analytics",
  subject: "Weekly Web Analytics - Nov 9 to Nov 15",
  sent_at: "2026-11-16T12:30:44Z",
  read: false,
  archived: false,
};
const draw = () => renderToStaticMarkup(createElement(BriefPage, { machine: "ezio", file }));

describe("a brief while its body loads", () => {
  beforeEach(() => {
    swr.byKey = { "/api/briefs": { at: 0, inbox: [listed], archived: [] } };
  });

  it("draws a skeleton of text lines in the body", () => {
    const html = draw();
    expect(html).toMatch(/class="brief-skel"/);
    expect(html.match(/class="skel/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(html).toMatch(/aria-busy="true"/);
  });

  it("shows the brief's name and date from the inbox list at once", () => {
    const html = draw();
    expect(html).toContain("Weekly Web Analytics");
    expect(html).toContain("ezio · ");
  });

  it("drops the skeleton once the body is here", () => {
    swr.byKey[one] = { brief: { ...listed, body: "# Hello\n\nThe body." } };
    const html = draw();
    expect(html).not.toMatch(/brief-skel/);
    expect(html).toContain("The body.");
  });

  it("shows the error, not a skeleton, when the brief cannot be read", () => {
    swr.byKey[one] = { why: "no such brief" };
    const html = draw();
    expect(html).not.toMatch(/brief-skel/);
    expect(html).toContain("no such brief");
  });
});
