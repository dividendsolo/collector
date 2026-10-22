import { describe, expect, it } from "vitest";
import { type Diff, keepClosed, parseHold, type Row } from "@/lib/server/board";
import { currentWork, holdText, type WorkCard, type WorkRun } from "@/lib/work";

const WAITING = ["needs-triage", "needs-info", "ready-for-human", "needs-manual-qa"];
const card = (repo: string, number: number, lane: string, extra: Partial<WorkCard> = {}): WorkCard => ({
  repo,
  number,
  title: `T${number}`,
  url: `https://github.com/acme/${repo}/issues/${number}`,
  lane,
  priority: null,
  created: "2026-10-01T00:00:00Z",
  ...extra,
});
const run = (repo: string, n: number, seconds: number): WorkRun => ({
  type: "agent",
  name: "builder",
  kind: "build",
  machine: "m1",
  card: n,
  repo,
  seconds,
});

describe("currentWork", () => {
  it("puts every open card not waiting on James on exactly one row", () => {
    const cards = [
      card("app", 1, "scheduled"),
      card("app", 2, "needs-triage"),
      card("app", 3, "code-review"),
      card("app", 4, "ready-for-agent"),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.map((r) => r.card?.number)).toEqual([3, 4, 1]);
  });
  it("joins a live run onto its card and puts live runs first, longest first", () => {
    const cards = [card("app", 1, "agent-in-progress"), card("app", 2, "code-review"), card("app", 3, "scheduled")];
    const rows = currentWork(cards, [], [run("app", 1, 60), run("web", 9, 600)], WAITING, 0);
    expect(rows.map((r) => [r.card?.number ?? null, r.run?.card ?? null])).toEqual([
      [null, 9],
      [1, 1],
      [2, null],
      [3, null],
    ]);
  });
  it("orders a group by priority, then oldest", () => {
    const cards = [
      card("app", 1, "scheduled", { created: "2026-10-02T00:00:00Z" }),
      card("app", 2, "scheduled", { priority: "P0", created: "2026-10-03T00:00:00Z" }),
      card("app", 3, "scheduled", { created: "2026-10-01T00:00:00Z" }),
    ];
    expect(currentWork(cards, [], [], WAITING, 0).map((r) => r.card?.number)).toEqual([2, 3, 1]);
  });
  it("shows a card closed in the last hour as closed, and drops it after the hour", () => {
    const closed = [card("app", 5, "code-review", { closed_at: 1000 })];
    expect(currentWork([], closed, [], WAITING, 1000 + 3599).map((r) => r.state)).toEqual(["closed"]);
    expect(currentWork([], closed, [], WAITING, 1000 + 3601)).toEqual([]);
  });
});

describe("parseHold", () => {
  const url = "https://github.com/acme/app/issues/7";
  it("reads the Waiting on cards, same repo short and other repos named", () => {
    const h = parseHold("**Waiting on:** #146, acme/web#149 -> ready-for-agent\n\nbody", url);
    expect(h?.after).toEqual([
      { ref: "#146", url: "https://github.com/acme/app/issues/146" },
      { ref: "web#149", url: "https://github.com/acme/web/issues/149" },
    ]);
    expect(holdText(h)).toBe("after #146, web#149");
  });
  it("reads the Not before date", () => {
    const h = parseHold("Not before: 2026-11-01 -> ready-for-human", url);
    expect(h).toEqual({ after: [], from: "2026-11-01" });
    expect(holdText(h)).toBe("from 2026-11-01");
  });
  it("is null with neither line", () => {
    expect(parseHold("just a card", url)).toBeNull();
  });
});

describe("keepClosed", () => {
  const row = (n: number, lane: string): Row => ({
    repo: "app",
    number: n,
    title: "T",
    url: `https://github.com/acme/app/issues/${n}`,
    lane,
    priority: null,
    created: "2026-10-01T00:00:00Z",
    labels: [],
  });
  const diff = (d: Partial<Diff>): Diff => ({ added: [], removed: [], moved: [], changed: [], ...d });
  it("keeps work cards that leave, not waiting ones, and forgets them after an hour or on return", () => {
    const m = new Map();
    keepClosed(m, diff({ removed: [row(1, "code-review"), row(2, "needs-triage")] }), WAITING, 0);
    expect([...m.keys()]).toEqual(["https://github.com/acme/app/issues/1"]);
    keepClosed(m, diff({ added: [row(1, "code-review")] }), WAITING, 10);
    expect(m.size).toBe(0);
    keepClosed(m, diff({ removed: [row(3, "merging")] }), WAITING, 0);
    keepClosed(m, diff({}), WAITING, 3_600_001);
    expect(m.size).toBe(0);
  });
});
