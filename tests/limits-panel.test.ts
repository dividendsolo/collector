import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/components/data", () => ({ useLive: () => live.data, useApi: () => ({ data: null }) }));

const gh = vi.hoisted(() => ({
  answers: {} as Record<string, [any, string | null]>,
  text: {} as Record<string, [string, string | null]>,
  calls: [] as string[][],
}));

vi.mock("@/lib/server/run", () => ({
  run: async (cmd: string[]) => {
    gh.calls.push(cmd);
    return gh.answers[cmd.slice(0, 3).join(" ")] ?? [null, "not stubbed"];
  },
  runText: async (cmd: string[]) => {
    gh.calls.push(cmd);
    const [stdout, error] = gh.text[cmd.slice(0, 3).join(" ")] ?? ["", "not stubbed"];
    return { ok: error == null, stdout, error };
  },
}));

const { LimitsPanel } = await import("@/components/dashboard");
const { githubLimit, isRateLimited, probeRefusal } = await import("@/lib/server/machines");

const JOG = { used: 1200, limit: 5000, reset: 1796083200 };
const RESET = 1795400000;
const graphql = (used: number, remaining = 5000 - used) => ({ used, limit: 5000, remaining, reset: RESET });
const rateLimit = (remaining: number): [any, string | null] => [
  { resources: { graphql: graphql(1400, remaining), core: graphql(10) } },
  null,
];
const render = (github: any) => {
  live.data = { state: { jog: JOG, github } };
  return renderToStaticMarkup(createElement(LimitsPanel));
};

const time = (s: number) => new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const refusedAt = Math.floor(new Date(2026, 10, 16, 14, 7).getTime() / 1000);
const PRIMARY = "GraphQL: API rate limit already exceeded for user ID 38703245. (RATE_LIMITED)";
const SECONDARY = "HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";

describe("the Dashboard's Jog and GitHub limits panel (collector#186, collector#219)", () => {
  it("names both limits in its title", () => {
    expect(render({ graphql: graphql(1400) })).toContain("Jog and GitHub limits");
  });

  it("shows the hourly limit and the per-minute limit as two rows", () => {
    const html = render({ graphql: graphql(1400) });
    expect(html).toContain("Jog minutes (this month)");
    expect(html).toContain("Hourly (board reads)");
    expect(html).toContain("Per minute");
    expect(html).toContain("1,400");
    expect(html).toContain("of 5,000 used");
    expect(html).toContain("resets");
    expect(html).toContain('style="width:28%"');
    expect(html).toContain("OK");
    expect(html).toContain("GitHub does not publish this count.");
    expect(html).not.toContain("refusing");
  });

  it("turns the hourly bar red at 90% used", () => {
    expect(render({ graphql: graphql(4499) })).not.toContain('class="bar low"');
    expect(render({ graphql: graphql(4500) })).toContain('class="bar low"><span style="width:90%"');
  });

  it("shows a per-minute refusal in the per-minute row, and leaves the hourly count alone", () => {
    const html = render({ graphql: graphql(1400), refusal: { at: refusedAt, limit: "minute", retryAfter: 120 } });
    expect(html).toContain("Too many calls in one minute");
    expect(html).toContain(`refused ${time(refusedAt)}`);
    expect(html).toContain("clears in about 2 min");
    expect(html).toContain("1,400");
    expect(html).toContain("of 5,000 used");
    expect(html).not.toContain("Hourly limit reached");
    expect(html).not.toContain("GitHub is refusing calls");
  });

  it("says a few minutes when the refusal named no retry-after", () => {
    const html = render({ graphql: graphql(1400), refusal: { at: refusedAt, limit: "minute", retryAfter: null } });
    expect(html).toContain("clears in a few minutes");
  });

  it("shows an hourly refusal in the hourly row, with its reset, and says OK per minute", () => {
    const html = render({ graphql: graphql(5000), refusal: { at: refusedAt, limit: "hourly", retryAfter: null } });
    expect(html).toContain("Hourly limit reached");
    expect(html).toContain(`resets ${time(RESET)}`);
    expect(html).toContain("OK");
    expect(html).not.toContain("of 5,000 used");
  });

  it("says which limit refused even when the hourly count itself could not be read", () => {
    const html = render({ error: "HTTP 403", refusal: { at: refusedAt, limit: "minute", retryAfter: null } });
    expect(html).toContain("Too many calls in one minute");
    expect(html).not.toContain("Could not read");
  });
});

describe("isRateLimited", () => {
  it("reads GitHub's primary and secondary rate-limit refusals as one", () => {
    expect(isRateLimited("GraphQL: API rate limit already exceeded for user ID 123. (RATE_LIMITED)")).toBe(true);
    expect(isRateLimited("HTTP 403: You have exceeded a secondary rate limit.")).toBe(true);
    expect(isRateLimited("HTTP 502: Bad Gateway")).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });
});

describe("what the GraphQL probe records (collector#219)", () => {
  beforeEach(() => {
    gh.calls = [];
    gh.answers = {};
    gh.text = {};
  });

  it("asks for the refusal's own headers, and reads the secondary limit and its retry-after", async () => {
    gh.text["gh api graphql"] = ["HTTP/2.0 403 Forbidden\nRetry-After: 120", SECONDARY];
    gh.answers["gh api rate_limit"] = rateLimit(1444);
    const before = Math.floor(Date.now() / 1000);
    const r = await probeRefusal();
    expect(gh.calls.some((c) => c.includes("--include"))).toBe(true);
    expect(r?.limit).toBe("minute");
    expect(r?.retryAfter).toBe(120);
    expect(r?.at).toBeGreaterThanOrEqual(before);
  });

  it("reads a refusal with no points left as the hourly limit", async () => {
    gh.text["gh api graphql"] = ["HTTP/2.0 403 Forbidden", PRIMARY];
    gh.answers["gh api rate_limit"] = rateLimit(0);
    expect((await probeRefusal())?.limit).toBe("hourly");
  });

  it("reads a refusal while the hourly limit still has points left as the per-minute limit", async () => {
    gh.text["gh api graphql"] = ["HTTP/2.0 403 Forbidden", PRIMARY];
    gh.answers["gh api rate_limit"] = rateLimit(1444);
    const r = await probeRefusal();
    expect(r?.limit).toBe("minute");
    expect(r?.retryAfter).toBeNull();
  });

  it("records nothing when GitHub answers", async () => {
    gh.text["gh api graphql"] = ["HTTP/2.0 200 OK\nContent-Type: application/json", null];
    expect(await probeRefusal()).toBeNull();
  });

  it("records nothing on a failure that is not a rate limit", async () => {
    gh.text["gh api graphql"] = ["HTTP/2.0 502 Bad Gateway", "HTTP 502: Bad Gateway"];
    expect(await probeRefusal()).toBeNull();
  });
});

describe("the GraphQL probe on the GitHub limit read (collector#219)", () => {
  it("carries the refusal and the hourly count on the answer, while rate_limit cannot be read", async () => {
    gh.calls = [];
    gh.text = { "gh api graphql": ["HTTP/2.0 403 Forbidden\nRetry-After: 60", SECONDARY] };
    gh.answers = { "gh api rate_limit": [null, "HTTP 403"] };
    const before = Math.floor(Date.now() / 1000);
    const g = await githubLimit();
    expect(g.error).toBe("HTTP 403");
    expect(g.refusal?.limit).toBe("minute");
    expect(g.refusal?.retryAfter).toBe(60);
    expect(g.refusal?.at).toBeGreaterThanOrEqual(before);
  });
});
