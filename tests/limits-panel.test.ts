import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/components/data", () => ({ useLive: () => live.data, useApi: () => ({ data: null }) }));

const gh = vi.hoisted(() => ({ answers: {} as Record<string, [any, string | null]>, calls: [] as string[][] }));
vi.mock("@/lib/server/run", () => ({
  run: async (cmd: string[]) => {
    gh.calls.push(cmd);
    return gh.answers[cmd.slice(0, 3).join(" ")] ?? [null, "not stubbed"];
  },
}));

const { LimitsPanel } = await import("@/components/dashboard");
const { githubLimit, isRateLimited } = await import("@/lib/server/machines");

const JOG = { used: 1200, limit: 5000, reset: 1796083200 };
const graphql = (used: number) => ({ used, limit: 5000, reset: 1795400000 });
const render = (github: any) => {
  live.data = { state: { jog: JOG, github } };
  return renderToStaticMarkup(createElement(LimitsPanel));
};

describe("the Dashboard's Jog and GitHub limits panel (collector#186)", () => {
  it("names both limits in its title", () => {
    expect(render({ graphql: graphql(1400) })).toContain("Jog and GitHub limits");
  });

  it("shows the GraphQL limit beside Jog minutes: used, of the limit, and the reset", () => {
    const html = render({ graphql: graphql(1400) });
    expect(html).toContain("Jog minutes (this month)");
    expect(html).toContain("GraphQL (board reads)");
    expect(html).toContain("1,400");
    expect(html).toContain("of 5,000 used");
    expect(html).toContain("resets");
    expect(html).toContain('style="width:28%"');
    expect(html).not.toContain("refusing");
  });

  it("turns the GraphQL bar red at 90% used", () => {
    expect(render({ graphql: graphql(4499) })).not.toContain('class="bar low"');
    expect(render({ graphql: graphql(4500) })).toContain('class="bar low"><span style="width:90%"');
  });

  it("says GitHub is refusing calls, in red, with the last refusal's time, whatever the count says", () => {
    const refused = Math.floor(new Date(2026, 10, 16, 14, 7).getTime() / 1000);
    const html = render({ graphql: graphql(1400), refused });
    expect(html).toContain('class="alert error"');
    expect(html).toContain("GitHub is refusing calls");
    const time = new Date(refused * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(html).toContain(`last refused ${time}`);
  });

  it("says GitHub is refusing calls even when the limit itself could not be read", () => {
    const html = render({ error: "HTTP 403", refused: 1795400000 });
    expect(html).toContain("GitHub is refusing calls");
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

describe("the GraphQL probe on the GitHub limit read", () => {
  beforeEach(() => {
    gh.calls = [];
  });

  it("carries the time GitHub refused the probe, while rate_limit still says the count is fine", async () => {
    gh.answers = {
      "gh api rate_limit": [{ resources: { graphql: graphql(1400), core: graphql(10) } }, null],
      "gh api graphql": [null, "HTTP 403: You have exceeded a secondary rate limit."],
    };
    const before = Math.floor(Date.now() / 1000);
    const g = await githubLimit();
    expect(gh.calls.some((c) => c.join(" ").includes("query={ viewer { login } }"))).toBe(true);
    expect(g.graphql?.used).toBe(1400);
    expect(g.refused).toBeGreaterThanOrEqual(before);
  });
});
