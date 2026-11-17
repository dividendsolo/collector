#!/usr/bin/env bun
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
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;
const APPLY_TIMEOUT_MS = 2 * 60_000;
const dir = path.resolve(option(argv, "dir") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
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
const leftover = staged !== null && served?.commit === main.out && staged.commit !== main.out;
if (leftover && !check) {
  fs.rmSync(staging, { recursive: true, force: true });
  say(`removed a staged build of ${short(staged.commit)}: the page already serves ${short(main.out)}`);
}
const pending = leftover ? (served?.commit ?? null) : pendingCommit(dir);
const waiting = !leftover && staged !== null && staged.commit === main.out;

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
  writeStamp(dir, now, new Date(), STAGING);
  warn(`the build did not record its own commit: stamped ${short(now)} here, so it is not built twice`);
}
putInService(now);
