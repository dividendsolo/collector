import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";

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

export function resetFirstSeen() {
  cache = null;
}

export function firstSeen(keys: string[], now = Date.now() / 1000): Record<string, number> {
  const old = load();
  const next: Seen = {};
  for (const k of keys) next[k] = old[k] ?? now;
  const changed = keys.length !== Object.keys(old).length || keys.some((k) => !(k in old));
  if (changed) {
    cache = next;
    try {
      fs.writeFileSync(FIRST_SEEN_PATH, `${JSON.stringify(next)}\n`);
    } catch {}
  }
  return next;
}
