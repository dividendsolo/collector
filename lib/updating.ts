const KEY = "collector.updating-since";

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

export function downText(e: unknown, now = Date.now()): string {
  if (updating(now)) return "Restarting on the new build…";
  return `Could not reach the Collector server: ${(e as Error)?.message ?? e}`;
}
