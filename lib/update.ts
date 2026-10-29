/**
 * The Update button's own logic (card #41): the build the running server serves, the finished build the rebuild job
 * left staged beside it, and whether a click is worth offering.
 *
 * The rebuild job used to swap a new build into `.next` and kickstart the serving job, so the page went down for a
 * moment every time main moved and nobody chose when. It now builds into `.next-rebuild` and stops there; the page
 * offers the click, and `scripts/apply-update.ts` does the swap and the restart when it comes.
 *
 * Nothing in here runs a command or writes a file: it reads two folders and answers.
 */
import fs from "node:fs";
import path from "node:path";
import { readStamp, SERVED, STAGING } from "./rebuild";
import { ROOT } from "./server/paths";
import { once } from "./server/store";

/** The file `next start` names its build by, in the folder it serves. */
export const BUILD_FILE = "BUILD_ID";

/** One side of the swap: a build folder, by the id the page loads and the commit that made it. */
export interface Side {
  /** The BUILD_ID in the folder, null when it holds no build. */
  id: string | null;
  /** The commit its stamp records (`scripts/build-stamp.ts`), null when no build recorded one. */
  commit: string | null;
}

/** The BUILD_ID of a build folder, or null when there is nothing to read. */
function readId(build: string): string | null {
  try {
    return fs.readFileSync(path.join(build, BUILD_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The build a folder holds: the served one (`.next`) unless told otherwise. */
export function readSide(dir: string, folder = SERVED): Side {
  return { id: readId(path.join(dir, folder)), commit: readStamp(dir, folder)?.commit ?? null };
}

/** Two sides saying the same build: the id the page loads and the commit it was made from. */
export const sameBuild = (a: Side, b: Side) => a.id === b.id && a.commit === b.commit;

/**
 * The build this server process serves, captured at boot (`instrumentation.ts`). It is not the disk's answer:
 * `next start` reads its build once and holds it, so while the update's swap is in flight the folder says the new
 * build and this process still runs the old one. Reporting the folder then would reload an open page onto a build
 * the server is not running.
 *
 * It lives on `globalThis`, like every other piece of server state here (`lib/server/store.ts`): Next bundles
 * `instrumentation.ts` apart from the routes, so a module-level variable set at boot is invisible to a route — a
 * real click on 2026-10-29 found that out too.
 */
const BOOT_KEY = "__collector:running-build";

/** The boot record, made on first use in whichever bundle asks: `instrumentation.ts`'s or a route's. */
function boot(): { side: Side | null } {
  return once(BOOT_KEY, () => ({ side: null as Side | null }));
}

/** Record the build this process booted on. Called once, from `instrumentation.ts`, before the server answers. */
export function rememberServed(side: Side): void {
  boot().side = side;
}

/** The build the page is being served by: this process's own, else — a build with no BUILD_ID, as in dev — the disk. */
export function servedSide(dir = ROOT): Side {
  const served = boot().side;
  return served?.id ? served : readSide(dir, SERVED);
}

/** The finished build waiting for the click, null when none waits: the staging folder, when it holds a build. */
export function stagedSide(dir = ROOT): Side | null {
  const side = readSide(dir, STAGING);
  return side.id ? side : null;
}

/** What the page's button asks: the build the server runs, the one staged for it, and whether to offer the click. */
export interface Update {
  running: Side;
  staged: Side | null;
  ready: boolean;
}

/** The state of the two builds. `running` is passed in only by tests: the server reads its own, captured at boot. */
export function updateState(dir = ROOT, running: Side = servedSide(dir)): Update {
  const staged = stagedSide(dir);
  return { running, staged, ready: staged !== null && !sameBuild(staged, running) };
}

/** The commit the page would serve after a click: the staged build's when one waits, else the served one's. */
export function pendingCommit(dir = ROOT): string | null {
  return stagedSide(dir)?.commit ?? readSide(dir, SERVED).commit;
}

/** What a click does, decided from the state alone: the route posts this and the page shows the reason. */
export type Click = { ok: true; commit: string | null } | { ok: false; why: string };

/** A click with a build waiting swaps and restarts; with none it changes nothing and says why. */
export function clickAction(state: Update): Click {
  if (!state.ready) {
    return { ok: false, why: state.staged ? "that build is already the one serving" : "no build is staged" };
  }
  return { ok: true, commit: state.staged?.commit ?? null };
}

/** How the page is restarted: whole, by the launchd job that serves it (`launchd/`, `CONTEXT.md`). */
export const restartCommand = (label = process.env.COLLECTOR_LABEL || "com.james.collector") =>
  `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/${label}`;

/**
 * The Bun that runs a script of ours. Not `process.execPath` on its own: the plist runs `bun run start`, whose
 * `next start` is a bin with a node shebang, so the server process is **node** — a real click on 2026-10-29 found
 * that out, and node cannot load a `.ts` script. This process's own Bun when Bun is the one running it, else the
 * first `bun` on PATH, which the serving plist puts first (`/Users/james/.bun/bin`). Null when there is none: the
 * click then has nothing to run the swap with, and says so instead of pretending.
 */
export function bunPath(execPath = process.execPath, pathVar = process.env.PATH || ""): string | null {
  if (path.basename(execPath).startsWith("bun")) return execPath;
  for (const dir of pathVar.split(":")) {
    if (!dir) continue;
    const at = path.join(dir, "bun");
    try {
      fs.accessSync(at, fs.constants.X_OK);
      return at;
    } catch {}
  }
  return null;
}
