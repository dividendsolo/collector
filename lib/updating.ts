/**
 * The Update button restarts the server on purpose, so for a short while every read fails. Those failures are the
 * restart, not an outage (James, 2026-11-06: "It should never say can't fetch while it's updating"). The click is
 * kept in sessionStorage, so it still counts after the page reloads in the middle of the restart.
 */
const KEY = "collector.updating-since";

/** How long after a click a failed read is still the restart: the button's own give-up note waits 60 s. */
export const UPDATE_GRACE_MS = 90_000;

export function markUpdating(now = Date.now()) {
  sessionStorage.setItem(KEY, String(now));
}

export function clearUpdating() {
  sessionStorage.removeItem(KEY);
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
