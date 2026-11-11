import { describe, expect, it } from "vitest";
import { searchQuery } from "@/lib/server/workstats";

/**
 * James, 2026-11-11: "in the work panel, we want to get another card in there for PRs merged. I want to see that for
 * today and also for merged in the last 30 days." The same GitHub search the closed-cards numbers use, for merged PRs.
 */
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
