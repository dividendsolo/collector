import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { backoffDelay } from "./server/retry";

/**
 * The live Collector's own build (card #29). `bun run build` records the commit it was made from beside the build
 * (`scripts/build-stamp.ts`, run as `postbuild`), and `scripts/rebuild-if-stale.ts` — a small launchd job — compares
 * that commit with `main`: the page then pulls, builds and restarts itself after a merge instead of serving a
 * two-day-old build against new data. Nothing in here runs a command that writes to a checkout; the two scripts do.
 */

/** One git command in a checkout: its exit, its output, and git's own complaint when it failed. */
export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

/** A git command is given up on after this long: `fetch` and `pull` reach the network, and a hung one would hold
 * the rebuild job open forever (repo standard S2). */
export const GIT_TIMEOUT_MS = 60_000;

/** One git command in a checkout, its output kept as git wrote it, for the job's log and its checks. */
export function runGit(dir: string, ...args: string[]): GitResult {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  // A kill or a spawn failure leaves stderr empty; the timeout's own message is what the log should say instead.
  const err = (r.stderr || "").trim() || (r.error ? r.error.message : "");
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err };
}

/** A synchronous wait, for the one retry a `spawnSync` script does: there is no event loop here to yield to. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** How many tries `fetchOrigin` makes. */
export const FETCH_ATTEMPTS = 3;

/**
 * `git fetch origin main`, up to `FETCH_ATTEMPTS` tries with capped, jittered backoff — the one network call the
 * rebuild job makes itself, and a fetch is safe to ask again. The log keeps the last failure when every try fails,
 * and the caller reads the last fetch it did get, as it always has.
 */
export function fetchOrigin(dir: string, attempts = FETCH_ATTEMPTS): GitResult {
  let last: GitResult = { ok: false, out: "", err: "no fetch made" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = runGit(dir, "fetch", "--quiet", "origin", "main");
    if (last.ok) return last;
    if (attempt < attempts) sleepSync(backoffDelay(attempt + 1, { baseDelayMs: 500, maxDelayMs: 4000 }));
  }
  return last;
}

/** The last line git or a build wrote: what a failure's one log line can carry. */
export const lastLine = (text: string) =>
  (text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-1)[0] || "";

/** A commit as the log and the page name it. */
export const short = (commit: string) => commit.slice(0, 7);

/** A `--name value` flag out of a script's arguments: the value when it is there and is not another flag. */
export function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  return i >= 0 && next && !next.startsWith("--") ? next : undefined;
}

/** What a build recorded about itself, in `.next/collector-build.json` beside the build. */
export interface BuildStamp {
  /** The checkout's HEAD when the build ran. */
  commit: string;
  /** When that build finished, ISO. */
  built_at: string;
}

/** The folder the page serves its build from: what `next start` reads, and what the rebuild job swaps a finished
 * build into. */
export const SERVED = ".next";

/** Where the rebuild job builds (`COLLECTOR_DIST_DIR`, read by `next.config.ts`): beside the served build, never in it,
 * because `next build` empties its own folder before it compiles. */
export const STAGING = ".next-rebuild";

/** Where a build records its commit: with the build itself (`build` is the build's folder, `.next` unless the build
 * was pointed elsewhere), so a build that wiped its folder took its stamp with it and the next run knows the page
 * serves something older than main. */
export const stampPath = (dir: string, build = SERVED) => path.join(dir, build, "collector-build.json");

/** The stamp of the build in `dir`: null when nothing recorded one (a build from before this job existed, a wiped
 * `.next`, a build that failed), never an error — a missing stamp means "older than main", which is the safe read. */
export function readStamp(dir: string, build = SERVED): BuildStamp | null {
  let raw: string;
  try {
    raw = fs.readFileSync(stampPath(dir, build), "utf8");
  } catch {
    return null;
  }
  try {
    const s = JSON.parse(raw) as Partial<BuildStamp>;
    if (!s || typeof s.commit !== "string" || !s.commit) return null;
    return { commit: s.commit, built_at: typeof s.built_at === "string" ? s.built_at : "" };
  } catch {
    return null;
  }
}

/** Record the commit a build was made from. Called only after a build succeeded, so the stamp never names a commit
 * the page is not serving. */
export function writeStamp(dir: string, commit: string, at = new Date(), build = SERVED): BuildStamp {
  const stamp: BuildStamp = { commit, built_at: at.toISOString() };
  fs.mkdirSync(path.dirname(stampPath(dir, build)), { recursive: true });
  fs.writeFileSync(stampPath(dir, build), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

/**
 * Put a finished build where the page serves it: the served folder moves aside, the staged one takes its name, and
 * the old one is deleted. Two renames in one folder, so the page is without a build for the time between them, not
 * for the length of a build. Called only after the staged build succeeded; a build that failed never gets here, and
 * the served build is never touched.
 */
export function swapIn(dir: string, staged = STAGING, served = SERVED): void {
  const from = path.join(dir, staged);
  const to = path.join(dir, served);
  const old = path.join(dir, `${served}-previous`);
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(to)) fs.renameSync(to, old);
  fs.renameSync(from, to);
  fs.rmSync(old, { recursive: true, force: true });
}

/** The three commits the check reads: what the page's build was made from, the checkout's HEAD, and `origin/main`. */
export interface Commits {
  /** The commit the served build was made from (`readStamp`), null when no build recorded one. */
  built: string | null;
  /** The commit the checkout is at. */
  head: string;
  /** The commit the checkout has as `origin/main`. */
  main: string;
}

/** What the job has to do: pull the checkout first when it is behind, and build. */
export interface Rebuild {
  pull: boolean;
  build: boolean;
  /** Why, in one clause for the log. */
  why: string;
}

/**
 * "Is the build behind main": what the live Collector's build is missing, or null when the page already serves the
 * commit `origin/main` is at. The stamp is what makes a failed build safe: a build that fails leaves the old stamp
 * in place, so the next run builds again, while the old build keeps serving.
 */
export function rebuildPlan(c: Commits): Rebuild | null {
  if (c.built !== null && c.built === c.main) return null;
  return {
    pull: c.head !== c.main,
    build: true,
    why: c.built ? `the build was made from ${short(c.built)}` : "no build has recorded a commit",
  };
}

/** The rebuild job restarts the page at most once in this long (card #122): a main that moves twice in five
 * minutes leaves the second build staged, and the next run puts it in service. */
export const RESTART_GAP_MS = 5 * 60_000;

/** Where the job records when it last restarted the page onto a new build: in the served build, so the record goes
 * with the build it put in service. */
export const restartPath = (dir: string) => path.join(dir, SERVED, "collector-restarted.json");

/** When the job last restarted the page, in ms, null when no run recorded one. */
export function lastRestart(dir: string): number | null {
  try {
    const at = Date.parse((JSON.parse(fs.readFileSync(restartPath(dir), "utf8")) as { at?: string }).at ?? "");
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}

/** Record a restart onto the build now in `.next`. */
export function markRestart(dir: string, at = new Date()): void {
  fs.writeFileSync(restartPath(dir), `${JSON.stringify({ at: at.toISOString() })}\n`);
}

/** How long a staged build still has to wait for its restart: 0 when it can go in now. */
export const restartWait = (last: number | null, now = Date.now()) =>
  last === null ? 0 : Math.min(RESTART_GAP_MS, Math.max(0, last + RESTART_GAP_MS - now));
