import { describe, expect, it } from "vitest";
import { briefsRow, PRIORITY_GROUPS, p0Rows, priorityOrder, triageRow } from "@/lib/priority";
import { warnings } from "@/lib/server/warnings";

/**
 * Priority tasks in James's order (2026-11-11, "lock that"): the rows go in groups, and the groups in this order:
 * can't work, security, needs triage, jobs failing, money and limits, good news. Inside a group, the order of the
 * rows is kept. Errors no longer jump above warnings of an earlier group.
 */
const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;

describe("Priority tasks groups", () => {
  it("are the six groups in James's order", () => {
    expect(PRIORITY_GROUPS).toEqual(["cant-work", "security", "triage", "p0", "jobs", "money", "briefs", "good-news"]);
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
    // James, 2026-11-11: one card names itself, so it can be triaged at once.
    expect(triageRow([{ lane: "needs-triage", repo: "dividendsolo/omarchy4mac", number: 45 }])?.text).toBe(
      "1 card needs triage: omarchy4mac#45",
    );
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

// James, 2026-11-11: unread briefs go between money and limits and good news.
describe("the unread briefs row", () => {
  it("counts the inbox's unread briefs and links to the Briefs page", () => {
    const row = briefsRow([{ read: false }, { read: true }, { read: false }]);
    expect(row).toMatchObject({ group: "briefs", level: "warn", text: "2 unread briefs", href: "#/briefs" });
    expect(briefsRow([{ read: false }])?.text).toBe("1 unread brief");
  });

  it("is no row when every brief is read", () => {
    expect(briefsRow([{ read: true }])).toBeNull();
    expect(briefsRow([])).toBeNull();
  });

  it("sits below money and limits, above good news", () => {
    const rows = priorityOrder([
      { group: "good-news", text: "news" },
      { group: "briefs", text: "briefs" },
      { group: "money", text: "renewal" },
    ] as any);
    expect(rows.map((r: any) => r.text)).toEqual(["renewal", "briefs", "news"]);
  });
});

// James, 2026-11-11: under needs triage, the P0 cards waiting on him, one row each.
describe("the P0 rows", () => {
  const card = (n: number, lane: string, priority: string) => ({
    repo: "dividendsolo/situation",
    number: n,
    title: `Card ${n}`,
    url: `https://github.com/dividendsolo/situation/issues/${n}`,
    lane,
    priority,
  });

  it("is one row per P0 card, outside needs-triage, linking to the card", () => {
    const rows = p0Rows([
      card(1, "ready-for-human", "P0"),
      card(2, "needs-info", "P1"),
      card(3, "needs-manual-qa", "P0"),
    ]);
    expect(rows).toEqual([
      { level: "error", group: "p0", text: "P0: Card 1 (situation#1, ready-for-human)", url: card(1, "", "").url },
      { level: "error", group: "p0", text: "P0: Card 3 (situation#3, needs-manual-qa)", url: card(3, "", "").url },
    ]);
  });

  it("leaves a P0 in needs-triage to the triage row", () => {
    expect(p0Rows([card(4, "needs-triage", "P0")])).toEqual([]);
  });

  it("sits below needs triage, above a failed job", () => {
    const rows = priorityOrder([
      { group: "jobs", text: "job" },
      { group: "p0", text: "p0" },
      { group: "triage", text: "triage" },
    ] as any);
    expect(rows.map((r: any) => r.text)).toEqual(["triage", "p0", "job"]);
  });
});

// James, 2026-11-11: "let's put the time like when it was open ... the way that the cron job says two hours ago ...
// so that the buttons all line up, and you could do that for the P0 as well". The time is when the card was opened.
describe("the age on the triage and P0 rows", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  it("gives the triage row the oldest card's open time", () => {
    const row = triageRow([
      { lane: "needs-triage", repo: "o/a", number: 1, created: "2026-11-11T18:00:00Z" },
      { lane: "needs-triage", repo: "o/b", number: 2, created: "2026-11-10T09:00:00Z" },
    ]);
    expect(row?.since).toBe(at("2026-11-10T09:00:00Z"));
  });
  it("gives each P0 row its card's open time", () => {
    const rows = p0Rows([
      {
        lane: "ready-for-agent",
        priority: "P0",
        repo: "o/a",
        number: 3,
        title: "t",
        url: "u",
        created: "2026-11-09T12:00:00Z",
      },
    ]);
    expect(rows[0].since).toBe(at("2026-11-09T12:00:00Z"));
  });
  it("leaves the age off when the card has no open time", () => {
    expect(triageRow([{ lane: "needs-triage", repo: "o/a", number: 1 }])?.since).toBeUndefined();
  });
});
