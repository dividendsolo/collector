import fs from "node:fs";
import { swr } from "./cache";
import { type Config, config, type Machine } from "./config";
import { COLLECT, HOME } from "./paths";
import { run } from "./run";

const SSH = [
  "ssh",
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=5",
  "-o",
  "ControlMaster=auto",
  "-o",
  `ControlPath=${HOME}/.ssh/collector-%r@%h`,
  "-o",
  "ControlPersist=300",
];
/** The settings collect.py needs on each machine; the rest stays on the server. */
const REMOTE_KEYS = ["launchd_prefixes", "ok_exits", "work_script", "verify_label", "repos_dir"] as const;

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** One machine's snapshot from collect.py: run here, or sent over SSH (`ssh host python3 -`), so nothing is installed there. */
export async function collect(machine: Machine, cfg: Config) {
  const remote = JSON.stringify(Object.fromEntries(REMOTE_KEYS.filter((k) => k in cfg).map((k) => [k, cfg[k]])));
  if (!machine.ssh) return run(["python3", COLLECT, remote]);
  return run([...SSH, machine.ssh, "python3", "-", shellQuote(remote)], { input: fs.readFileSync(COLLECT, "utf8") });
}

export interface GithubLimit {
  error?: string | null;
  graphql?: { used: number; limit: number; reset: number };
  core?: { used: number; limit: number; reset: number };
}

export async function githubLimit(): Promise<GithubLimit> {
  const [data, err] = await run(["gh", "api", "rate_limit"], { timeout: 10 });
  if (!data) return { error: err };
  const r = data.resources;
  const pick = (k: string) => ({ used: r[k].used, limit: r[k].limit, reset: r[k].reset });
  return { graphql: pick("graphql"), core: pick("core") };
}

export interface Snapshot {
  at: number;
  machines: any[];
  github: GithubLimit;
}

/** Every machine plus the GitHub API limit, read every 10 seconds. A stale snapshot is served while a new one is read. */
export const snapshot = swr<Snapshot>("snapshot", 10_000, async () => {
  const cfg = config();
  const targets = cfg.machines?.length ? cfg.machines : [{ name: "this machine" }];
  const [limit, ...results] = await Promise.all([githubLimit(), ...targets.map((t) => collect(t, cfg))]);
  const machines = targets.map((t, i) => ({ ...(results[i][0] || {}), name: t.name, error: results[i][1] }));
  return { at: Math.floor(Date.now() / 1000), machines, github: limit };
});
