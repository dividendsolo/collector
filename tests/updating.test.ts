import { beforeEach, describe, expect, it } from "vitest";
import { downText, markUpdating, UPDATE_GRACE_MS, updating } from "@/lib/updating";

/**
 * James, 2026-11-06, a screenshot of the top bar during an update: "Could not reach the Collector server: Failed to
 * fetch". The update restarts the server on purpose, so a failed read in that window is the restart, not a fault.
 */
const store = new Map<string, string>();
(globalThis as any).sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => store.clear());

describe("a failed read while an update restarts the server", () => {
  it("says the server is restarting, never that it could not be reached", () => {
    markUpdating(1_000);
    const text = downText(new Error("Failed to fetch"), 5_000);
    expect(text).not.toMatch(/Could not reach|Failed to fetch/);
    expect(text).toMatch(/Restarting/);
  });
  it("is still the restart after the page reloaded in the middle of it", () => {
    markUpdating(1_000);
    expect(updating(1_000 + UPDATE_GRACE_MS - 1)).toBe(true);
  });
  it("is a real outage again once the restart has had its time", () => {
    markUpdating(1_000);
    expect(downText(new Error("Failed to fetch"), 1_000 + UPDATE_GRACE_MS + 1)).toBe(
      "Could not reach the Collector server: Failed to fetch",
    );
  });
  it("is a real outage with no update under way", () => {
    expect(downText(new Error("Failed to fetch"), 5_000)).toBe("Could not reach the Collector server: Failed to fetch");
  });
});
