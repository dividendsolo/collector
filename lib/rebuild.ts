import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { backoffDelay } from "./server/retry";

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export const GIT_TIMEOUT_MS = 60_000;

export function runGit(dir: string, ...args: string[]): GitResult {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const err = (r.stderr || "").trim() || (r.error ? r.error.message : "");
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err };
}

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export const FETCH_ATTEMPTS = 3;

export function fetchOrigin(dir: string, attempts = FETCH_ATTEMPTS): GitResult {
  let last: GitResult = { ok: false, out: "", err: "no fetch made" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = runGit(dir, "fetch", "--quiet", "origin", "main");
    if (last.ok) return last;
    if (attempt < attempts) sleepSync(backoffDelay(attempt + 1, { baseDelayMs: 500, maxDelayMs: 4000 }));
  }
  return last;
}

export const lastLine = (text: string) =>
  (text || "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(-1)[0] || "";

export const short = (commit: string) => commit.slice(0, 7);

export function option(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  return i >= 0 && next && !next.startsWith("--") ? next : undefined;
}

export interface BuildStamp {
  commit: string;
  built_at: string;
}

export const SERVED = ".next";

export const STAGING = ".next-rebuild";

export const stampPath = (dir: string, build = SERVED) => path.join(dir, build, "collector-build.json");

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

export function writeStamp(dir: string, commit: string, at = new Date(), build = SERVED): BuildStamp {
  const stamp: BuildStamp = { commit, built_at: at.toISOString() };
  fs.mkdirSync(path.dirname(stampPath(dir, build)), { recursive: true });
  fs.writeFileSync(stampPath(dir, build), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}

export function swapIn(dir: string, staged = STAGING, served = SERVED): void {
  const from = path.join(dir, staged);
  const to = path.join(dir, served);
  const old = path.join(dir, `${served}-previous`);
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(to)) fs.renameSync(to, old);
  fs.renameSync(from, to);
  fs.rmSync(old, { recursive: true, force: true });
}

export interface Commits {
  built: string | null;
  head: string;
  main: string;
}

export interface Rebuild {
  pull: boolean;
  build: boolean;
  why: string;
}

export function rebuildPlan(c: Commits): Rebuild | null {
  if (c.built !== null && c.built === c.main) return null;
  return {
    pull: c.head !== c.main,
    build: true,
    why: c.built ? `the build was made from ${short(c.built)}` : "no build has recorded a commit",
  };
}

export const RESTART_GAP_MS = 5 * 60_000;

export const restartPath = (dir: string) => path.join(dir, SERVED, "collector-restarted.json");

export function lastRestart(dir: string): number | null {
  try {
    const at = Date.parse((JSON.parse(fs.readFileSync(restartPath(dir), "utf8")) as { at?: string }).at ?? "");
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}

export function markRestart(dir: string, at = new Date()): void {
  fs.writeFileSync(restartPath(dir), `${JSON.stringify({ at: at.toISOString() })}\n`);
}

export const restartWait = (last: number | null, now = Date.now()) =>
  last === null ? 0 : Math.min(RESTART_GAP_MS, Math.max(0, last + RESTART_GAP_MS - now));
