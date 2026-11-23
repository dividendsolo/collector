export const PAGEROAST = "https://pageroast.dividendsolo.com";

export interface Roast {
  id: string;
  score: number;
  created: number;
}

export const roastLink = (id: string) => `${PAGEROAST}/r/${encodeURIComponent(id)}`;

export const roastDay = (created: number, timeZone?: string) =>
  new Date(created).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });

export const roastText = (r: Roast, timeZone?: string) => `Roast ${r.score} · ${roastDay(r.created, timeZone)}`;

export function asRoast(v: unknown): Roast | null {
  const r = v as Partial<Roast> | null;
  if (!r || typeof r !== "object") return null;
  if (typeof r.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) return null;
  if (typeof r.score !== "number" || !Number.isFinite(r.score) || r.score < 0 || r.score > 100) return null;
  if (typeof r.created !== "number" || !Number.isFinite(r.created)) return null;
  return { id: r.id, score: Math.round(r.score), created: r.created };
}
