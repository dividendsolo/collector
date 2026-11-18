import { beforeEach, describe, expect, it, vi } from "vitest";

const gh = vi.hoisted(() => ({
  calls: 0,
  answer: null as null | (() => [any, string | null]),
  limit: { graphql: { used: 5000, limit: 5000, reset: 0 } } as any,
}));

vi.mock("@/lib/server/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/run")>("@/lib/server/run");
  return {
    ...actual,
    run: async (cmd: string[]) => {
      if (cmd[0] === "gh" && cmd[1] === "api" && cmd[2] === "graphql") {
        gh.calls++;
        return gh.answer ? gh.answer() : [null, "gh: API rate limit already exceeded for user ID 1."];
      }
      return [null, "not stubbed"];
    },
  };
});

vi.mock("@/lib/server/machines", () => ({ githubLimit: async () => gh.limit }));

vi.mock("@/lib/server/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/config")>("@/lib/server/config");
  return {
    ...actual,
    config: () => ({
      board: { project_id: "PVT_x", lanes: { "ready-for-agent": "o1" }, priorities: {}, label_repos: [] },
      tickets: { all: ["ready-for-agent"] },
    }),
  };
});

async function fresh() {
  vi.resetModules();
  for (const k of Object.keys((globalThis as any) || {}))
    if (k.startsWith("__collector")) delete (globalThis as any)[k];
  return import("@/lib/server/board");
}

describe("a GitHub rate limit on the board read", () => {
  beforeEach(() => {
    gh.calls = 0;
    gh.answer = null;
    gh.limit = { graphql: { used: 5000, limit: 5000, reset: Math.floor(Date.now() / 1000) + 1800 } };
  });

  it("names the limit, the board's age and the next try", async () => {
    const b = await fresh();
    await b.poll();
    const w = b.workView();
    expect(w.error).toMatch(/^GitHub rate limit reached: the board has not loaded yet; next read at \d\d:\d\d$/);
    expect(b.boardStats().paused_until).toBeGreaterThan(Date.now() + 25 * 60_000);
  });

  it("does not ask GitHub again until the limit resets", async () => {
    const b = await fresh();
    await b.poll();
    const after = gh.calls;
    await b.poll();
    await b.poll("page opened");
    expect(gh.calls).toBe(after);
  });

  it("reads again once the reset time has passed, and clears the warning", async () => {
    gh.limit = { graphql: { used: 5000, limit: 5000, reset: Math.floor(Date.now() / 1000) - 5 } };
    const b = await fresh();
    await b.poll();
    expect(b.workView().error).toMatch(/GitHub rate limit reached/);
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
    gh.answer = () => [
      {
        data: {
          rateLimit: { cost: 1, remaining: 4000, resetAt: "x" },
          node: { items: { pageInfo: { hasNextPage: false }, nodes: [] } },
        },
      },
      null,
    ];
    await b.poll();
    vi.useRealTimers();
    expect(b.workView().error).toBeNull();
    expect(b.boardStats().paused_until).toBe(0);
  });

  it("an error that is not the limit keeps the old message and no pause", async () => {
    gh.answer = () => [null, "timed out after 30 s"];
    const b = await fresh();
    await b.poll();
    expect(b.workView().error).toBe("timed out after 30 s");
    expect(b.boardStats().paused_until).toBe(0);
  });
});
