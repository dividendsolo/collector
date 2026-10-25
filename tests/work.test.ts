import { describe, expect, it } from "vitest";
import { type Diff, keepClosed, parseHold, type Row } from "@/lib/server/board";
import {
  currentWork,
  holdText,
  isSession,
  LAB,
  labRun,
  runMachine,
  runName,
  runTime,
  SESSION_MACHINE,
  SESSION_TIME,
  type WorkCard,
  type WorkRun,
} from "@/lib/work";

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
  it("marks a card labelled local as worked in a session and puts it with the live work", () => {
    const cards = [card("app", 1, "scheduled"), card("app", 2, "agent-in-progress", { labels: ["local"] })];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.map((r) => [r.card?.number, r.local])).toEqual([
      [2, true],
      [1, false],
    ]);
  });
  it("shows a card closed in the last hour as closed, and drops it after the hour", () => {
    const closed = [card("app", 5, "code-review", { closed_at: 1000 })];
    expect(currentWork([], closed, [], WAITING, 1000 + 3599).map((r) => r.state)).toEqual(["closed"]);
    expect(currentWork([], closed, [], WAITING, 1000 + 3601)).toEqual([]);
  });
});

describe("labRun", () => {
  const droid: WorkRun = {
    type: "agent",
    name: "lab-droid",
    kind: "lab",
    repo: "lab",
    card: 111,
    machine: "m1",
    seconds: 450,
  };
  it("is the lab droid's own run, and no other run, whatever the row says", () => {
    expect(labRun(droid)).toBe(true);
    expect(runName(droid)).toBe("Lab droid");
    expect(labRun({ repo: "lab", kind: "build" })).toBe(false);
    expect(labRun({ repo: "collector", kind: "lab" })).toBe(false);
  });
  it("links to the experiment's own card, which is not a card of its marker repo", () => {
    expect(LAB).toEqual({
      marker: "lab",
      repo: "agent-stack",
      card: 111,
      url: "https://github.com/dividendsolo/agent-stack/issues/111",
    });
  });
  it("leaves every other run its own name, and an unnamed one unknown", () => {
    expect(runName({ name: "builder", repo: "collector", kind: "build" })).toBe("builder");
    expect(runName({ name: null, repo: "collector", kind: "build" })).toBe("unknown");
  });
});

describe("a session row", () => {
  /** James, 2026-10-25 (card #29): "I said local for those, not the machine name ... I don't need a running for
   * either on those ... you could just say continuous or interactive ... that's really misleading." */
  const session: WorkRun = {
    type: "agent",
    name: "Claude Code",
    kind: "session",
    machine: "altair",
    card: null,
    repo: null,
    seconds: 5400,
  };

  it("reads Machine local, never the machine the session runs on", () => {
    expect(isSession(session)).toBe(true);
    expect(SESSION_MACHINE).toBe("local");
    expect(runMachine(session)).toBe("local");
    expect(runMachine(run("app", 1, 60))).toBe("m1");
  });
  it("reads Running for interactive, not a length that looks like a stuck run", () => {
    expect(SESSION_TIME).toBe("interactive");
    expect(runTime(session)).toBe("interactive");
    expect(runTime(run("app", 1, 5400))).toBe("1 h 30 min");
    expect(runTime({ kind: "build", seconds: 60 })).toBe("1 min");
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
