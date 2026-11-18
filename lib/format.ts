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

const DOING: Record<string, string> = {
  build: "building",
  review: "reviewing",
  verify: "verifying",
  regate: "verifying",
  leftover: "left behind",
};
export const doing = (kind: string) => DOING[kind] || kind;

const WORK_DOING: Record<string, string> = {
  building: "with the builder",
  reviewing: "with the reviewer",
};

export const runDoing = (r: { type?: string | null; kind?: string | null }): string =>
  (r.type === "script" ? WORK_DOING[r.kind || ""] : undefined) || doing(r.kind || "");

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

export type JobStatus = "OK" | "Failed" | "Warning" | "Acknowledged" | "Paused" | "Done";
type JobLike = {
  enabled?: boolean;
  state?: string;
  last_status?: string | null;
  machine?: string;
  name?: string;
  last_run_at?: string | null;
};

export const ackKey = (j: JobLike) => `${j.machine ?? ""}|${j.name ?? ""}|${j.last_run_at ?? ""}`;

export function status(j: JobLike, acks: string[] = []): JobStatus {
  if (!j.enabled) return j.state === "completed" ? "Done" : "Paused";
  if (!j.last_status || j.last_status.startsWith("ok")) return "OK";
  if (acks.includes(ackKey(j))) return "Acknowledged";
  if (j.last_status === "delivery_failed") return "Warning";
  return "Failed";
}
export const STATUS_RANK: Record<JobStatus, number> = {
  Failed: 0,
  Warning: 1,
  Acknowledged: 2,
  OK: 3,
  Paused: 4,
  Done: 5,
};

export const failingJobs = <T extends JobLike>(jobs: T[], acks: string[]): T[] =>
  jobs.filter((j) => ["Failed", "Warning"].includes(status(j, acks)));

export const historyless = (j: { history?: boolean }) => j.history === false;

export function lastResult(j: { history?: boolean; last_status?: string | null }): string {
  return historyless(j) ? "no history" : j.last_status || "—";
}

export const shortRole = (role?: string | null) =>
  (role || "")
    .replace(/\s*\(.*?\)/g, "")
    .split(/[:;]/)[0]
    .replace(/^The /, "")
    .slice(0, 60);

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export function bytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1e6) return `${Math.round(n / 1000)} kB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export const prio = (p?: string | null) => (p ? +p.slice(1) : 9);

export function daysAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const n = Math.floor((now - new Date(iso).getTime()) / 864e5);
  return n < 1 ? "today" : `${n} ${n === 1 ? "day" : "days"} ago`;
}

export const money = (n: number, cur = "USD") =>
  new Intl.NumberFormat([], { style: "currency", currency: cur }).format(n);

export const monthly = (x: { billing?: string; amount: number }) => (x.billing === "annual" ? x.amount / 12 : x.amount);

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

export function fetchedText(at: number | null | undefined): string {
  return at ? `Fetched ${new Date(at * 1000).toLocaleTimeString()}` : "";
}

export const AI_LOW_PERCENT = 10;

export const limitLow = (used: number) => 100 - used <= AI_LOW_PERCENT;

export function resetText(iso: string | null | undefined, now = Date.now()): string {
  const raw = new Date(iso || "").getTime();
  if (Number.isNaN(raw)) return "";
  const t = new Date(Math.round(raw / 60_000) * 60_000);
  const h = t.getHours() % 12 || 12;
  const m = t.getMinutes();
  const time = `${h}${m ? `:${String(m).padStart(2, "0")}` : ""} ${t.getHours() < 12 ? "AM" : "PM"}`;
  const ahead = t.getTime() - now;
  if (ahead < 864e5) return time;
  if (ahead > 6 * 864e5) return t.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${DAYS[t.getDay()]} ${time}`;
}
