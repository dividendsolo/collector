#!/usr/bin/env bun
/**
 * Rebuild the live Collector when the build it serves is behind `main` (card #29), and leave the finished build
 * staged for the page's Update click (card #41).
 *
 *     bun scripts/rebuild-if-stale.ts --dir /Users/me/code/collector
 *     bun scripts/rebuild-if-stale.ts --check        # say what it would do, touch nothing
 *
 * The launchd job `com.james.collector-rebuild` runs this every five minutes (`launchd/`). It is quiet when the
 * page is current and says one line for each step it takes: it pulls when the checkout is behind, builds into
 * `.next-rebuild` beside the served `.next`, and stops there. It used to move that build into `.next` and kickstart
 * the serving job, which took the page down for a moment every time main moved and nobody chose when; now the page
 * offers a small Update button while a newer build waits, and one click swaps it in and restarts the server
 * (`scripts/apply-update.ts`, `GET`/`POST /api/update`). A failed build or a failed pull is logged and leaves the
 * served `.next` as it was — never a half-built page. `--check` is the read-only form: no fetch, no pull, no build.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastLine, option, readStamp, rebuildPlan, runGit, SERVED, STAGING, short, writeStamp } from "../lib/rebuild";
import { pendingCommit } from "../lib/update";

const say = (line: string) => console.log(`[rebuild] ${line}`);
const warn = (line: string) => console.error(`[rebuild] ${line}`);

const argv = process.argv.slice(2);
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
  const fetched = runGit(dir, "fetch", "--quiet", "origin", "main");
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
/** A staged build of a commit other than main while the page already serves main: the page would offer a build of
 * something older, and the next main would build over it anyway. Only reachable when the page was restarted by hand. */
const leftover = staged !== null && served?.commit === main.out && staged.commit !== main.out;
if (leftover && !check) {
  fs.rmSync(staging, { recursive: true, force: true });
  say(`removed a staged build of ${short(staged.commit)}: the page already serves ${short(main.out)}`);
}
/** The build the page would serve after the click: the staged one when it waits, else the served one. */
const pending = leftover ? (served?.commit ?? null) : pendingCommit(dir);
/** A build of main, staged and waiting for the click: nothing left to do until main moves again. */
const waiting = !leftover && staged !== null && staged.commit === main.out;
const servedName = served?.commit ? short(served.commit) : "a build with no stamp";

const plan = rebuildPlan({ built: pending, head: head.out, main: main.out });
if (!plan) {
  if (check) {
    say(
      waiting
        ? `a build of ${short(main.out)} is staged and waits for the page's Update click: nothing to do`
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
    `would ${plan.pull ? "pull, " : ""}build into ${path.join(dir, STAGING)}, leaving ${SERVED} alone until the Update click`,
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

// Build beside the served `.next`, never in it: `next build` empties its own folder before it compiles, so a build in
// place would leave the page with no build for as long as the build takes, and with none at all when it fails.
// `next.config.ts` reads COLLECTOR_DIST_DIR; `postbuild` stamps the same folder. The served `.next` is not touched
// here at all: the swap waits for the page's Update click (`scripts/apply-update.ts`), so the page stays up.
fs.rmSync(staging, { recursive: true, force: true });
const since = Date.now();
const built = spawnSync(process.execPath, ["run", "build"], {
  cwd: dir,
  encoding: "utf8",
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
say(`staged in ${STAGING}: ${SERVED} still serves ${servedName}, and the page offers ${short(now)} as an update`);
process.exit(0);
