import { describe, expect, it } from "vitest";
import { type Diff, keepClosed, parseHold, type Row } from "@/lib/server/board";
import {
  cardState,
  currentWork,
  holdLacksReason,
  holdText,
  holdTip,
  isSession,
  LAB,
  labRun,
  runMachine,
  runName,
  runTime,
  SESSION_MACHINE,
  SESSION_TIME,
  SESSION_TMUX,
  STALE_SECONDS,
  staleness,
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
/** A card's `Waiting on:` line: parseHold's refs, `#9` in the card's own repo and `web#7` in another. */
const hold = (refs: string[]): WorkCard["hold"] => ({
  after: refs.map((ref) => {
    const [repo, number] = ref.startsWith("#") ? ["app", ref.slice(1)] : (ref.split("#") as [string, string]);
    return { ref, url: `https://github.com/acme/${repo}/issues/${number}` };
  }),
  from: null,
  why: null,
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
  it("a session card reads session, a claim with no run reads its lane", () => {
    // agent-stack#187: agent-in-progress for 4 days with no run behind it (James, 2026-10-29).
    const cards = [
      card("app", 1, "agent-in-progress", { labels: ["local"] }),
      card("app", 2, "agent-in-progress"),
      card("app", 3, "verify-in-progress"),
      card("app", 4, "code-review"),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.map((r) => [r.card?.number, cardState(r)])).toEqual([
      [1, "session"],
      [2, "agent-in-progress"],
      [3, "verify-in-progress"],
      [4, "code-review"],
    ]);
  });
  it("shows stale run data instead of the lane: a page snapshot past its interval, or a machine whose read failed", () => {
    // Card #41: dividend-solo#140 and situation#814 read `no run` while both builds ran on ezio, because the page
    // still held a snapshot from before the server stopped answering.
    const now = 10_000;
    const cards = [
      card("app", 1, "agent-in-progress", { labels: ["ezio"] }),
      card("app", 2, "agent-in-progress", { labels: ["altair"] }),
      card("app", 3, "verify-in-progress"),
      card("app", 4, "code-review", { labels: ["ezio"] }),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    const fresh = staleness({ at: now - 5, machines: [{ name: "altair" }, { name: "ezio" }] }, now);
    expect(rows.map((r) => cardState(r, fresh))).toEqual([
      "agent-in-progress",
      "agent-in-progress",
      "verify-in-progress",
      "code-review",
    ]);

    const page = staleness({ at: now - 180, machines: [{ name: "altair" }, { name: "ezio" }] }, now);
    expect(page.page).toBe(180);
    expect(rows.map((r) => cardState(r, page))).toEqual(["stale 3 min", "stale 3 min", "stale 3 min", "code-review"]);

    const ezio = staleness(
      { at: now - 5, machines: [{ name: "altair" }, { name: "ezio", stale: true, read_at: now - 240 }] },
      now,
    );
    expect(ezio.page).toBeNull();
    expect(rows.map((r) => cardState(r, ezio))).toEqual([
      "ezio stale 4 min",
      "agent-in-progress",
      "ezio stale 4 min",
      "code-review",
    ]);

    const never = staleness({ at: now - 5, machines: [{ name: "ezio", stale: true, read_at: null }] }, now);
    expect(cardState(rows[0], never)).toBe("ezio unread");
  });
  it("reads the state of a custom set's statuses too: the working set is a setting now (collector#53)", () => {
    // A user's own statuses: a card in one of them, with no run and stale data, reads how old the data is.
    const rows = currentWork(
      [card("app", 1, "review-me"), card("app", 2, "agent-in-progress")],
      [],
      [],
      ["blocked-on-me"],
      0,
    );
    const page = staleness({ at: 10_000 - 180, machines: [] }, 10_000);
    expect(rows.map((r) => cardState(r, page, ["review-me"]))).toEqual(["stale 3 min", "agent-in-progress"]);
    // With the agent stack's set, the same rows read the other way round.
    expect(rows.map((r) => cardState(r, page, ["agent-in-progress"]))).toEqual(["review-me", "stale 3 min"]);
  });
  it("calls the page stale only past its interval", () => {
    expect(staleness({ at: 100 }, 100 + STALE_SECONDS).page).toBeNull();
    expect(staleness({ at: 100 }, 101 + STALE_SECONDS).page).toBe(STALE_SECONDS + 1);
    expect(staleness(null, 100).page).toBeNull();
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
    expect(rows.filter((r) => r.state === "scheduled").map((r) => r.card?.number)).toEqual([1, 2]);
    expect(rows.every((r) => r.onDeck === undefined)).toBe(true);
  });
  it("orders the scheduled group: waiting on a card first, then dated soonest first, then the rest", () => {
    const from = (day: string): WorkCard["hold"] => ({ after: [], from: day, why: null });
    const cards = [
      card("app", 1, "scheduled", { priority: "P0" }),
      card("app", 2, "scheduled", { hold: from("2026-11-20") }),
      card("app", 3, "scheduled", { hold: from("2026-11-02") }),
      card("app", 4, "scheduled", { hold: hold(["#9"]) }),
      card("app", 5, "scheduled", { hold: from("2026-11-06"), priority: "P0" }),
      card("app", 9, "ready-for-agent"),
    ];
    const rows = currentWork(cards, [], [], WAITING, 0);
    expect(rows.filter((r) => r.state === "scheduled").map((r) => r.card?.number)).toEqual([4, 3, 5, 2, 1]);
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
    expect(runName({ name: "builder", repo: "collector", kind: "build" })).toBe("builder");
    expect(runName({ name: null, repo: "collector", kind: "build" })).toBe("unknown");
  });
  /** James, 2026-10-25 (card #32): a `bun start` left in a card's worktree showed as the foreman working that card.
   * Its row is the process itself — the program and the port it listens on — never the work script's name. */
  it("names a leftover process after its program and its port, never the work script", () => {
    const leftover: WorkRun = {
      type: "leftover",
      name: "bun start",
      kind: "leftover",
      repo: "collector",
      card: 25,
      machine: "ezio",
      seconds: 12420,
      port: 4123,
    };
    expect(runName(leftover)).toBe("bun start :4123");
    expect(runName({ name: "next-server", repo: "collector", kind: "leftover" })).toBe("next-server");
    expect(runName(leftover)).not.toContain("foreman");
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
  it("reads tmux for a session that runs inside tmux (card #37)", () => {
    // James, 2026-10-29: the peer-session list showed two rows reading `interactive`, one of them his tmux `Work`
    // window — "if it's a Tmux session, can we put Tmux instead of interactive in the collector page?"
    expect(SESSION_TMUX).toBe("tmux");
    expect(runTime({ ...session, tmux: true })).toBe("tmux");
    expect(runTime({ ...session, tmux: false })).toBe("interactive");
    expect(runTime({ ...session, tmux: null })).toBe("interactive");
  });
  it("keeps its own length for a run that is not a session, tmux marker or not", () => {
    expect(runTime({ kind: "build", seconds: 60, tmux: true })).toBe("1 min");
    expect(runTime(run("app", 1, 60))).toBe("1 min");
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
    expect(h).toEqual({ after: [], from: "2026-11-01", why: null, to: "ready-for-human" });
    expect(holdText(h)).toBe("from 2026-11-01");
  });
  it("is null with neither line", () => {
    expect(parseHold("just a card", url)).toBeNull();
  });
  it("reads the reason off the same line (collector#50), agent-stack#272's own", () => {
    const h = parseHold(
      "Not before: 2026-11-16 -> ready-for-human (why: the earliest date the proof log can show two weeks green, counted from 2026-11-02)\n\nbody",
      url,
    );
    expect(h).toEqual({
      after: [],
      from: "2026-11-16",
      why: "the earliest date the proof log can show two weeks green, counted from 2026-11-02",
      to: "ready-for-human",
    });
    expect(holdText(h)).toBe("from 2026-11-16"); // what the date shows does not change
  });
  it("reads no reason as none: an older line, and one that only says the status", () => {
    expect(parseHold("Not before: 2026-11-03 -> ready-for-agent", url)?.why).toBeNull();
    expect(parseHold("**Not before:** 2026-11-03 -> ready-for-agent", url)?.why).toBeNull();
    expect(parseHold("**Not before:** 2026-11-03 -> ready-for-agent (why: James chose tomorrow)", url)?.why).toBe(
      "James chose tomorrow",
    );
  });
});

describe("holdTip", () => {
  const url = "https://github.com/acme/app/issues/7";
  it("carries the reason a scheduled card's date shows on hover", () => {
    const h = parseHold(
      "Not before: 2026-11-03 -> ready-for-human (why: James chose to do it in tomorrow's session, 2026-11-02)",
      url,
    );
    expect(holdTip(h)).toEqual({
      title: "Why it waits",
      text: "James chose to do it in tomorrow's session, 2026-11-02",
    });
  });
  it("reads a bare parenthesis on the line as the reason too", () => {
    const h = parseHold("Not before: 2026-11-05 -> ready-for-agent (James, 2026-10-29: hold the Show HN)", url);
    expect(holdTip(h)?.text).toBe("James, 2026-10-29: hold the Show HN");
  });
  it("says what a card waits for when the card gives no reason", () => {
    expect(holdTip(parseHold("Not before: 2026-11-01 -> ready-for-human", url))?.text).toBe(
      "This card does not say why it waits, so it belongs in needs-info. It waits until 2026-11-01, then moves to ready-for-human.",
    );
    expect(holdTip(parseHold("**Waiting on:** #146", url))?.text).toBe("It waits until #146 closes.");
    expect(holdTip(null)).toBeNull();
  });
  it("flags only a dated card with no reason", () => {
    expect(holdLacksReason(parseHold("Not before: 2026-11-01 -> ready-for-human", url))).toBe(true);
    expect(holdLacksReason(parseHold("Not before: 2026-11-01 -> ready-for-human (why: data first)", url))).toBe(false);
    expect(holdLacksReason(parseHold("**Waiting on:** #146", url))).toBe(false);
    expect(holdLacksReason(null)).toBe(false);
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
