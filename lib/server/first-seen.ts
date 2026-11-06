import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";

/** Where the first-seen times live: beside config.json, gitignored, so a restart keeps each row's age. */
export const FIRST_SEEN_PATH = process.env.COLLECTOR_FIRST_SEEN || path.join(ROOT, ".first-seen.json");

type Seen = Record<string, number>;
let cache: Seen | null = null;

function load(): Seen {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FIRST_SEEN_PATH, "utf8")) as Seen;
  } catch {
    cache = {};
  }
  return cache;
}

/** Test hook: forget the in-memory copy, so the next read comes from the file. */
export function resetFirstSeen() {
  cache = null;
}

/**
 * When each Needs attention row first showed up (James, 2026-11-06: "how long ago the attention notice showed up").
 * A row is keyed by its text, so a new failure (a new base SHA, a new date) is a new row with a new age. A key no
 * longer shown is dropped, so a row that clears and comes back starts again from zero. Returns epoch seconds per key.
 */
export function firstSeen(keys: string[], now = Date.now() / 1000): Record<string, number> {
  const old = load();
  const next: Seen = {};
  for (const k of keys) next[k] = old[k] ?? now;
  const changed = keys.length !== Object.keys(old).length || keys.some((k) => !(k in old));
  if (changed) {
    cache = next;
    try {
      fs.writeFileSync(FIRST_SEEN_PATH, `${JSON.stringify(next)}\n`);
    } catch {
      // A read-only folder loses the ages on restart, nothing more.
    }
  }
  return next;
}
