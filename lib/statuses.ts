import { prio } from "./format";

export interface StatusSets {
  waiting: string[];
  working: string[];
  done: string[];
}

export const AGENT_STACK_STATUSES: StatusSets = {
  waiting: ["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage"],
  working: ["agent-in-progress", "verify-in-progress"],
  done: ["closed"],
};

export interface StatusesConfig {
  statuses?: Partial<StatusSets> | null;
  tickets?: { each?: string[] } | null;
}

const set = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : fallback;

const inAgentStackOrder = (lanes: string[]) =>
  lanes
    .map((lane, i) => ({ lane, i, rank: waitingRank(AGENT_STACK_STATUSES.waiting, lane) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.lane);

export function statusSets(cfg: StatusesConfig = {}): StatusSets {
  const s = cfg.statuses || {};
  return {
    waiting: set(s.waiting, inAgentStackOrder(set(cfg.tickets?.each, AGENT_STACK_STATUSES.waiting))),
    working: set(s.working, AGENT_STACK_STATUSES.working),
    done: set(s.done, AGENT_STACK_STATUSES.done),
  };
}

export const AGENT_STACK_ALL = [
  "needs-triage",
  "needs-info",
  "ready-for-human",
  "scheduled",
  "blocked",
  "ready-for-agent",
  "agent-in-progress",
  "verify-in-progress",
  "code-review",
  "changes-requested",
  "needs-manual-qa",
  "ready-to-merge",
  "merging",
  "closed",
];

export const otherStatuses = (s: StatusSets) =>
  AGENT_STACK_ALL.filter((x) => !STATUS_KEYS.some((k) => s[k].includes(x)));

export const STATUS_KEYS = ["waiting", "working", "done"] as const;

export const isAgentStack = (s: StatusSets) => STATUS_KEYS.every((k) => s[k].join() === AGENT_STACK_STATUSES[k].join());

export const waitingRank = (waiting: string[], lane?: string | null) => {
  const i = waiting.indexOf(lane || "");
  return i < 0 ? waiting.length : i;
};

export const TRIAGE_FIRST = "needs-triage";

export const waitingOrder =
  (waiting: string[]) =>
  (a: { priority?: string | null; lane?: string | null; created?: string | null }, b: typeof a) =>
    Number(a.lane !== TRIAGE_FIRST) - Number(b.lane !== TRIAGE_FIRST) ||
    prio(a.priority) - prio(b.priority) ||
    waitingRank(waiting, a.lane) - waitingRank(waiting, b.lane) ||
    (a.created || "").localeCompare(b.created || "");

export const WAITING_CHECK_LABEL = "waiting-check";

export const waitingList = <
  T extends { lane: string; priority?: string | null; created?: string | null; checking?: boolean },
>(
  tickets: T[],
  waiting: string[],
) => tickets.filter((t) => waiting.includes(t.lane) && !t.checking).sort(waitingOrder(waiting));

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

export const STATUS_PILL: Record<(typeof STATUS_KEYS)[number], string> = {
  waiting: "warning",
  working: "agent",
  done: "ok",
};
