/** Formatting shared by every page: the same words and numbers the old page showed. */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ago(when: string | number | Date | null | undefined, now = Date.now()): string {
  if (!when) return "—";
  const s = Math.max(0, Math.round((now - new Date(when).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The task as a gerund: "building", not "build". */
const DOING: Record<string, string> = {
  build: "building",
  review: "reviewing",
  verify: "verifying",
  regate: "verifying",
  // A process left in a card's worktree: it is nobody's work, so its row says what it is (collector#32).
  leftover: "left behind",
};
export const doing = (kind: string) => DOING[kind] || kind;

/** The work script's own step words, as its own row reads them. Its step files say `building` while the card is out
 * with a builder and `reviewing` while a reviewer has it, and those two words belong to the agent's own row: on the
 * script's row they read as the script building the card, which is what James saw (2026-10-25, collector#32:
 * "Foreman should never show building. Foreman's never building, it's doing something other than that"). Its own
 * steps — preparing, verifying, opening the PR, saving work, merging — already say what the script does. */
const WORK_DOING: Record<string, string> = {
  building: "with the builder",
  reviewing: "with the reviewer",
};

/** What a run's row says it is doing: an agent's own gerund, the work script's step in the script's own words, or
 * that a process nothing is working for is left behind. */
export const runDoing = (r: { type?: string | null; kind?: string | null }): string =>
  (r.type === "script" ? WORK_DOING[r.kind || ""] : undefined) || doing(r.kind || "");

/** One run in a compact cell: the card it works on and what it is doing ("#21 building"). A run with no card —
 * a Claude Code or Codex session in a plain checkout — shows the tool's own name instead ("claude session"),
 * and never "#null" (card #21). */
export const runLabel = (r: {
  card?: number | null;
  kind?: string | null;
  name?: string | null;
  type?: string | null;
}) => {
  const task = runDoing(r);
  const tail = task ? ` ${task}` : "";
  return r.card == null ? `${r.name || "unknown"}${tail}` : `#${r.card}${tail}`;
};

export function duration(s: number): string {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** A cron or launchd schedule in words. A machine in another time zone than the first gets its zone after each time. */
export function schedule(raw: string | null | undefined, zone?: string, firstZone?: string): string {
  if (!raw) return "—";
  if (raw.startsWith("{") || raw.startsWith("[")) {
    const list = ([] as any[]).concat(JSON.parse(raw));
    const t = `${String(list[0].Hour ?? 0).padStart(2, "0")}:${String(list[0].Minute ?? 0).padStart(2, "0")}`;
    const days = list.map((c) => (c.Weekday === undefined ? "daily" : DAYS[c.Weekday % 7]));
    return `${days.length === 5 && days[0] === "Mon" ? "weekdays" : days.join(", ")} ${t}`;
  }
  const f = raw.split(" ");
  if (f.length !== 5) return raw;
  const [min, hour, , , dow] = f;
  const tz = zone && zone !== firstZone ? ` ${zone}` : "";
  if (raw === "* * * * *") return "every minute";
  if (min.startsWith("*/") && hour === "*") return `every ${min.slice(2)} min`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    const t = `${hour.padStart(2, "0")}:${min.padStart(2, "0")}${tz}`;
    if (dow === "*") return `daily ${t}`;
    if (dow === "1-5") return `weekdays ${t}`;
    if (/^\d$/.test(dow)) return `${DAYS[+dow]} ${t}`;
  }
  return raw;
}

export type JobStatus = "OK" | "Failed" | "Warning" | "Paused" | "Done";
export function status(j: { enabled?: boolean; state?: string; last_status?: string | null }): JobStatus {
  if (!j.enabled) return j.state === "completed" ? "Done" : "Paused";
  if (!j.last_status || j.last_status.startsWith("ok")) return "OK";
  if (j.last_status === "delivery_failed") return "Warning";
  return "Failed";
}
export const STATUS_RANK: Record<JobStatus, number> = { Failed: 0, Warning: 1, OK: 2, Paused: 3, Done: 4 };

/** A job whose scheduler keeps no run history at all: a plain crontab line, which records nothing about how its
 * runs went. Its row says so rather than reading as a failure (collect.py marks it `history: false`). */
export const historyless = (j: { history?: boolean }) => j.history === false;

/** A job's last result in words: its own last status, "no history" for a scheduler that keeps none, and a dash
 * for a job that has not run yet. */
export function lastResult(j: { history?: boolean; last_status?: string | null }): string {
  return historyless(j) ? "no history" : j.last_status || "—";
}

/** A note when config.json has none: the role's first clause, without the parentheses. */
export const shortRole = (role?: string | null) =>
  (role || "")
    .replace(/\s*\(.*?\)/g, "")
    .split(/[:;]/)[0]
    .replace(/^The /, "")
    .slice(0, 60);

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** P0 -> 0, P1 -> 1, none -> 9. */
export const prio = (p?: string | null) => (p ? +p.slice(1) : 9);

/** Days since a date: "today", "1 day ago", "5 days ago". */
export function daysAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const n = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return n < 1 ? "today" : `${n} ${n === 1 ? "day" : "days"} ago`;
}

export const money = (n: number, cur = "USD") =>
  new Intl.NumberFormat([], { style: "currency", currency: cur }).format(n);

/** Monthly amount of one subscription: annual charges count as a twelfth. */
export const monthly = (x: { billing?: string; amount: number }) => (x.billing === "annual" ? x.amount / 12 : x.amount);

/** Dollar amounts inside a sentence ("the $22/month plan"), split so each can blur with the eye button. */
export function moneyParts(text: string): { text: string; money: boolean }[] {
  const out: { text: string; money: boolean }[] = [];
  const re = /\$[\d,.]+(\/(month|mo|year|yr))?/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if ((m.index ?? 0) > last) out.push({ text: text.slice(last, m.index), money: false });
    out.push({ text: m[0], money: true });
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), money: false });
  return out;
}

/** Within one priority, the lanes James can finish fastest come first (James, 2026-10-22). */
const WAITING_LANES = ["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage"];
const laneRank = (l?: string | null) => {
  const i = WAITING_LANES.indexOf(l || "");
  return i < 0 ? WAITING_LANES.length : i;
};

/** Waiting on you: highest priority first, then lane (WAITING_LANES), then oldest. */
export const waitingOrder = (
  a: { priority?: string | null; lane?: string | null; created?: string | null },
  b: typeof a,
) =>
  prio(a.priority) - prio(b.priority) ||
  laneRank(a.lane) - laneRank(b.lane) ||
  (a.created || "").localeCompare(b.created || "");
