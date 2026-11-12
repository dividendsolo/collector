import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiPlan } from "@/components/ai";
import { nousNote } from "@/lib/server/ai";

// James, 2026-11-12: the Nous row showed "Balance —" while the Nous login was broken ("Invalid refresh
// token"), so a signed-out provider looked like a missing number. A provider that could not be read
// says why, and how to fix it.
describe("an AI provider that could not be read", () => {
  const nous = { provider: "nous", profiles: 31, kind: "usage", note: "Nous signed out. Run: hermes auth add nous" };

  it("shows the note, not an empty balance", () => {
    const html = renderToStaticMarkup(createElement(AiPlan, { a: nous }));
    expect(html).toContain("Nous signed out. Run: hermes auth add nous");
    expect(html).not.toContain("—");
  });
});

describe("nousNote", () => {
  it("tells James to sign in again when the portal says logged out", () => {
    expect(nousNote({ logged_in: false }, null)).toBe("Nous signed out. Run: hermes auth add nous");
  });

  it("names the error when the portal could not be read at all", () => {
    expect(nousNote(null, "timed out")).toBe("Could not read the Nous portal: timed out");
  });
});
