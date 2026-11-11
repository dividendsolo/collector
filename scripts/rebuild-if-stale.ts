#!/usr/bin/env bun
/**
 * Rebuild the live Collector when the build it serves is behind `main` (card #29), and put the finished build in
 * service with no click (card #122).
 *
 *     bun scripts/rebuild-if-stale.ts --dir /Users/me/code/collector
 *     bun scripts/rebuild-if-stale.ts --check        # say what it would do, touch nothing
 *     bun scripts/rebuild-if-stale.ts --restart "echo restarted"   # a test's stand-in for the restart
 *
 * The launchd job `com.james.collector-rebuild` runs this every five minutes (`launchd/`). It is quiet when the
 * page is current and says one line for each step it takes: it pulls when the checkout is behind, builds into
 * `.next-rebuild` beside the served `.next`, then runs `scripts/apply-update.ts`: the swap into `.next` and the restart
 * of the serving job, so open pages reload onto the new build. That is at most one restart per new commit on main, and
 * never two within `RESTART_GAP_MS` (five minutes): a build that lands sooner stays staged and the next run puts it in
 * service. Card #41 had put a click between the build and the restart (46 restarts on 2026-10-29, most by hand); James
 * dropped the click on 2026-11-11 (card #122). A failed build or a failed pull is logged and leaves the served `.next`
 * as it was, with nothing restarted — never a half-built page. `--check` is the read-only form: no fetch, no pull, no
 * build, no restart.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchOrigin,
  lastLine,
  lastRestart,
  markRestart,
  option,
  readStamp,
  rebuildPlan,
  restartWait,
  runGit,
  SERVED,
  STAGING,
  short,
  writeStamp,
} from "../lib/rebuild";
import { pendingCommit } from "../lib/update";

const say = (line: string) => console.log(`[rebuild] ${line}`);
const warn = (line: string) => console.error(`[rebuild] ${line}`);

const argv = process.argv.slice(2);
/** The ceiling on the job's two long commands, so a hung install or build cannot hold it open (repo standard S2):
 * five minutes for `bun install`, fifteen for `next build` — both far past anything a healthy machine takes. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;
/** The ceiling on the swap and restart (`scripts/apply-update.ts`, whose restart has its own one-minute ceiling). */
const APPLY_TIMEOUT_MS = 2 * 60_000;
/** The checkout to keep built: this script's own checkout, which is the folder the serving plist points at. */
const dir = path.resolve(option(argv, "dir") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
/** Say what a run would do and change nothing. */
const check = argv.includes("--check");

const head = runGit(dir, "rev-parse", "HEAD");
if (!head.ok) {
  warn(`${dir} is not a git checkout (${lastLine(head.err)}): nothing to rebuild`);
  process.exit(1);
}
if (!check) {
  const fetched = fetchOrigin(dir);
  if (!fetched.ok) warn(`could not fetch origin/main (${lastLine(fetched.err)}): reading the last fetch`);
}
const main = runGit(dir, "rev-parse", "origin/main");
if (!main.ok || !main.out) {
  warn(`${dir} has no origin/main to compare a build with (${lastLine(main.err)}): nothing to rebuild`);
  process.exit(1);
}

const staging = path.join(dir, STAGING);
const served = readStamp(dir);
const staged = readStamp(dir, STAGING);
/** A staged build of a commit other than main while the page already serves main: swapping it in would serve
 * something older, and the next main would build over it anyway. Only reachable when the page was restarted by hand. */
const leftover = staged !== null && served?.commit === main.out && staged.commit !== main.out;
if (leftover && !check) {
  fs.rmSync(staging, { recursive: true, force: true });
  say(`removed a staged build of ${short(staged.commit)}: the page already serves ${short(main.out)}`);
}
/** The build the page serves once the staged one is in service: the staged one when it waits, else the served one. */
const pending = leftover ? (served?.commit ?? null) : pendingCommit(dir);
/** A build of main, staged and waiting for its restart: a run that came too soon after the last restart left it. */
const waiting = !leftover && staged !== null && staged.commit === main.out;

/** Put the staged build in service: the swap and the restart `scripts/apply-update.ts` makes, unless the page
 * restarted less than `RESTART_GAP_MS` ago, when the build stays staged for the next run. Ends the run. */
function putInService(commit: string): never {
  const wait = restartWait(lastRestart(dir));
  if (wait > 0) {
    say(
      `${short(commit)} stays staged: the page restarted less than five minutes ago, so a run in ${Math.ceil(wait / 60_000)} min puts it in service`,
    );
    process.exit(0);
  }
  const args = [path.join(path.dirname(fileURLToPath(import.meta.url)), "apply-update.ts"), "--dir", dir];
  for (const name of ["label", "restart"]) {
    const value = option(argv, name);
    if (value) args.push(`--${name}`, value);
  }
  const applied = spawnSync(process.execPath, args, { cwd: dir, stdio: "inherit", timeout: APPLY_TIMEOUT_MS });
  if (applied.status !== 0) {
    warn(
      `could not put ${short(commit)} in service (scripts/apply-update.ts exited ${applied.status ?? applied.signal})`,
    );
    process.exit(1);
  }
  markRestart(dir);
  process.exit(0);
}

const plan = rebuildPlan({ built: pending, head: head.out, main: main.out });
if (!plan) {
  if (waiting && !check) putInService(main.out);
  if (check) {
    say(
      waiting
        ? `a build of ${short(main.out)} is staged: would swap it in and restart the page${restartWait(lastRestart(dir)) > 0 ? " once five minutes have passed since the last restart" : ""}`
        : `the page's build is ${short(main.out)}, the commit origin/main is at: nothing to do`,
    );
  }
  process.exit(0);
}

const branch = runGit(dir, "rev-parse", "--abbrev-ref", "HEAD").out || "(no branch)";
if (branch !== "main") {
  warn(`${dir} is on ${branch}, not main: not rebuilding (this job only ever pulls and builds main)`);
  process.exit(1);
}
say(`${check ? "would rebuild" : "rebuilding"}: ${plan.why}; origin/main is at ${short(main.out)}`);
if (check) {
  say(
    `would ${plan.pull ? "pull, " : ""}build into ${path.join(dir, STAGING)}, then swap it into ${SERVED} and restart the page`,
  );
  process.exit(0);
}

if (plan.pull) {
  const pulled = runGit(dir, "pull", "--ff-only", "--quiet", "origin", "main");
  if (!pulled.ok) {
    warn(
      `could not fast-forward to ${short(main.out)} (${lastLine(pulled.err)}): the page keeps serving its old build`,
    );
    process.exit(1);
  }
  say(`pulled to ${short(main.out)}`);
}

// Install what the lockfile asks for before every build: a commit that adds a package fails `next build` with
// "module not found" until the package is installed (3021658 added @viz-js/viz, 2026-11-02). With nothing new to
// install this takes a few milliseconds; `--frozen-lockfile` installs exactly what main's lockfile says. The
// timeout is a ceiling nothing normal comes near: it is there so a hung install cannot hold the job (repo standard S2).
const installed = spawnSync(process.execPath, ["install", "--frozen-lockfile"], {
  cwd: dir,
  encoding: "utf8",
  timeout: INSTALL_TIMEOUT_MS,
});
if (installed.status !== 0) {
  warn(
    `bun install failed (${lastLine(`${installed.stdout || ""}${installed.stderr || ""}`)}): the page keeps serving its old build`,
  );
  process.exit(1);
}

// Build beside the served `.next`, never in it: `next build` empties its own folder before it compiles, so a build in
// place would leave the page with no build for as long as the build takes, and with none at all when it fails.
// `next.config.ts` reads COLLECTOR_DIST_DIR; `postbuild` stamps the same folder. The served `.next` is not touched
// until the build has finished: a failed build never reaches the swap, so it changes nothing and restarts nothing.
fs.rmSync(staging, { recursive: true, force: true });
const since = Date.now();
const built = spawnSync(process.execPath, ["run", "build"], {
  cwd: dir,
  encoding: "utf8",
  timeout: BUILD_TIMEOUT_MS,
  env: { ...process.env, COLLECTOR_DIST_DIR: STAGING },
});
const secs = Math.round((Date.now() - since) / 1000);
if (built.status !== 0) {
  const said = `${built.stdout || ""}${built.stderr || ""}`
    .split("\n")
    .filter((l) => l.trim())
    .slice(-3)
    .join(" | ");
  fs.rmSync(staging, { recursive: true, force: true });
  warn(`build failed after ${secs} s: ${said}: the page keeps serving its old build`);
  process.exit(1);
}

const now = runGit(dir, "rev-parse", "HEAD").out || head.out;
say(`built ${short(now)} in ${secs} s`);
if (readStamp(dir, STAGING)?.commit !== now) {
  // `bun run build` records its own commit (postbuild). A build that did not would be rebuilt every five minutes.
  writeStamp(dir, now, new Date(), STAGING);
  warn(`the build did not record its own commit: stamped ${short(now)} here, so it is not built twice`);
}
putInService(now);
