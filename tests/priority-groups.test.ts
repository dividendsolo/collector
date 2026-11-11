import { describe, expect, it } from "vitest";
import { PRIORITY_GROUPS, priorityOrder, triageRow } from "@/lib/priority";
import { warnings } from "@/lib/server/warnings";

/**
 * Priority tasks in James's order (2026-11-11, "lock that"): the rows go in groups, and the groups in this order:
 * can't work, security, needs triage, jobs failing, money and limits, good news. Inside a group, the order of the
 * rows is kept. Errors no longer jump above warnings of an earlier group.
 */
const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;

describe("Priority tasks groups", () => {
  it("are the six groups in James's order", () => {
    expect(PRIORITY_GROUPS).toEqual(["cant-work", "security", "triage", "jobs", "money", "good-news"]);
  });

  it("put a service down above open ports, open ports above a failed job, and a failed job above a renewal", () => {
    const w = warnings({
      ...base,
      cfg: {
        subscriptions: [
          {
            name: "Hosting",
            amount: 20,
            billing: "monthly",
            renews: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
          },
        ],
      },
      services: [{ name: "PageRoast", status: "down", error: "HTTP 502", url: "https://p.test" }],
      machines: [
        {
          name: "ezio",
          jobs: [{ name: "Lead Watch", enabled: true, last_status: "error", last_run_at: "x" }],
          ports: [{ proto: "tcp", port: 22, reach: "internet" }],
          notices: [{ text: "Situation is listed on App Rater", key: "k" }],
        },
      ],
    });
    const groups = w.map((x) => x.group);
    const rank = (g?: string) => PRIORITY_GROUPS.indexOf(g as (typeof PRIORITY_GROUPS)[number]);
    expect(groups).toEqual([...groups].sort((a, b) => rank(a) - rank(b)));
    const text = w.map((x) => x.text).join("\n");
    expect(text.indexOf("PageRoast is down")).toBeLessThan(text.indexOf("Lead Watch on ezio"));
    expect(text.indexOf("Lead Watch on ezio")).toBeLessThan(text.indexOf("Hosting renews"));
    expect(text.indexOf("Hosting renews")).toBeLessThan(text.indexOf("App Rater"));
  });

  it("gives every row a group", () => {
    const w = warnings({
      ...base,
      ticketsError: "gh: rate limit",
      machines: [
        { name: "ezio", tailscale: "Stopped", host_broken: [{ repo: "pageroast", line: "ci: base abc1234" }] },
      ],
    });
    expect(w.length).toBeGreaterThan(0);
    for (const x of w) expect(PRIORITY_GROUPS).toContain(x.group);
  });
});

describe("the needs-triage row", () => {
  it("counts the needs-triage cards and links to them in Waiting on you", () => {
    const row = triageRow([{ lane: "needs-triage" }, { lane: "needs-triage" }, { lane: "needs-info" }]);
    expect(row).toMatchObject({
      group: "triage",
      text: "2 cards need triage",
      jump: "waiting-panel",
      filter: "needs-triage",
    });
    expect(triageRow([{ lane: "needs-triage" }])?.text).toBe("1 card needs triage");
  });

  it("is no row when nothing needs triage", () => {
    expect(triageRow([{ lane: "needs-info" }])).toBeNull();
  });

  it("sits below can't work and security, above a failed job", () => {
    const rows = priorityOrder([
      { group: "jobs", text: "job" },
      { group: "triage", text: "triage" },
      { group: "security", text: "ports" },
      { group: "cant-work", text: "down" },
    ] as any);
    expect(rows.map((r: any) => r.text)).toEqual(["down", "ports", "triage", "job"]);
  });
});
