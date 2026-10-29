import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "@/lib/server/paths";
import { json } from "@/lib/server/respond";
import { bunPath, clickAction, updateState } from "@/lib/update";

export const dynamic = "force-dynamic";

/**
 * The page's Update button (card #41): the build this server process serves, the finished one the rebuild job staged
 * beside it, and whether a click is worth offering. Two small files read per ask, no caching.
 */
export const GET = () => json(updateState(ROOT));

/**
 * The click. The swap and the restart go to a script of its own, detached, so this answer reaches the page before the
 * restart takes the server away; the page then reloads itself once the new build answers (`components/data.tsx`'s
 * version poll). The script is TypeScript, so it needs Bun — resolved here rather than taken from
 * `process.execPath`, which is node when the plist's `bun run start` hands off to `next start`.
 */
export function POST() {
  const click = clickAction(updateState(ROOT));
  if (!click.ok) return json(click, 409);
  const bun = bunPath();
  if (!bun) return json({ ok: false, why: "no bun on PATH to run scripts/apply-update.ts" }, 500);
  try {
    spawn(bun, [path.join(ROOT, "scripts", "apply-update.ts"), "--dir", ROOT], {
      cwd: ROOT,
      detached: true,
      // The server's own streams: a process of its own would otherwise write the restart's `[update]` lines nowhere.
      stdio: "inherit",
    }).unref();
  } catch (e) {
    return json({ ok: false, why: (e as Error).message }, 500);
  }
  return json(click);
}
