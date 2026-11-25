import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiPlan } from "@/components/ai";
import { minimaxReading, nousNote } from "@/lib/server/ai";

describe("an AI provider that could not be read", () => {
  const nous = { provider: "nous", profiles: 31, kind: "usage", note: "Nous signed out. Run: hermes auth add nous" };

  it("shows the note, not an empty balance", () => {
    const html = renderToStaticMarkup(createElement(AiPlan, { a: nous }));
    expect(html).toContain("Nous signed out. Run: hermes auth add nous");
    expect(html).not.toContain("—");
  });
});

describe("a MiniMax plan that lapsed", () => {
  const lapsed = { base_resp: { status_code: 2062, status_msg: "no active token plan subscription" } };

  it("says the coding plan is not active, in the provider's own words, instead of no plan", () => {
    expect(minimaxReading(lapsed).note).toBe("No active MiniMax Coding Plan");
  });

  it("marks the row out, so every plan out is what the panel counts", () => {
    expect(minimaxReading(lapsed).out).toBe(true);
  });

  it("shows the note rather than an empty balance on the row", () => {
    const a = { provider: "minimax", profiles: 59, kind: "plan", ...minimaxReading(lapsed) };
    const html = renderToStaticMarkup(createElement(AiPlan, { a }));
    expect(html).toContain("No active MiniMax Coding Plan");
    expect(html).not.toContain("MiniMax returned no plan");
  });

  it("keeps the provider's own reason for a code it does not know", () => {
    expect(minimaxReading({ base_resp: { status_code: 1004, status_msg: "invalid api key" } }).note).toBe(
      "invalid api key",
    );
  });

  it("still reads a working plan, with no out flag", () => {
    const working = minimaxReading({
      base_resp: { status_code: 0, status_msg: "success" },
      model_remains: [
        { model_name: "general", current_interval_remaining_percent: 80, current_weekly_remaining_percent: 60 },
      ],
    });
    expect(working.left).toBe("80%");
    expect(working.out).toBe(false);
    expect(working.plan).toBe("Coding plan");
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
