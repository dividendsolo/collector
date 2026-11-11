/**
 * Priority tasks, in James's order (2026-11-11, "lock that"): each row has a group, and the groups go in this order.
 * Inside a group the rows keep the order the server finds them in.
 *
 * - cant-work: a product, an agent or Collector itself cannot work (a service or vendor down, a domain or HTTPS
 *   certificate running out, every AI plan out, a repo's checks red on main, Tailscale or Hermes stopped, a script
 *   looping or started twice, the tickets or a machine unreadable, a config setting that does nothing)
 * - security: a port open to the internet, a risky sshd setting
 * - triage: the cards waiting for a triage session (James: a card triaged can go straight to an agent)
 * - jobs: a failed job run, a watched agent failing or idle
 * - money: a renewal, a GitHub limit, X credits
 * - good-news: a job's good news
 */
export const PRIORITY_GROUPS = ["cant-work", "security", "triage", "jobs", "money", "good-news"] as const;
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
export function triageRow(tickets: { lane?: string | null; checking?: boolean }[]) {
  const n = tickets.filter((t) => t.lane === TRIAGE_LANE && !t.checking).length;
  if (!n) return null;
  return {
    level: "warn" as const,
    group: "triage" as const,
    text: `${n} ${n === 1 ? "card needs" : "cards need"} triage`,
    jump: "waiting-panel",
    filter: TRIAGE_LANE,
  };
}
