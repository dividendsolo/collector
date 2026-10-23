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
 * session works the card by hand (the card's `local` label). */
export interface WorkRow {
  key: string;
  group: number;
  state: string;
  card: WorkCard | null;
  run: WorkRun | null;
  local?: boolean;
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

/** Every open card that is not waiting on James, the cards closed in the last hour, and every live run, one row
 * each. A run on a card joins that card's row. Live runs first (longest first), then by group, priority, oldest. */
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
  return rows.sort(
    (a, b) =>
      a.group - b.group ||
      (b.run?.seconds ?? 0) - (a.run?.seconds ?? 0) ||
      prio(a.card?.priority) - prio(b.card?.priority) ||
      (a.card?.created ?? "").localeCompare(b.card?.created ?? ""),
  );
}

/** "after #146, agent-stack#149" or "from 2026-11-01": why a scheduled card has not moved. */
export const holdText = (h: WorkCard["hold"]) =>
  !h ? "" : h.after.length ? `after ${h.after.map((a) => a.ref).join(", ")}` : h.from ? `from ${h.from}` : "";
