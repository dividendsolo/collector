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
  actions?: ActionsUsage;
}

/** GitHub Actions this month: used minutes (all Actions SKUs) against the minutes the plan includes, and the
 * dollars billed for them (0 until the included minutes run out, then every extra minute is billed). */
export interface ActionsUsage {
  error?: string | null;
  used?: number;
  billed?: number;
  limit?: number;
  reset?: number;
}

/** The dollars a billing usage report bills for Actions: netAmount (gross less discounts) summed over its Actions
 * items, rounded to cents. The report covers one month (GitHub's default is the current one), so this is the
 * month's Actions bill. */
export function actionsBilled(sum: any): number {
  const net = (sum?.usageItems || [])
    .filter((x: any) => String(x.product ?? "").toLowerCase() === "actions")
    .reduce((t: number, x: any) => t + (x.netAmount || 0), 0);
  return Math.round(net * 100) / 100;
}

// Minutes a month each GitHub plan includes for private repos (docs.github.com, "GitHub Actions billing").
const PLAN_MINUTES: Record<string, number> = { free: 2000, pro: 3000, team: 3000, enterprise: 50000 };

/** The signed-in gh account's Actions minutes, from the billing usage summary. Read every 5 minutes. */
const actionsUsage = swr<ActionsUsage>("actions-usage", 5 * 60_000, async () => {
  const [user, err] = await run(["gh", "api", "user"], { timeout: 10 });
  if (!user) return { error: err };
  const [sum, err2] = await run(["gh", "api", `users/${user.login}/settings/billing/usage/summary`], { timeout: 15 });
  if (!sum) return { error: err2 };
  const used = (sum.usageItems || [])
    .filter((x: any) => x.product === "Actions" && x.unitType === "minutes")
    .reduce((t: number, x: any) => t + x.grossQuantity, 0);
  const now = new Date();
  return {
    used: Math.round(used),
    billed: actionsBilled(sum),
    limit: config().actions_minutes ?? PLAN_MINUTES[user.plan?.name] ?? 2000,
    reset: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000,
  };
});

export async function githubLimit(): Promise<GithubLimit> {
  const [data, err] = await run(["gh", "api", "rate_limit"], { timeout: 10 });
  if (!data) return { error: err };
  const r = data.resources;
  const pick = (k: string) => ({ used: r[k].used, limit: r[k].limit, reset: r[k].reset });
  const actions = await actionsUsage.get().catch((e) => ({ error: String(e) }));
  return { graphql: pick("graphql"), core: pick("core"), actions };
}

export interface Snapshot {
  at: number;
  machines: any[];
  github: GithubLimit;
}

/** How often the server reads every machine. A machine read is stale once it is older than this. */
export const READ_SECONDS = 10;

/**
 * This read's machines, each stamped with `read_at` (the time of its last good read). A machine whose read failed
 * keeps its last good read, with `stale: true` and the error, instead of coming back empty: an empty machine has no
 * runs, so every card it was building read `no run` (card #41) while the page said nothing about a failed read.
 * A machine with no good read yet comes back as it is, empty with its error.
 */
export function mergeMachines(prev: any[] | undefined, next: any[], at: number): any[] {
  return next.map((m) => {
    if (!m.error) return { ...m, read_at: at, stale: false };
    const last = prev?.find((p) => p.name === m.name && p.read_at);
    return last ? { ...last, error: m.error, stale: true } : { ...m, read_at: null, stale: true };
  });
}

/** Every machine plus the GitHub API limit, read every 10 seconds. A stale snapshot is served while a new one is read. */
export const snapshot = swr<Snapshot>("snapshot", READ_SECONDS * 1000, async (): Promise<Snapshot> => {
  const cfg = config();
  const targets = cfg.machines?.length ? cfg.machines : [{ name: "this machine" }];
  const [limit, ...results] = await Promise.all([githubLimit(), ...targets.map((t) => collect(t, cfg))]);
  const read = targets.map((t, i) => ({ ...(results[i][0] || {}), name: t.name, error: results[i][1] }));
  const at = Math.floor(Date.now() / 1000);
  return { at, machines: mergeMachines(snapshot.peek()?.machines, read, at), github: limit };
});
