/**
 * Priority tasks, in James's order (2026-11-11, "lock that"): each row has a group, and the groups go in this order.
 * Inside a group the rows keep the order the server finds them in.
 *
 * - cant-work: a product, an agent or Collector itself cannot work (a service or vendor down, a domain or HTTPS
 *   certificate running out, every AI plan out, a repo's checks red on main, Tailscale or Hermes stopped, a script
 *   looping or started twice, the tickets or a machine unreadable, a config setting that does nothing)
 * - security: a port open to the internet, a risky sshd setting
 * - triage: the cards waiting for a triage session (James: a card triaged can go straight to an agent)
 * - p0: each P0 card waiting on James, outside needs-triage (James, 2026-11-11)
 * - jobs: a failed job run, a watched agent failing or idle
 * - money: a renewal, a GitHub limit, X credits
 * - briefs: the unread briefs in the inbox (James, 2026-11-11)
 * - good-news: a job's good news
 */
export const PRIORITY_GROUPS = [
  "cant-work",
  "security",
  "p0",
  "triage",
  "jobs",
  "money",
  "briefs",
  "good-news",
] as const;
export type PriorityGroup = (typeof PRIORITY_GROUPS)[number];

/** The status the triage row counts. */
export const TRIAGE_LANE = "needs-triage";

/** The rows in group order; a stable sort, so a group keeps its own order. A row with no group goes last. */
export function priorityOrder<T extends { group?: PriorityGroup }>(rows: T[]): T[] {
  const rank = (r: T) => {
    const i = r.group ? PRIORITY_GROUPS.indexOf(r.group) : -1;
    return i < 0 ? PRIORITY_GROUPS.length : i;
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** The needs-triage row: how many cards wait for triage, and where they are (Waiting on you, filtered to them). Null
 * when none does. Built in the browser from the same board read Waiting on you uses, so the two always agree. */
export function triageRow(
  tickets: {
    lane?: string | null;
    checking?: boolean;
    repo?: string | null;
    number?: number | null;
    created?: string | null;
  }[],
) {
  const cards = tickets.filter((t) => t.lane === TRIAGE_LANE && !t.checking);
  const n = cards.length;
  if (!n) return null;
  // One card names itself, so it can be triaged at once (James, 2026-11-11).
  const one =
    n === 1 && cards[0].number
      ? `: ${String(cards[0].repo ?? "")
          .split("/")
          .pop()}#${cards[0].number}`
      : "";
  return {
    level: "warn" as const,
    group: "triage" as const,
    text: `${n} ${n === 1 ? "card needs" : "cards need"} triage${one}`,
    jump: "waiting-panel",
    filter: TRIAGE_LANE,
    // The age column: the oldest card's open time, the one that has waited longest (James, 2026-11-11).
    since: openedAt(cards),
    // One card: a Triage button that opens a session to triage it with James (James, 2026-11-11).
    ...(n === 1 && cards[0].repo && cards[0].number
      ? { triage: { repo: String(cards[0].repo), number: Number(cards[0].number) } }
      : {}),
  };
}

/** The unread briefs row: how many briefs in the inbox are not read yet, linking to the Briefs page. Null when none
 * is. Built in the browser from the same read as the Briefs page (James, 2026-11-11). */
export function briefsRow(inbox: { read?: boolean }[]) {
  const n = inbox.filter((b) => !b.read).length;
  if (!n) return null;
  return {
    level: "warn" as const,
    group: "briefs" as const,
    text: `${n} unread ${n === 1 ? "brief" : "briefs"}`,
    href: "#/briefs",
  };
}

/** One row per P0 card waiting on James, linking to the card (James, 2026-11-11). A P0 in needs-triage is counted
 * by the triage row instead, so no card shows twice. `tickets` is the Waiting on you list, already in its order. */
export function p0Rows(
  tickets: {
    lane?: string | null;
    priority?: string | null;
    repo?: string;
    number?: number;
    title?: string;
    url?: string;
    created?: string | null;
  }[],
) {
  return tickets
    .filter((t) => t.priority === "P0" && t.lane !== TRIAGE_LANE)
    .map((t) => ({
      level: "error" as const,
      group: "p0" as const,
      text: `P0: ${t.title} (${String(t.repo).split("/").pop()}#${t.number}, ${t.lane})`,
      url: t.url,
      since: openedAt([t]),
    }));
}

/** The earliest open time of these cards, in Unix seconds, for a row's age column; none when no card has one. */
function openedAt(cards: { created?: string | null }[]): number | undefined {
  const times = cards.map((c) => (c.created ? Date.parse(c.created) : Number.NaN)).filter((n) => !Number.isNaN(n));
  return times.length ? Math.min(...times) / 1000 : undefined;
}
