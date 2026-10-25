import { prio } from "./format";

/** One live agent or script run, as the machines report it. */
export interface WorkRun {
  type: string;
  name?: string;
  model?: string;
  provider?: string;
  kind: string;
  feature?: string;
  machine: string;
  /** The card the run works on. A Claude Code or Codex session outside a card worktree has none. */
  card?: number | null;
  /** The repo the run's folder is in. A session outside any repo has none, and the page says "no repo". */
  repo?: string | null;
  seconds: number;
}

/** The lab droid's own run (agent-stack#111): a headless Claude Code process under its own `lab` user on ezio,
 * working in its own home rather than a card worktree. Its row carries that marker repo and kind, and the card it
 * links to is the experiment's own card — not a card of the marker repo. */
export const LAB = {
  marker: "lab",
  repo: "agent-stack",
  card: 111,
  url: "https://github.com/dividendsolo/agent-stack/issues/111",
} as const;

/** Whether a run is the lab droid's own, which the panel draws in its own colour. */
export const labRun = (r: { repo?: string | null; kind?: string | null }) =>
  r.repo === LAB.marker && r.kind === LAB.marker;

/** The name a run's row shows: the droid is "Lab droid", every other run the name it reported, or "unknown". */
export const runName = (r: { name?: string | null; repo?: string | null; kind?: string | null }) =>
  labRun(r) ? "Lab droid" : r.name || "unknown";

export interface WorkCard {
  repo: string;
  number: number;
  title: string;
  url: string;
  lane: string;
  priority: string | null;
  created: string;
  hold?: { after: { ref: string; url: string }[]; from: string | null } | null;
  closed_at?: number;
  labels?: string[];
}

/** One Current work row: a card, a live run, or both. `group` orders the rows. `local`: an interactive
 * session works the card by hand (the card's `local` label). `onDeck`: the refs of a scheduled card's
 * `Waiting on:` line that are being worked on right now, which lifts the card to the top of its group. */
export interface WorkRow {
  key: string;
  group: number;
  state: string;
  card: WorkCard | null;
  run: WorkRun | null;
  local?: boolean;
  onDeck?: string[];
}

const REVIEW = new Set([
  "agent-in-progress",
  "verify-in-progress",
  "code-review",
  "changes-requested",
  "ready-to-merge",
  "merging",
]);

/** Groups, top to bottom: live runs, cards in progress, review or merge, closed in the last hour, ready-for-agent, scheduled. */
const groupOf = (lane: string) =>
  REVIEW.has(lane) ? 1 : lane === "ready-for-agent" ? 3 : lane === "scheduled" ? 4 : 1;

/** Whether the page shows the card as being worked on: its own row is with the live work or the work in review
 * (groups 0-1). A closed, ready-for-agent or scheduled card moves nothing along. */
const moving = (r: WorkRow) => r.group < 2;

/** The `repo#number` a `Waiting on:` ref names. A bare `#12` is the holding card's own repo, as parseHold wrote
 * it; anything else is already `repo#12`. */
const holdKey = (ref: string, repo: string) => (ref.startsWith("#") ? `${repo}${ref}` : ref);

/** The refs of a scheduled card's `Waiting on:` line that the page is working on right now. Empty: not on deck. */
const deckOf = (card: WorkCard, working: Set<string>) =>
  card.lane === "scheduled" && card.hold?.after.length
    ? card.hold.after.filter((a) => working.has(holdKey(a.ref, card.repo))).map((a) => a.ref)
    : [];

/** Every open card that is not waiting on James, the cards closed in the last hour, and every live run, one row
 * each. A run on a card joins that card's row. Live runs first (longest first), then by group, priority, oldest.
 * A scheduled card whose blocker is being worked on is on deck: `onDeck` names those refs and lifts the card to
 * the top of the scheduled group, ahead of the "Show all" cut. */
export function currentWork(
  cards: WorkCard[],
  closed: WorkCard[],
  runs: WorkRun[],
  waiting: string[],
  now = Date.now() / 1000,
): WorkRow[] {
  const rows: WorkRow[] = [];
  const byCard = new Map<string, WorkRow>();
  for (const c of cards) {
    if (waiting.includes(c.lane)) continue;
    const local = Boolean(c.labels?.includes("local"));
    const row: WorkRow = { key: c.url, group: local ? 0 : groupOf(c.lane), state: c.lane, card: c, run: null, local };
    byCard.set(`${c.repo}#${c.number}`, row);
    rows.push(row);
  }
  for (const c of closed) {
    if (c.closed_at == null || now - c.closed_at > 3600 || byCard.has(`${c.repo}#${c.number}`)) continue;
    rows.push({ key: `closed-${c.url}`, group: 2, state: "closed", card: c, run: null });
  }
  runs.forEach((r, i) => {
    const row = r.repo && r.card != null ? byCard.get(`${r.repo}#${r.card}`) : undefined;
    if (row && !row.run) {
      row.run = r;
      row.group = 0;
    } else rows.push({ key: `run-${r.machine}-${r.repo}-${r.card}-${i}`, group: 0, state: r.type, card: null, run: r });
  });
  const working = new Set(rows.filter(moving).map((r) => (r.card ? `${r.card.repo}#${r.card.number}` : "")));
  const deck = (r: WorkRow) => (r.onDeck ? 1 : 0);
  for (const row of rows) {
    const after = row.card ? deckOf(row.card, working) : [];
    if (after.length) row.onDeck = after;
  }
  return rows.sort(
    (a, b) =>
      a.group - b.group ||
      deck(b) - deck(a) ||
      (b.run?.seconds ?? 0) - (a.run?.seconds ?? 0) ||
      prio(a.card?.priority) - prio(b.card?.priority) ||
      (a.card?.created ?? "").localeCompare(b.card?.created ?? ""),
  );
}

/** "after #146, agent-stack#149" or "from 2026-11-01": why a scheduled card has not moved. */
export const holdText = (h: WorkCard["hold"]) =>
  !h ? "" : h.after.length ? `after ${h.after.map((a) => a.ref).join(", ")}` : h.from ? `from ${h.from}` : "";
