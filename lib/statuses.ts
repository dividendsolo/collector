import { prio } from "./format";

/**
 * The card statuses Collector reads (collector#53): which statuses mean a card waits on you, which mean a droid
 * is working it, and which mean it is done. `config.json`'s `statuses` sets them; with nothing set the agent
 * stack's own statuses are used, so the page James runs is unchanged.
 */

/** The three sets, in the order the page reads them. Each is a list of lane slugs, and its own order is the
 * order the page shows them in. */
export interface StatusSets {
  /** Waits on you: what the Waiting on you list holds, in this order. */
  waiting: string[];
  /** A droid is working: a machine (or a session) holds the card right now. */
  working: string[];
  /** Done: the card is finished, so it is not open work and it is not a wait. */
  done: string[];
}

/**
 * The agent stack's own statuses, which are the defaults. From `agent-stack/vps/scripts/lane.py`: `ASK_LANES`
 * is the lanes a card enters only with an Ask for James (needs-info, ready-for-human, needs-manual-qa), plus
 * `needs-triage`, which waits on a triage session; `agent-in-progress` and `verify-in-progress` are the two
 * lanes a machine claims a card in, so they are the ones that mean a droid is working on it right now.
 */
export const AGENT_STACK_STATUSES: StatusSets = {
  waiting: ["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage"],
  working: ["agent-in-progress", "verify-in-progress"],
  done: ["closed"],
};

/** The part of `config.json` these settings come from. */
export interface StatusesConfig {
  statuses?: Partial<StatusSets> | null;
  tickets?: { each?: string[] } | null;
}

/** One set from the file: a named list, and an empty list means "none" rather than "unset". */
const set = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : fallback;

/**
 * The statuses Collector reads here. `waiting` is the setting, else `tickets.each` — the older name for the same
 * list, so a config that already set it keeps exactly the lanes and the order it had — else the agent stack's
 * four. A config with no file at all gets the agent stack's sets: a stranger is led toward the agent stack.
 */
export function statusSets(cfg: StatusesConfig = {}): StatusSets {
  const s = cfg.statuses || {};
  return {
    waiting: set(s.waiting, set(cfg.tickets?.each, AGENT_STACK_STATUSES.waiting)),
    working: set(s.working, AGENT_STACK_STATUSES.working),
    done: set(s.done, AGENT_STACK_STATUSES.done),
  };
}

export const STATUS_KEYS = ["waiting", "working", "done"] as const;

/** Whether these are the agent stack's statuses, untouched: the Card flow page says so, and says they are the
 * user's own when they are not. */
export const isAgentStack = (s: StatusSets) => STATUS_KEYS.every((k) => s[k].join() === AGENT_STACK_STATUSES[k].join());

/** Where a lane sits in the waiting set: its own order, and a lane the set does not name last. */
export const waitingRank = (waiting: string[], lane?: string | null) => {
  const i = waiting.indexOf(lane || "");
  return i < 0 ? waiting.length : i;
};

/** Waiting on you: highest priority first, then the set's own order, then oldest (James, 2026-10-22). */
export const waitingOrder =
  (waiting: string[]) =>
  (a: { priority?: string | null; lane?: string | null; created?: string | null }, b: typeof a) =>
    prio(a.priority) - prio(b.priority) ||
    waitingRank(waiting, a.lane) - waitingRank(waiting, b.lane) ||
    (a.created || "").localeCompare(b.created || "");

/** The Waiting on you list: every ticket in the set's lanes, in the set's order. A lane the set does not name is
 * not on the list, whatever the agent stack calls it. */
export const waitingList = <T extends { lane: string; priority?: string | null; created?: string | null }>(
  tickets: T[],
  waiting: string[],
) => tickets.filter((t) => waiting.includes(t.lane)).sort(waitingOrder(waiting));

/** The three sets as the Card flow page lists them: the page's own words for what each one does. */
export const STATUS_GROUPS: { key: (typeof STATUS_KEYS)[number]; label: string; does: string }[] = [
  {
    key: "waiting",
    label: "Waits on you",
    does: "Every card in one of these is on the Waiting on you list, in this order.",
  },
  {
    key: "working",
    label: "A droid is working",
    does: "A machine holds the card: with no run behind it in a stale read, the row says so instead of the status.",
  },
  {
    key: "done",
    label: "Done",
    does: "The card is finished: not open work on the Work page, and not a wait.",
  },
];

/** The pill class each group's statuses wear on the Card flow page. */
export const STATUS_PILL: Record<(typeof STATUS_KEYS)[number], string> = {
  waiting: "warning",
  working: "agent",
  done: "ok",
};
