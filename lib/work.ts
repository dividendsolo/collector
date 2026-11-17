import { duration, prio } from "./format";
import { AGENT_STACK_STATUSES } from "./statuses";

export interface WorkRun {
  type: string;
  name?: string;
  model?: string;
  provider?: string;
  kind: string;
  feature?: string;
  machine: string;
  card?: number | null;
  repo?: string | null;
  seconds: number;
  tmux?: boolean | null;
  port?: number | null;
}

export const LAB = {
  marker: "lab",
  repo: "agent-stack",
  card: 111,
  url: "https://github.com/dividendsolo/agent-stack/issues/111",
} as const;

export const labRun = (r: { repo?: string | null; kind?: string | null }) =>
  r.repo === LAB.marker && r.kind === LAB.marker;

export const runName = (r: {
  name?: string | null;
  repo?: string | null;
  kind?: string | null;
  port?: number | null;
}) => (labRun(r) ? "Lab droid" : `${r.name || "unknown"}${r.port ? ` :${r.port}` : ""}`);

export const isSession = (r: { kind?: string | null }) => r.kind === "session";

export const SESSION_MACHINE = "local";

export const SESSION_TIME = "interactive";

export const SESSION_TMUX = "tmux";

export const runMachine = (r: { kind?: string | null; machine?: string | null }) =>
  isSession(r) ? SESSION_MACHINE : r.machine || "";

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
  hold?: { after: { ref: string; url: string }[]; from: string | null; why: string | null; to?: string | null } | null;
  blockers?: { ref: string; url: string }[];
  closed_at?: number;
  labels?: string[];
}

export const BLOCKED = "blocked";

export const waitsOn = (card: WorkCard | null | undefined): { ref: string; url: string }[] =>
  !card ? [] : card.lane === BLOCKED ? (card.blockers ?? []) : (card.hold?.after ?? []);

export interface WorkRow {
  key: string;
  group: number;
  state: string;
  card: WorkCard | null;
  run: WorkRun | null;
  local?: boolean;
  onDeck?: string[];
}

export const STALE_SECONDS = 45;

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

function staleText(card: WorkCard | null, stale?: Staleness): string | null {
  if (!stale) return null;
  if (stale.page !== null) return `stale ${ago(stale.page)}`;
  const host = card?.labels?.find((l) => stale.names.includes(l));
  const name = host ?? Object.keys(stale.machines)[0];
  if (!name || !(name in stale.machines)) return null;
  const age = stale.machines[name];
  return age === null ? `${name} unread` : `${name} stale ${ago(age)}`;
}

export const cardState = (
  row: Pick<WorkRow, "state" | "local" | "run"> & { card?: WorkCard | null },
  stale?: Staleness,
  working: string[] = AGENT_STACK_STATUSES.working,
) =>
  row.run
    ? null
    : row.state === "closed"
      ? "closed in the last hour"
      : row.local
        ? "session"
        : working.includes(row.state)
          ? (staleText(row.card ?? null, stale) ?? row.state)
          : row.state;

const groupOf = (lane: string) => (lane === "ready-for-agent" ? 3 : lane === "scheduled" || lane === BLOCKED ? 4 : 1);

const moving = (r: WorkRow) => r.group < 2;

const holdKey = (ref: string, repo: string) => (ref.startsWith("#") ? `${repo}${ref}` : ref);

const deckOf = ({ group, card }: WorkRow, working: Set<string>) =>
  group === 4 && card && waitsOn(card).length
    ? waitsOn(card)
        .filter((a) => working.has(holdKey(a.ref, card.repo)))
        .map((a) => a.ref)
    : [];

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
  const waitKind = (r: WorkRow) =>
    r.group !== 4 ? 0 : r.card?.lane === BLOCKED || r.card?.hold?.after.length ? 0 : r.card?.hold?.from ? 1 : 2;
  const fromDay = (r: WorkRow) => (r.group === 4 ? (r.card?.hold?.from ?? "") : "");
  for (const row of rows) {
    const after = deckOf(row, working);
    if (after.length) row.onDeck = after;
  }
  return rows.sort(
    (a, b) =>
      a.group - b.group ||
      deck(b) - deck(a) ||
      waitKind(a) - waitKind(b) ||
      fromDay(a).localeCompare(fromDay(b)) ||
      (b.run?.seconds ?? 0) - (a.run?.seconds ?? 0) ||
      prio(a.card?.priority) - prio(b.card?.priority) ||
      (a.card?.created ?? "").localeCompare(b.card?.created ?? ""),
  );
}

export const holdText = (h: WorkCard["hold"]) =>
  !h ? "" : h.after.length ? `after ${h.after.map((a) => a.ref).join(", ")}` : h.from ? `from ${h.from}` : "";

export function holdTip(h: WorkCard["hold"]): { title: string; text: string } | null {
  if (!h) return null;
  const why = h.why?.trim();
  if (why) return { title: "Why it waits", text: why };
  if (h.after.length)
    return { title: "Why it waits", text: `It waits until ${h.after.map((a) => a.ref).join(", ")} closes.` };
  if (!h.from) return null;
  return {
    title: "No reason given",
    text: `This card does not say why it waits, so it belongs in needs-info. It waits until ${h.from}${h.to ? `, then moves to ${h.to}` : ""}.`,
  };
}

export const holdLacksReason = (h: WorkCard["hold"]) => !!h && !h.after.length && !h.why?.trim();

export interface ClosedRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  closed_at: string;
}

export function closedRows(items: any[]): ClosedRow[] {
  return (items || [])
    .filter((i) => /\/issues\/\d+$/.test(i?.html_url || ""))
    .map((i) => ({
      repo: (i.html_url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//) || [])[1] || "",
      number: i.number,
      title: i.title,
      url: i.html_url,
      closed_at: i.closed_at,
    }))
    .sort((a, b) => b.closed_at.localeCompare(a.closed_at));
}
