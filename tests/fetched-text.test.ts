import { describe, expect, it } from "vitest";
import { fetchedText } from "@/lib/format";

describe("fetchedText", () => {
  it("says the read's own time, in the viewer's local time, as the top bar does", () => {
    const at = Date.UTC(2026, 10, 11, 20, 4, 5) / 1000;
    expect(fetchedText(at)).toBe(`Fetched ${new Date(at * 1000).toLocaleTimeString()}`);
  });

  it("says nothing before the first read", () => {
    expect(fetchedText(undefined)).toBe("");
    expect(fetchedText(0)).toBe("");
  });
});
