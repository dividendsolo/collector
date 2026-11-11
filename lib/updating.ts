/**
 * The rebuild job restarts the server onto a new build (card #122), so for a short while every read fails. Those
 * failures are the restart, not an outage (James, 2026-11-06: "It should never say can't fetch while it's updating").
 * The server's SIGTERM tells the page (`/api/events`' `restarting` event), and the mark is kept in sessionStorage, so
 * it still counts after the page reloads in the middle of the restart.
 */
const KEY = "collector.updating-since";

/** How long after the server said it is restarting a failed read is still the restart. */
export const UPDATE_GRACE_MS = 90_000;

export function markUpdating(now = Date.now()) {
  sessionStorage.setItem(KEY, String(now));
}

export function updating(now = Date.now()): boolean {
  const since = Number(sessionStorage.getItem(KEY));
  if (!since) return false;
  if (now - since <= UPDATE_GRACE_MS) return true;
  sessionStorage.removeItem(KEY);
  return false;
}

/** What the top bar says when a read fails. */
export function downText(e: unknown, now = Date.now()): string {
  if (updating(now)) return "Restarting on the new build…";
  return `Could not reach the Collector server: ${(e as Error)?.message ?? e}`;
}
