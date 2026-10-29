/**
 * The server's own record of when it starts and why it stops (card #41).
 *
 * `collector.log` had no time of its own on a start or a stop, so a restart could only be dated from the `[board]`
 * lines around it and launchd's log. Every start now writes one stamped `[server] start` line, and a SIGTERM writes
 * one stamped `[server] SIGTERM` line with the processes that started in the seconds before it, which is the
 * nearest thing to a sender a signal leaves behind (macOS records no sender for a plain `kill`).
 *
 * The SIGTERM handler also ends every open event stream. `next start` answers a SIGTERM by closing its port and
 * waiting for the connections still open, and a page's `/api/events` stream never finishes on its own: on
 * 2026-10-29 the server sat for ten minutes with its port shut and one open page attached, every new request
 * refused, the open page frozen on its last machine snapshot ("no run" for builds that were running), until a
 * reload closed the stream and the process finally exited.
 */
import { execFileSync } from "node:child_process";
import type { Side } from "../update";
import { once } from "./store";

/** How far back the SIGTERM line looks for the process that may have sent it. */
export const RECENT_SECONDS = 15;

/** The closers of the open `/api/events` streams, one per open page. */
const streams = () => once("event-streams", () => new Set<() => void>());

/** Register one open event stream's closer. Returns the unregister, for a stream that ends by itself. */
export function openStream(close: () => void): () => void {
  const all = streams();
  all.add(close);
  return () => {
    all.delete(close);
  };
}

export const openStreams = () => streams().size;

/** End every open event stream. Returns how many there were. */
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

/** ps's ELAPSED column (`[[dd-]hh:]mm:ss`) in seconds, null when it is not one. */
export function etimeSeconds(etime: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(?:(\d+):)?(\d+)$/.exec(etime.trim());
  if (!m) return null;
  const [, d, a, b, s] = m;
  const [h, min] = b !== undefined ? [a, b] : [undefined, a];
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s);
}

/** A command line with anything shaped like a credential masked: the log must never hold a key (AGENTS.md), and
 * another process's arguments can (`curl -H "Authorization: Bearer ..."`). */
export const redact = (command: string) =>
  command
    .replace(/\b(bearer\s+|basic\s+)[^\s'"&]+/gi, "$1***")
    .replace(/((?:token|key|secret|password|passwd|auth)[\w-]*[=:]\s*)(?!bearer\b|basic\b|\*\*\*)[^\s'"&]+/gi, "$1***")
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[a-z])[-_][\w-]{8,}/g, "***");

/** The processes in `ps -Ao pid,ppid,etime,command` output that started in the last `within` seconds, one line
 * each, never `self` and never the ps that printed the table. */
export function recentProcesses(ps: string, { self, within = RECENT_SECONDS }: { self: number; within?: number }) {
  const out: string[] = [];
  for (const line of ps.split("\n").slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    const age = etimeSeconds(etime);
    if (age === null || age > within || Number(pid) === self || /^ps\s/.test(command)) continue;
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

/** The process table, or nothing when ps cannot run (it must never stop the shutdown). */
function processTable(): string {
  try {
    return execFileSync("ps", ["-Ao", "pid,ppid,etime,command"], { encoding: "utf8", timeout: 2000 });
  } catch {
    return "";
  }
}

/** At boot: write the start line, and log and end the streams on SIGTERM. Ours runs first (`prependListener`):
 * Next's own SIGTERM handler closes the port and exits once the last connection is gone. Once per process. */
export function watchLifecycle(build: Side, log: (line: string) => void = console.log) {
  once("lifecycle", () => {
    log(startLine(new Date(), process.pid, process.ppid, build));
    process.prependListener("SIGTERM", () => {
      const recent = recentProcesses(processTable(), { self: process.pid });
      log(termLine(new Date(), process.pid, process.ppid, closeStreams(), recent));
    });
    return true;
  });
}
