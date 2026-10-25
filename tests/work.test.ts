import { describe, expect, it } from "vitest";
import { type Diff, keepClosed, parseHold, type Row } from "@/lib/server/board";
import { currentWork, holdText, LAB, labRun, runName, type WorkCard, type WorkRun } from "@/lib/work";

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
/** A card's `Waiting on:` line: parseHold's refs, `#9` in the card's own repo and `web#7` in another. */
const hold = (refs: string[]): WorkCard["hold"] => ({
  after: refs.map((ref) => {
    const [repo, number] = ref.startsWith("#") ? ["app", ref.slice(1)] : (ref.split("#") as [string, string]);
    return { ref, url: `https://github.com/acme/${repo}/issues/${number}` };
  }),
  from: null,
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
  it("puts a scheduled card whose blocker is being worked on first in the group, flagged on deck", () => {
    const cards = [
      card("app", 2, "scheduled", { priority: "P0" }),
      card("app", 1, "scheduled", { hold: hold(["#9"]) }),
      card("app", 9, "agent-in-progress"),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.map((r) => r.card?.number)).toEqual([9, 1, 2]);
    expect(rows[1].onDeck).toEqual(["#9"]);
    expect(rows[2].onDeck).toBeUndefined();
  });
  it("leaves a scheduled card off deck when its blocker is not being worked on", () => {
    const cards = [
      card("app", 2, "scheduled", { priority: "P0" }),
      card("app", 1, "scheduled", { hold: hold(["#9"]) }),
      card("app", 9, "ready-for-agent"),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.filter((r) => r.state === "scheduled").map((r) => r.card?.number)).toEqual([2, 1]);
    expect(rows.every((r) => r.onDeck === undefined)).toBe(true);
  });
  it("counts a live run, a review lane, a session, and another repo's card as a moving blocker", () => {
    const cards = [
      card("app", 1, "scheduled", { hold: hold(["#91"]) }),
      card("app", 2, "scheduled", { hold: hold(["#92"]) }),
      card("app", 3, "scheduled", { hold: hold(["#93"]) }),
      card("app", 4, "scheduled", { hold: hold(["web#94"]) }),
      card("app", 5, "scheduled", { hold: hold(["#95"]) }),
      card("app", 6, "scheduled", { hold: hold(["#96"]) }),
      card("app", 91, "code-review"),
      card("app", 92, "scheduled"),
      card("app", 93, "scheduled", { labels: ["local"] }),
      card("web", 94, "merging"),
      card("app", 96, "scheduled"),
    ];
    const closed = [card("app", 95, "code-review", { closed_at: 1000 })];
    const rows = currentWork(cards, closed, [run("app", 92, 60)], WAITING, 1000);
    const onDeck = rows
      .filter((r) => r.onDeck)
      .sort((a, b) => (a.card?.number ?? 0) - (b.card?.number ?? 0))
      .map((r) => [r.card?.number, r.onDeck]);
    expect(onDeck).toEqual([
      [1, ["#91"]],
      [2, ["#92"]],
      [3, ["#93"]],
      [4, ["web#94"]],
    ]);
    expect(rows.filter((r) => [5, 6].includes(r.card?.number ?? 0)).every((r) => !r.onDeck)).toBe(true);
  });
  it("leaves a scheduled card with a live run or a session in the live order, off deck", () => {
    const cards = [
      card("app", 1, "scheduled", { hold: hold(["#9"]) }),
      card("app", 2, "scheduled", { hold: hold(["#9"]), labels: ["local"] }),
      card("app", 3, "scheduled", { hold: hold(["#9"]) }),
      card("app", 9, "agent-in-progress"),
    ];
    const rows = currentWork(cards, [], [run("app", 1, 60), run("app", 9, 600)], WAITING, 0);
    expect(rows.map((r) => r.card?.number)).toEqual([9, 1, 2, 3]);
    expect(rows.filter((r) => r.onDeck).map((r) => r.card?.number)).toEqual([3]);
  });
  it("marks only the ref being worked on when a card waits on several", () => {
    const cards = [
      card("app", 1, "scheduled", { hold: hold(["#9", "web#7"]) }),
      card("app", 9, "scheduled"),
      card("web", 7, "agent-in-progress"),
    ];
    expect(currentWork(cards, [], [], WAITING, 0).find((r) => r.card?.number === 1)?.onDeck).toEqual(["web#7"]);
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
    expect(runName({ name: "claude", repo: "collector", kind: "session" })).toBe("claude");
    expect(runName({ name: null, repo: "collector", kind: "build" })).toBe("unknown");
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
