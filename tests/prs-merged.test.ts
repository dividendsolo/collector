import { describe, expect, it } from "vitest";
import { searchQuery } from "@/lib/server/workstats";

describe("the Work panel's searches", () => {
  it("count merged PRs across every owner since a day", () => {
    expect(searchQuery("merged", "2026-11-11T00:00:00-05:00", ["dividendsolo", "jamesg"])).toBe(
      "is:pr is:merged merged:>=2026-11-11T00:00:00-05:00 user:dividendsolo user:jamesg",
    );
  });
  it("count cards closed as done, as before", () => {
    expect(searchQuery("closed", "2026-10-12", ["dividendsolo"])).toBe(
      "is:issue is:closed reason:completed closed:>=2026-10-12 user:dividendsolo",
    );
  });
});
