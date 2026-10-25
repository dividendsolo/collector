#!/usr/bin/env bun
/**
 * Rebuild the live Collector when the build it serves is behind `main` (card #29): on 2026-10-25 the page had been
 * serving a build from two days before, while `collect.py` — which runs from source on every request — sent it the
 * new session rows, and the old page drew them wrong.
 *
 *     bun scripts/rebuild-if-stale.ts --dir /Users/me/code/collector --label com.james.collector
 *     bun scripts/rebuild-if-stale.ts --check        # say what it would do, touch nothing
 *
 * The launchd job `com.james.collector-rebuild` runs this every five minutes (`launchd/`). It is quiet when the
 * page is current and says one line for each step it takes: it pulls when the checkout is behind, builds, and
 * restarts the serving job, which is what makes an open page reload itself. A failed build or a failed pull is
 * logged and leaves the old build serving — never a half-built page. `--check` is the read-only form: no fetch, no
 * pull, no build, no restart.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastLine, readStamp, rebuildPlan, runGit, short, writeStamp } from "../lib/rebuild";

const say = (line: string) => console.log(`[rebuild] ${line}`);
const warn = (line: string) => console.error(`[rebuild] ${line}`);

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  return i >= 0 && next && !next.startsWith("--") ? next : undefined;
};

/** The checkout to keep built: this script's own checkout, which is the folder the serving plist points at. */
const dir = path.resolve(flag("dir") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
/** The launchd job that serves the page: a build is nothing to the page until that job is restarted. */
const label = flag("label") || process.env.COLLECTOR_LABEL || "com.james.collector";
/** How the page is restarted, whole, for serving that is not a launchd job. */
const restart = flag("restart") || `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/${label}`;
/** Say what a run would do and change nothing. */
const check = argv.includes("--check");

const head = runGit(dir, "rev-parse", "HEAD");
if (!head.ok) {
  warn(`${dir} is not a git checkout (${lastLine(head.err)}): nothing to rebuild`);
  process.exit(1);
}
if (!check) {
  const fetched = runGit(dir, "fetch", "--quiet", "origin", "main");
  if (!fetched.ok) warn(`could not fetch origin/main (${lastLine(fetched.err)}): reading the last fetch`);
}
const main = runGit(dir, "rev-parse", "origin/main");
if (!main.ok || !main.out) {
  warn(`${dir} has no origin/main to compare a build with (${lastLine(main.err)}): nothing to rebuild`);
  process.exit(1);
}

const plan = rebuildPlan({ built: readStamp(dir)?.commit ?? null, head: head.out, main: main.out });
if (!plan) {
  if (check) say(`the page's build is ${short(main.out)}, the commit origin/main is at: nothing to do`);
  process.exit(0);
}

const branch = runGit(dir, "rev-parse", "--abbrev-ref", "HEAD").out || "(no branch)";
if (branch !== "main") {
  warn(`${dir} is on ${branch}, not main: not rebuilding (this job only ever pulls and builds main)`);
  process.exit(1);
}
say(`${check ? "would rebuild" : "rebuilding"}: ${plan.why}; origin/main is at ${short(main.out)}`);
if (check) {
  say(`would ${plan.pull ? "pull, " : ""}build in ${dir}, then restart: ${restart}`);
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

const since = Date.now();
const built = spawnSync(process.execPath, ["run", "build"], { cwd: dir, encoding: "utf8" });
const secs = Math.round((Date.now() - since) / 1000);
if (built.status !== 0) {
  const said = `${built.stdout || ""}${built.stderr || ""}`
    .split("\n")
    .filter((l) => l.trim())
    .slice(-3)
    .join(" | ");
  warn(`build failed after ${secs} s: ${said}: the page keeps serving its old build`);
  process.exit(1);
}

const now = runGit(dir, "rev-parse", "HEAD").out || head.out;
say(`built ${short(now)} in ${secs} s`);
if (readStamp(dir)?.commit !== now) {
  // `bun run build` records its own commit (postbuild). A build that did not would be rebuilt every five minutes.
  writeStamp(dir, now);
  warn(`the build did not record its own commit: stamped ${short(now)} here, so it is not built twice`);
}

const page = spawnSync("/bin/sh", ["-c", restart], { cwd: dir, encoding: "utf8" });
if (page.status !== 0) {
  warn(`built ${short(now)}, but could not restart the page (${restart}): ${lastLine(page.stderr || page.stdout)}`);
  process.exit(1);
}
say(`restarted: ${restart}`);
process.exit(0);
