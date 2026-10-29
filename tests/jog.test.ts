import { describe, expect, it } from "vitest";
import { jogError, missingEnv, monthStart, monthUsage, resetAt, sizeWeight } from "@/lib/server/jog";

describe("sizeWeight", () => {
  it("counts a 2 vCPU machine minute as one free minute and each bigger size at its multiple", () => {
    expect(sizeWeight("jog")).toBe(1);
    expect(sizeWeight("jog-2vcpu")).toBe(1);
    expect(sizeWeight("jog-4vcpu")).toBe(2);
    expect(sizeWeight("jog-8vcpu")).toBe(4);
    expect(sizeWeight("jog-16vcpu")).toBe(8);
    expect(sizeWeight("jog-32vcpu")).toBe(16);
  });
  it("counts a label it does not know as the smallest size, never as nothing", () => {
    expect(sizeWeight(undefined)).toBe(1);
    expect(sizeWeight("")).toBe(1);
    expect(sizeWeight("ubuntu-latest")).toBe(1);
  });
});

describe("monthUsage", () => {
  const now = Date.UTC(2026, 10, 15, 12) / 1000; // 2026-11-15T12:00Z
  const run = (at: string, size: string, seconds: number, cost: number) => ({ at, size, seconds, cost });

  it("sums each run's seconds at its size's weight, and the dollars Jog charged, newest first over pages", () => {
    const pageOne = [
      run("2026-11-14T10:00:00Z", "jog", 600, 500_000),
      run("2026-11-13T10:00:00Z", "jog-4vcpu", 300, 250_000),
    ];
    const pageTwo = [run("2026-11-02T10:00:00Z", "jog-8vcpu", 120, 0)];
    // 10 minutes at 1x + 5 at 2x + 2 at 4x = 28 free minutes; $0.50 + $0.25 = $0.75 charged.
    expect(monthUsage([pageOne, pageTwo], now)).toEqual({ used: 28, spent: 0.75, runs: 3 });
  });
  it("leaves out a run from last month, and a run with no time Jog can read", () => {
    const runs = [
      run("2026-10-31T23:00:00Z", "jog", 6000, 900_000),
      run("", "jog", 600, 900_000),
      run("2026-12-01T00:00:00Z", "jog", 60, 0),
      run("2026-11-01T00:00:00Z", "jog", 60, 1_000),
    ];
    expect(monthUsage([runs], now)).toEqual({ used: 2, spent: 0, runs: 2 });
  });
  it("is zero for no runs at all", () => {
    expect(monthUsage([], now)).toEqual({ used: 0, spent: 0, runs: 0 });
  });
});

describe("the month's start and the free minutes' reset", () => {
  it("starts the month at the first, UTC, and resets at the first of the next", () => {
    const at = Date.UTC(2026, 10, 15, 12) / 1000;
    expect(new Date(monthStart(at) * 1000).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(resetAt(at) * 1000).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("rolls the year over in December", () => {
    const at = Date.UTC(2026, 11, 31, 23) / 1000;
    expect(new Date(resetAt(at) * 1000).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("missingEnv", () => {
  const token = "jog_pat_0000000000000000000000000000000000000000000000000000000000000000000000000abc";
  it("is null when both .env lines are set", () => {
    expect(missingEnv(token, "dividendsolo")).toBeNull();
  });
  it("names the missing line and where a token comes from, for the page's 'Could not read' line", () => {
    expect(missingEnv("", "")).toContain("JOG_TOKEN");
    expect(missingEnv("", "")).toContain("JOG_ACCOUNT");
    expect(missingEnv("", "")).toContain("usejog.com/account/-/tokens");
    expect(missingEnv("", "dividendsolo")).toContain("usejog.com/account/-/tokens");
    expect(missingEnv("", "dividendsolo")).not.toContain("JOG_ACCOUNT");
    expect(missingEnv(token, "")).toContain("JOG_ACCOUNT");
  });
});

describe("jogError", () => {
  it("gives Jog's own reason for a key that ended, a token off its account, and an account it cannot see", () => {
    expect(jogError(401)).toContain("usejog.com/account/-/tokens");
    expect(jogError(403)).toContain("owners");
    expect(jogError(404)).toContain("JOG_ACCOUNT");
  });
  it("says a status it has no words for", () => {
    expect(jogError(503)).toContain("busy");
    expect(jogError(500)).toBe("Jog answered 500");
  });
});
