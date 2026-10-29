import { duration, prio } from "./format";

/** One live agent or script run, as the machines report it. */
export interface WorkRun {
  /** `agent`, `script`, or `leftover`: a process left in a card's worktree that nothing is working for. */
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
  /** A session whose process runs inside tmux (`collect.py`, collector#37): its Running for cell reads `tmux`. */
  tmux?: boolean | null;
  /** The TCP port a leftover process listens on, when the machine shows one (`ss` on Linux, `lsof` on a Mac). */
  port?: number | null;
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

/** The name a run's row shows: the droid is "Lab droid", a process left in a card's worktree is the program it runs
 * with the port it listens on ("bun start :4123") — never the work script's name, which it is not (collector#32) —
 * every other run the name it reported, or "unknown". */
export const runName = (r: {
  name?: string | null;
  repo?: string | null;
  kind?: string | null;
  port?: number | null;
}) => (labRun(r) ? "Lab droid" : `${r.name || "unknown"}${r.port ? ` :${r.port}` : ""}`);

/** A Claude Code or Codex session: a live run that waits on the person at the keyboard, not a card's build. */
export const isSession = (r: { kind?: string | null }) => r.kind === "session";

/** What a session row's Machine cell says (James, 2026-10-25, card #29: "I said local for those, not the machine
 * name"). Current work already says it for a card worked by hand. */
export const SESSION_MACHINE = "local";

/** What a session row's Running for cell says: it waits on the person, so its length says nothing about it and a
 * real duration there read as a stuck run (James, 2026-10-25, card #29). */
export const SESSION_TIME = "interactive";

/** What it says instead when the session runs inside tmux (James, 2026-10-29, card #37): the row tells where the
 * session runs, which `interactive` alone did not — his tmux `Work` window read the same as any other session. */
export const SESSION_TMUX = "tmux";

/** The Machine cell of a run: `local` for a session, the machine the run is on for everything else. */
export const runMachine = (r: { kind?: string | null; machine?: string | null }) =>
  isSession(r) ? SESSION_MACHINE : r.machine || "";

/** The Running for cell of a run: `interactive` for a session — `tmux` when it runs inside tmux — its own length
 * for everything else. */
export const runTime = (r: { kind?: string | null; seconds: number; tmux?: boolean | null }) =>
  isSession(r) ? (r.tmux ? SESSION_TMUX : SESSION_TIME) : duration(r.seconds);

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

/** The lanes that say a machine or a session holds the card. Their name is never the State cell: a live run shows
 * its own badge, a `local` card shows the session's, and a claim with neither shows `no run` (agent-stack#187 read
 * agent-in-progress for 4 days with nothing behind it; James, 2026-10-29: "if it truly is, then the agent badge
 * would show"). */
const CLAIM_LANES = new Set(["agent-in-progress", "verify-in-progress"]);

/** Seconds after which the page's machine snapshot is stale: the server reads every 10 s and the page asks every
 * 15 s, so a snapshot past 45 s means reads are failing, not slow. */
export const STALE_SECONDS = 45;

/** How old the run data behind the page is. `page`: the snapshot's age when it is past STALE_SECONDS (the server
 * stopped answering), else null. `machines`: each machine whose last read failed, by the age of its last good read
 * (null: never read). `names`: every machine, to tell a card's host label from its other labels. */
export interface Staleness {
  page: number | null;
  machines: Record<string, number | null>;
  names: string[];
}

interface SnapMachine {
  name: string;
  stale?: boolean;
  read_at?: number | null;
}

/** The staleness of `/api/state`'s answer at `now` (seconds). */
export function staleness(state: { at?: number; machines?: SnapMachine[] } | null, now = Date.now() / 1000) {
  const age = state?.at ? now - state.at : null;
  const machines: Record<string, number | null> = {};
  for (const m of state?.machines || []) if (m.stale) machines[m.name] = m.read_at ? now - m.read_at : null;
  return {
    page: age !== null && age > STALE_SECONDS ? age : null,
    machines,
    names: (state?.machines || []).map((m) => m.name),
  } satisfies Staleness;
}

const ago = (s: number) => (s < 60 ? `${Math.round(s)} s` : duration(s));

/** Why a claim with no run joined may be wrong: the stale data it was matched against, or null when the data is
 * fresh and `no run` is the truth. A card's host label (`ezio`, `altair`) names the machine to ask about; a card
 * with none is matched against every machine, so any stale one counts. */
function staleText(card: WorkCard | null, stale?: Staleness): string | null {
  if (!stale) return null;
  if (stale.page !== null) return `stale ${ago(stale.page)}`;
  const host = card?.labels?.find((l) => stale.names.includes(l));
  const name = host ?? Object.keys(stale.machines)[0];
  if (!name || !(name in stale.machines)) return null;
  const age = stale.machines[name];
  return age === null ? `${name} unread` : `${name} stale ${ago(age)}`;
}

/** What a card row's State cell shows when no run joined it: `session` (an interactive session holds it), `no run`
 * (a claim lane with nothing running), the stale data a claim was matched against instead of `no run` (card #41:
 * builds running on ezio read `no run` while the page held a snapshot minutes old), or the lane itself. */
export const cardState = (
  row: Pick<WorkRow, "state" | "local" | "run"> & { card?: WorkCard | null },
  stale?: Staleness,
) =>
  row.run
    ? null
    : row.local
      ? "session"
      : CLAIM_LANES.has(row.state)
        ? (staleText(row.card ?? null, stale) ?? "no run")
        : row.state;

/** Groups, top to bottom: live runs, cards in progress, review or merge, closed in the last hour, ready-for-agent, scheduled. */
const groupOf = (lane: string) =>
  REVIEW.has(lane) ? 1 : lane === "ready-for-agent" ? 3 : lane === "scheduled" ? 4 : 1;

/** Whether the page shows the card as being worked on: its own row is with the live work or the work in review
 * (groups 0-1). A closed, ready-for-agent or scheduled card moves nothing along. */
const moving = (r: WorkRow) => r.group < 2;

/** The `repo#number` a `Waiting on:` ref names. A bare `#12` is the holding card's own repo, as parseHold wrote
 * it; anything else is already `repo#12`. */
const holdKey = (ref: string, repo: string) => (ref.startsWith("#") ? `${repo}${ref}` : ref);

/** The refs of a scheduled row's `Waiting on:` line that the page is working on right now. Empty: not on deck.
 * Only a row in the scheduled group (4) can be on deck: a scheduled card with a live run or the `local` label is
 * live work (group 0) and keeps the live order. */
const deckOf = ({ group, card }: WorkRow, working: Set<string>) =>
  group === 4 && card?.hold?.after.length
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
    const after = deckOf(row, working);
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
