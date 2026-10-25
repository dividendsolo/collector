import { describe, expect, it } from "vitest";
import {
  ago,
  daysAgo,
  duration,
  historyless,
  lastResult,
  moneyParts,
  runLabel,
  schedule,
  shortRole,
  status,
  waitingOrder,
} from "@/lib/format";
import type { WorkRun } from "@/lib/work";

const run = (extra: Partial<WorkRun>): WorkRun => ({
  type: "agent",
  name: "Claude Code",
  kind: "session",
  machine: "m1",
  card: null,
  repo: null,
  seconds: 8,
  ...extra,
});

describe("format", () => {
  it("says how long ago", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(ago("2026-10-21T11:59:30Z", now)).toBe("30 s ago");
    expect(ago("2026-10-21T11:00:00Z", now)).toBe("1 h ago");
    expect(ago("2026-10-20T12:00:00Z", now)).toBe("1 day ago");
    expect(ago(null, now)).toBe("—");
    expect(daysAgo("2026-10-21T08:00:00Z", now)).toBe("today");
    expect(daysAgo("2026-10-18T08:00:00Z", now)).toBe("3 days ago");
  });
  it("formats durations", () => {
    expect(duration(600)).toBe("10 min");
    expect(duration(3900)).toBe("1 h 5 min");
  });
  it("reads cron and launchd schedules", () => {
    expect(schedule("*/5 * * * *")).toBe("every 5 min");
    expect(schedule("0 9 * * 1-5")).toBe("weekdays 09:00");
    expect(schedule("30 7 * * *", "UTC", "EDT")).toBe("daily 07:30 UTC");
    expect(schedule("0 8 * * 1")).toBe("Mon 08:00");
    expect(schedule('{"Hour":6,"Minute":5}')).toBe("daily 06:05");
    expect(schedule("every 120m")).toBe("every 120m");
  });
  it("names job status", () => {
    expect(status({ enabled: false, state: "completed" })).toBe("Done");
    expect(status({ enabled: true, last_status: "delivery_failed" })).toBe("Warning");
    expect(status({ enabled: true, last_status: "error" })).toBe("Failed");
    expect(status({ enabled: true, last_status: "ok (opened a PR)" })).toBe("OK");
  });
  it("says no history for a job whose scheduler keeps none, rather than a failure", () => {
    expect(lastResult({ last_status: "ok" })).toBe("ok");
    expect(lastResult({ history: true, last_status: null })).toBe("—");
    expect(lastResult({ history: false })).toBe("no history");
    // A plain crontab line is green, and its row says it kept no history: not a failure.
    expect(historyless({ history: false })).toBe(true);
    expect(historyless({ history: true })).toBe(false);
    expect(historyless({})).toBe(false);
    // A plain crontab line, as collect.py reports it, is green and never reads as a failure.
    const plain: { enabled: boolean; history: boolean; last_status: null } = {
      enabled: true,
      history: false,
      last_status: null,
    };
    expect(status(plain)).toBe("OK");
  });
  it("splits dollar amounts out of a sentence for the blur", () => {
    expect(moneyParts("usable on the $22/month plan")).toEqual([
      { text: "usable on the ", money: false },
      { text: "$22/month", money: true },
      { text: " plan", money: false },
    ]);
  });
  it("shortens a role", () => {
    expect(shortRole("The builder (Mac): builds cards")).toBe("builder");
  });
});

describe("runLabel", () => {
  // A run on a card, a Claude Code session in a plain checkout, and a Codex session in the home folder — the three
  // rows collect.py reports (card #21), each named the way collect.py names the tool (card #29). The project page's
  // "Agent now" fact and the Agents page pills all print this, so a session with no card must name the tool and
  // never read "#null".
  const onCard = run({ name: "collector-builder", kind: "build", card: 21, repo: "collector" });
  const inCheckout = run({ repo: "collector" });
  const inHome = run({ name: "Codex" });

  it("names the tool for a session with no card, never #null", () => {
    expect(runLabel(inCheckout)).toBe("Claude Code session");
    expect(runLabel(inHome)).toBe("Codex session");
    expect(runLabel(inCheckout)).not.toContain("null");
    expect(runLabel(inHome)).not.toContain("null");
    expect(runLabel(run({ card: null, kind: "build", name: "backup.sh" }))).toBe("backup.sh building");
  });
  it("keeps the card and what the run is doing when it has one", () => {
    expect(runLabel(onCard)).toBe("#21 building");
    expect(runLabel(run({ name: "Claude Code", kind: "review", card: 7 }))).toBe("#7 reviewing");
  });
  it("reads as the project page's Agent now fact with a card-less session among the runs", () => {
    // The fact's own expression, character for character as projects.tsx writes it.
    const fact = (agents: WorkRun[]) => (agents.length ? agents.map(runLabel).join(", ") : "—");
    expect(fact([onCard, inCheckout])).toBe("#21 building, Claude Code session");
    expect(fact([])).toBe("—");
  });
});

describe("waitingOrder", () => {
  it("sorts by priority, then ready-for-human, needs-manual-qa, needs-info, needs-triage, then oldest", () => {
    const rows = [
      { id: "p1-triage", priority: "P1", lane: "needs-triage", created: "2026-10-01" },
      { id: "p2-human", priority: "P2", lane: "ready-for-human", created: "2026-10-01" },
      { id: "p1-info", priority: "P1", lane: "needs-info", created: "2026-10-01" },
      { id: "p1-human-new", priority: "P1", lane: "ready-for-human", created: "2026-10-20" },
      { id: "p1-qa", priority: "P1", lane: "needs-manual-qa", created: "2026-10-01" },
      { id: "p1-human-old", priority: "P1", lane: "ready-for-human", created: "2026-10-02" },
      { id: "p0-triage", priority: "P0", lane: "needs-triage", created: "2026-10-21" },
    ];
    expect(rows.sort(waitingOrder).map((r) => r.id)).toEqual([
      "p0-triage",
      "p1-human-old",
      "p1-human-new",
      "p1-qa",
      "p1-info",
      "p1-triage",
      "p2-human",
    ]);
  });
});
