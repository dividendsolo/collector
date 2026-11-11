/**
 * The two builds of the live Collector (cards #41, #122): the one the running server serves, and the finished one the
 * rebuild job left staged beside it, which `scripts/apply-update.ts` swaps in before it restarts the server.
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

/** The finished build waiting to be swapped in, null when none waits: the staging folder, when it holds a build. */
export function stagedSide(dir = ROOT): Side | null {
  const side = readSide(dir, STAGING);
  return side.id ? side : null;
}

/** The commit the page serves once the staged build is in: the staged build's when one waits, else the served one's. */
export function pendingCommit(dir = ROOT): string | null {
  return stagedSide(dir)?.commit ?? readSide(dir, SERVED).commit;
}

/** How the page is restarted: whole, by the launchd job that serves it (`launchd/`, `CONTEXT.md`). */
export const restartCommand = (label = process.env.COLLECTOR_LABEL || "com.james.collector") =>
  `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/${label}`;
