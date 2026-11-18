const UNKNOWN_WAIT_MS = 5 * 60_000;
const MIN_WAIT_MS = 60_000;
const MAX_WAIT_MS = 3600_000;

export function isRateLimit(error: string): boolean {
  return /api rate limit|secondary rate limit|github rate limit/i.test(error);
}

export function boardLimitWait(limit: { reset?: number }, now = Date.now()): number {
  if (!limit.reset) return now + UNKNOWN_WAIT_MS;
  const until = limit.reset * 1000;
  return Math.min(Math.max(until, now + MIN_WAIT_MS), now + MAX_WAIT_MS);
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

const age = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};

export function limitText(boardAt: number, until: number, now = Date.now()): string {
  const board = boardAt
    ? `the board is from ${clock(boardAt)} (${age(now - boardAt)} old)`
    : "the board has not loaded yet";
  return `GitHub rate limit reached: ${board}; next read at ${clock(until)}`;
}
