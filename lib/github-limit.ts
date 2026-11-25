export const PER_MINUTE_WINDOW_S = 600;

export type RefusalLimit = "hourly" | "minute";

export interface GithubRefusal {
  at: number;
  limit: RefusalLimit;
  retryAfter: number | null;
}

export function refusalKind(message: string | null | undefined, remaining: number | null | undefined): RefusalLimit {
  if (/secondary/i.test(message ?? "")) return "minute";
  return remaining === 0 ? "hourly" : "minute";
}

export function retryAfterSeconds(text: string | null | undefined): number | null {
  const m = /retry-after:\s*(\d+)/i.exec(text ?? "");
  return m ? Number(m[1]) : null;
}

export const HOURLY_WINDOW_S = 3600;

export function recentRefusal(
  refusal: GithubRefusal | null | undefined,
  now: number,
  hourlyReset?: number | null,
): GithubRefusal | null {
  if (!refusal) return null;
  if (now - refusal.at > PER_MINUTE_WINDOW_S) return null;
  const hourlyWindowStart = hourlyReset == null ? null : hourlyReset - HOURLY_WINDOW_S;
  if (refusal.limit === "hourly" && hourlyWindowStart != null && refusal.at < hourlyWindowStart) return null;
  return refusal;
}

export function clearsText(retryAfter: number | null | undefined): string {
  if (retryAfter == null || retryAfter <= 0) return "clears in a few minutes";
  return `clears in about ${Math.max(1, Math.round(retryAfter / 60))} min`;
}
