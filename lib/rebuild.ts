import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

/** One git command in a checkout, its output kept as git wrote it, for the job's log and its checks. */
export function runGit(dir: string, ...args: string[]): GitResult {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

/** The last line git or a build wrote: what a failure's one log line can carry. */
export const lastLine = (text: string) =>
  (text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-1)[0] || "";

/** A commit as the log and the page name it. */
export const short = (commit: string) => commit.slice(0, 7);

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
