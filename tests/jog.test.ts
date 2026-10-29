import { describe, expect, it } from "vitest";
import {
  accountsThatAnswer,
  jogError,
  loginCandidates,
  missingToken,
  monthStart,
  monthUsage,
  resetAt,
  sizeWeight,
} from "@/lib/server/jog";

describe("sizeWeight", () => {
  it("counts a 2 vCPU machine minute as one free minute and each bigger size at its multiple", () => {
    expect(sizeWeight("jog")).toBe(1);
    expect(sizeWeight("jog-2vcpu")).toBe(1);
    expect(sizeWeight("jog-4vcpu")).toBe(2);
    expect(sizeWeight("jog-8vcpu")).toBe(4);
    expect(sizeWeight("jog-16vcpu")).toBe(8);
    expect(sizeWeight("jog-32vcpu")).toBe(16);
  });
  it("counts a Jog Max minute at twice its size's free minutes", () => {
    expect(sizeWeight("jog-max")).toBe(2);
    expect(sizeWeight("jog-max-2vcpu")).toBe(2);
    expect(sizeWeight("jog-max-4vcpu")).toBe(4);
    expect(sizeWeight("jog-max-8vcpu")).toBe(8);
    expect(sizeWeight("jog-max-16vcpu")).toBe(16);
    expect(sizeWeight("jog-max-32vcpu")).toBe(32);
  });
  it("counts a label it does not know as the smallest size, never as nothing", () => {
    expect(sizeWeight(undefined)).toBe(1);
    expect(sizeWeight("")).toBe(1);
    expect(sizeWeight("ubuntu-latest")).toBe(1);
    expect(sizeWeight("jog-maxx")).toBe(1);
  });
});

describe("monthUsage", () => {
  const now = Date.UTC(2026, 10, 15, 12) / 1000; // 2026-11-15T12:00Z
  const run = (at: string, size: string, seconds: number, cost = 0) => ({ at, size, seconds, cost });

  it("sums each run's seconds at its size's weight, newest first over pages", () => {
    const pageOne = [run("2026-11-14T10:00:00Z", "jog", 600), run("2026-11-13T10:00:00Z", "jog-4vcpu", 300)];
    const pageTwo = [run("2026-11-02T10:00:00Z", "jog-8vcpu", 120)];
    // 10 minutes at 1x + 5 at 2x + 2 at 4x = 28 free minutes.
    expect(monthUsage([pageOne, pageTwo], now)).toEqual({ used: 28, runs: 3 });
  });
  it("burns a Jog Max run's minutes at twice its size's weight", () => {
    expect(monthUsage([[run("2026-11-14T10:00:00Z", "jog-max-8vcpu", 600)]], now)).toEqual({ used: 80, runs: 1 });
  });
  it("counts the first second of the month, and leaves out last month's run and one with no time Jog can read", () => {
    const runs = [
      run("2026-10-31T23:59:59Z", "jog", 6000),
      run("", "jog", 600),
      run("2026-11-01T00:00:00Z", "jog", 60),
      run("2026-11-10T00:00:00Z", "jog-4vcpu", 60),
    ];
    expect(monthUsage([runs], now)).toEqual({ used: 3, runs: 2 }); // 1 minute at 1x + 1 at 2x
  });
  it("is zero for no runs at all", () => {
    expect(monthUsage([], now)).toEqual({ used: 0, runs: 0 });
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

describe("missingToken", () => {
  it("is null when the .env line is set", () => {
    expect(missingToken("jog_pat_0000")).toBeNull();
  });
  it("names the missing line and where a token comes from, for the page's 'Could not read' line", () => {
    expect(missingToken("")).toContain("JOG_TOKEN");
    expect(missingToken("")).toContain("usejog.com/account/-/tokens");
    // The account is found through the API since 2026-10-29: .env names no account, so nothing asks for one.
    expect(missingToken("")).not.toContain("JOG_ACCOUNT");
  });
});

describe("loginCandidates", () => {
  it("asks JOG_ACCOUNT first, then the logins Collector can name", () => {
    expect(loginCandidates("", ["dividendsolo", "JEG-Solutions-LLC"])).toEqual(["dividendsolo", "JEG-Solutions-LLC"]);
    expect(loginCandidates("dividend-solo", ["dividendsolo", null])).toEqual(["dividend-solo", "dividendsolo"]);
  });
  it("drops repeats (whatever their case), blanks, and a login Jog's account names cannot hold", () => {
    expect(loginCandidates("", ["Dividendsolo", "dividendsolo", "", null, undefined])).toEqual(["Dividendsolo"]);
    expect(loginCandidates("", ["je/g-solutions", "a b", "JEG_Solutions"])).toEqual([]);
  });
});

describe("accountsThatAnswer", () => {
  const status = (e: unknown) => (e as { code?: number })?.code ?? null;
  const codes = (map: Record<string, number>) => (login: string) => {
    const code = map[login] ?? 200;
    return code === 200 ? Promise.resolve({ window: { end: "2026-10-29T12:00:00Z" } }) : Promise.reject({ code });
  };

  it("keeps the accounts that answer, in the order they were asked", async () => {
    const { accounts, error } = await accountsThatAnswer(
      ["dividendsolo", "JEG-Solutions-LLC", "dividend-solo"],
      codes({ "JEG-Solutions-LLC": 404, "dividend-solo": 404 }),
      status,
    );
    expect(accounts.map((a) => a.login)).toEqual(["dividendsolo"]);
    expect(accounts[0].advice.window.end).toBe("2026-10-29T12:00:00Z");
    expect(error).toBeNull();
  });
  it("reads every account a token reaches, not just the first", async () => {
    const { accounts, error } = await accountsThatAnswer(["dividendsolo", "jeg-llc"], codes({}), status);
    expect(accounts).toHaveLength(2);
    expect(error).toBeNull();
  });
  it("ends the read on a token that has ended, and names where to make a new one", async () => {
    const { accounts, error } = await accountsThatAnswer(
      ["dividendsolo", "jeg-llc"],
      codes({ "jeg-llc": 401 }),
      status,
    );
    expect(accounts).toEqual([]);
    expect(error).toContain("usejog.com/account/-/tokens");
  });
  it("names the logins it asked when none of them is a Jog account of this person's", async () => {
    const { accounts, error } = await accountsThatAnswer(["a", "b"], codes({ a: 404, b: 404 }), status);
    expect(accounts).toEqual([]);
    expect(error).toContain("a, b");
  });
  it("gives the network's own reason when asking itself fails", async () => {
    const { error } = await accountsThatAnswer(
      ["dividendsolo"],
      () => Promise.reject(new Error("getaddrinfo ENOTFOUND usejog.com")),
      () => null,
    );
    expect(error).toBe("getaddrinfo ENOTFOUND usejog.com");
  });
});

describe("jogError", () => {
  it("gives Jog's own reason for a token that ended, one off its account, and an account it cannot see", () => {
    expect(jogError(401)).toContain("usejog.com/account/-/tokens");
    expect(jogError(403)).toContain("owners");
    // The account is found through the API, so a 404 is about the login, never about a missing .env line.
    expect(jogError(404)).toContain("login");
    expect(jogError(404)).not.toContain("JOG_ACCOUNT");
  });
  it("says a status it has no words for", () => {
    expect(jogError(503)).toContain("busy");
    expect(jogError(409)).toContain("Jog changed its answer");
    expect(jogError(500)).toBe("Jog answered 500");
  });
});
