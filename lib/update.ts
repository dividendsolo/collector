import fs from "node:fs";
import path from "node:path";
import { readStamp, SERVED, STAGING } from "./rebuild";
import { ROOT } from "./server/paths";
import { once } from "./server/store";

export const BUILD_FILE = "BUILD_ID";

export interface Side {
  id: string | null;
  commit: string | null;
}

function readId(build: string): string | null {
  try {
    return fs.readFileSync(path.join(build, BUILD_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function readSide(dir: string, folder = SERVED): Side {
  return { id: readId(path.join(dir, folder)), commit: readStamp(dir, folder)?.commit ?? null };
}

const BOOT_KEY = "__collector:running-build";

function boot(): { side: Side | null } {
  return once(BOOT_KEY, () => ({ side: null as Side | null }));
}

export function rememberServed(side: Side): void {
  boot().side = side;
}

export function servedSide(dir = ROOT): Side {
  const served = boot().side;
  return served?.id ? served : readSide(dir, SERVED);
}

export function stagedSide(dir = ROOT): Side | null {
  const side = readSide(dir, STAGING);
  return side.id ? side : null;
}

export function pendingCommit(dir = ROOT): string | null {
  return stagedSide(dir)?.commit ?? readSide(dir, SERVED).commit;
}

export const restartCommand = (label = process.env.COLLECTOR_LABEL || "com.james.collector") =>
  `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/${label}`;
