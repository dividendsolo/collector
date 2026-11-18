import { execFileSync } from "node:child_process";
import type { Side } from "../update";
import { once } from "./store";

export const RECENT_SECONDS = 15;

const streams = () => once("event-streams", () => new Set<() => void>());

export function openStream(close: () => void): () => void {
  const all = streams();
  all.add(close);
  return () => {
    all.delete(close);
  };
}

export const openStreams = () => streams().size;

export function closeStreams(): number {
  const all = [...streams()];
  streams().clear();
  for (const close of all) {
    try {
      close();
    } catch {}
  }
  return all.length;
}

export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(?:(\d+):)?(\d+)$/.exec(etime.trim());
  if (!m) return null;
  const [, d, a, b, s] = m;
  const [h, min] = b !== undefined ? [a, b] : [undefined, a];
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s);
}

export const redact = (command: string) =>
  command
    .replace(/\b(bearer\s+|basic\s+)[^\s'"&]+/gi, "$1***")
    .replace(/((?:token|key|secret|password|passwd|auth)[\w-]*[=:]\s*)(?!bearer\b|basic\b|\*\*\*)[^\s'"&]+/gi, "$1***")
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[a-z])[-_][\w-]{8,}/g, "***");

export function recentProcesses(ps: string, { self, within = RECENT_SECONDS }: { self: number; within?: number }) {
  const out: string[] = [];
  for (const line of ps.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    const age = etimeSeconds(etime);
    if (age === null || age > within || Number(pid) === self || Number(ppid) === self) continue;
    out.push(`${pid} (parent ${ppid}, ${age} s): ${redact(command).slice(0, 160)}`);
  }
  return out;
}

export function startLine(at: Date, pid: number, ppid: number, build: Side): string {
  const name = build.id ? `${build.id}${build.commit ? ` (${build.commit.slice(0, 7)})` : ""}` : "none";
  return `[server] start ${at.toISOString()} pid ${pid} parent ${ppid} build ${name}`;
}

export function termLine(at: Date, pid: number, ppid: number, ended: number, recent: string[]): string {
  const head =
    `[server] SIGTERM ${at.toISOString()} pid ${pid} parent ${ppid}; ending ${ended} open event ` +
    `stream${ended === 1 ? "" : "s"} so the server can exit; started in the last ${RECENT_SECONDS} s:`;
  return recent.length ? `${head}\n${recent.map((l) => `[server]   ${l}`).join("\n")}` : `${head} nothing`;
}

function processTable(): string {
  try {
    return execFileSync("ps", ["-Ao", "pid,ppid,etime,command"], { encoding: "utf8", timeout: 2000 });
  } catch {
    return "";
  }
}

export const EXIT_GRACE_MS = 2000;

export function watchLifecycle(build: Side, log: (line: string) => void = console.log) {
  once("lifecycle", () => {
    log(startLine(new Date(), process.pid, process.ppid, build));
    process.prependListener("SIGTERM", () => {
      const recent = recentProcesses(processTable(), { self: process.pid });
      log(termLine(new Date(), process.pid, process.ppid, closeStreams(), recent));
      setTimeout(() => process.exit(143), EXIT_GRACE_MS).unref();
    });
    return true;
  });
}
