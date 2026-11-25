import fs from "node:fs";
import { type GithubRefusal, recentRefusal, refusalKind, retryAfterSeconds } from "../github-limit";
import { swr } from "./cache";
import { type Config, config, type Machine, type Watch } from "./config";
import { type JogUsage, jogUsage } from "./jog";
import { withHostNames } from "./names";
import { COLLECT, HOME } from "./paths";
import { run, runText } from "./run";
import { once } from "./store";

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
const REMOTE_KEYS = ["launchd_prefixes", "ok_exits", "work_script", "watch", "verify_label", "repos_dir"] as const;

export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function pythonOver(machine: Machine, script: string, args: string[]): { cmd: string[]; input?: string } {
  if (!machine.ssh) return { cmd: ["python3", script, ...args] };
  return {
    cmd: [...SSH, machine.ssh, "python3", "-", ...args.map(shellQuote)],
    input: fs.readFileSync(script, "utf8"),
  };
}

export function watchFor(watch: unknown, machine: string, here: string): Watch[] {
  if (watch == null) return [];
  if (!Array.isArray(watch)) return machine === here ? (watch as Watch[]) : [];
  return watch.filter((w) => ((w && typeof w === "object" && w.machine) || here) === machine);
}

export async function collect(machine: Machine, cfg: Config, brief?: string) {
  const remote = JSON.stringify(Object.fromEntries(REMOTE_KEYS.filter((k) => k in cfg).map((k) => [k, cfg[k]])));
  const { cmd, input } = pythonOver(machine, COLLECT, [remote, ...(brief ? ["brief", brief] : [])]);
  return run(cmd, input ? { input } : {});
}

export interface GithubLimit {
  error?: string | null;
  graphql?: { used: number; limit: number; reset: number };
  core?: { used: number; limit: number; reset: number };
  actions?: ActionsUsage;
  refusal?: GithubRefusal | null;
}

export interface ActionsUsage {
  error?: string | null;
  used?: number;
  billed?: number;
  limit?: number;
  reset?: number;
}

export function actionsBilled(sum: any): number {
  const net = (sum?.usageItems || [])
    .filter((x: any) => String(x.product ?? "").toLowerCase() === "actions")
    .reduce((t: number, x: any) => t + (x.netAmount || 0), 0);
  return Math.round(net * 100) / 100;
}

const PLAN_MINUTES: Record<string, number> = { free: 2000, pro: 3000, team: 3000, enterprise: 50000 };

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

export const isRateLimited = (error: string | null | undefined) => /rate limit|RATE_LIMITED/i.test(error ?? "");

export async function probeRefusal(): Promise<GithubRefusal | null> {
  const at = Math.floor(Date.now() / 1000);
  const r = await runText(["gh", "api", "graphql", "--include", "-f", "query={ viewer { login } }"], {
    timeout: 10,
    attempts: 1,
  });
  const text = `${r.stdout}\n${r.error ?? ""}`;
  if (r.ok || !isRateLimited(text)) return null;
  const [rate] = await run<{ resources?: { graphql?: { remaining?: number } } }>(["gh", "api", "rate_limit"], {
    timeout: 10,
  });
  const remaining = rate?.resources?.graphql?.remaining ?? null;
  return { at, limit: refusalKind(text, remaining), retryAfter: retryAfterSeconds(text) };
}

const lastRefusal = once<{ value: GithubRefusal | null }>("github-refusal", () => ({ value: null }));

const graphqlProbe = swr<GithubRefusal | null>("graphql-probe", 60_000, async () => {
  const refused = await probeRefusal();
  if (refused) lastRefusal.value = refused;
  return lastRefusal.value;
});

export async function githubLimit(): Promise<GithubLimit> {
  const [[data, err], probed] = await Promise.all([
    run(["gh", "api", "rate_limit"], { timeout: 10 }),
    graphqlProbe.get().catch(() => null),
  ]);
  const refusal = recentRefusal(probed, Math.floor(Date.now() / 1000));
  if (!data) return { error: err, refusal };
  const r = data.resources;
  const pick = (k: string) => ({ used: r[k].used, limit: r[k].limit, reset: r[k].reset });
  const actions = await actionsUsage.get().catch((e) => ({ error: String(e) }));
  return { graphql: pick("graphql"), core: pick("core"), actions, refusal };
}

export interface Snapshot {
  at: number;
  machines: any[];
  github: GithubLimit;
  jog: JogUsage;
}

export const READ_SECONDS = 10;

export function mergeMachines(prev: any[] | undefined, next: any[], at: number): any[] {
  return next.map((m) => {
    if (!m.error) return { ...m, read_at: at, stale: false };
    const last = prev?.find((p) => p.name === m.name && p.read_at);
    return last ? { ...last, error: m.error, stale: true } : { ...m, read_at: null, stale: true };
  });
}

export const snapshot = swr<Snapshot>("snapshot", READ_SECONDS * 1000, async (): Promise<Snapshot> => {
  const cfg = config();
  const targets = cfg.machines?.length ? cfg.machines : [{ name: "this machine" }];
  const here = targets.find((t) => !t.ssh)?.name ?? targets[0].name;
  const [limit, jog, ...results] = await Promise.all([
    githubLimit(),
    jogUsage(),
    ...targets.map((t) => collect(t, { ...cfg, watch: watchFor(cfg.watch, t.name, here) })),
  ]);
  const read = targets.map((t, i) => ({ ...(results[i][0] || {}), name: t.name, local: !t.ssh, error: results[i][1] }));
  const at = Math.floor(Date.now() / 1000);
  const named = await withHostNames(read);
  return { at, machines: mergeMachines(snapshot.peek()?.machines, named, at), github: limit, jog };
});
