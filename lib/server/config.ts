import fs from "node:fs";
import type { StatusSets } from "../statuses";
import { CONFIG_PATH } from "./paths";

export interface Machine {
  name: string;
  ssh?: string;
}
export interface Service {
  name: string;
  url: string;
  headers?: Record<string, string>;
}
export interface Vendor {
  name: string;
  url: string;
  feed?: string;
  probe?: string;
  attention?: boolean;
  criticality?: string;
}
export interface Subscription {
  name: string;
  amount: number;
  billing?: string;
  currency?: string;
  status?: string;
  project?: string;
  renews?: string;
}
export interface ProjectEntry {
  stage?: string;
}
export interface BillingAccount {
  provider: string;
  key: string;
  note?: string;
}
export interface Board {
  project_id: string;
  lanes: Record<string, string | null>;
  priorities: Record<string, string>;
  label_repos?: string[];
  interval?: number;
}
export interface Watch {
  name: string;
  machine?: string;
  process?: string;
  session?: string;
  launchd?: string;
  log?: string;
  heartbeat?: string;
  idle_after?: number;
  fail_on?: string;
}
export interface Config {
  machines?: Machine[];
  jobs?: Record<string, string>;
  launchd_prefixes?: string[];
  ok_exits?: Record<string, Record<string, string>>;
  work_script?: {
    label?: string;
    name?: string;
    jobs?: string[];
    log?: string;
    steps?: string;
    max_starts_60s?: number;
  };
  watch?: Watch[];
  verify_label?: string;
  services?: Service[];
  vendors?: Vendor[];
  domains?: string[];
  statuses?: Partial<StatusSets>;
  tickets?: { each?: string[]; count?: string[]; all?: string[]; command?: string[] };
  board?: Board;
  subscriptions?: Subscription[];
  projects?: string[] | Record<string, ProjectEntry>;
  actions_minutes?: number;
  agent_notes?: Record<string, string>;
  billing?: Record<string, BillingAccount | BillingAccount[]>;
  repos_dir?: string;
  [key: string]: unknown;
}

export const CONFIG_KEYS = [
  "machines",
  "jobs",
  "launchd_prefixes",
  "ok_exits",
  "work_script",
  "watch",
  "verify_label",
  "services",
  "vendors",
  "domains",
  "statuses",
  "tickets",
  "board",
  "subscriptions",
  "projects",
  "agent_notes",
  "billing",
  "actions_minutes",
  "repos_dir",
] as const;

const KNOWN_KEYS = new Set<string>(CONFIG_KEYS);

export const PROJECT_STAGES = ["idea", "development", "testing", "production", "archived"] as const;
export const API_CRITICALITIES = ["low", "medium", "high", "critical"] as const;

export const RENEWS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isRenewsDate(v: unknown): v is string {
  if (typeof v !== "string" || !RENEWS_DATE.test(v)) return false;
  const d = new Date(`${v}T12:00:00`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return !Number.isNaN(d.getTime()) && `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === v;
}

const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const who = (n: unknown) => (typeof n === "string" ? n : "?");
const allowed = (values: readonly string[], v: unknown) => typeof v === "string" && values.includes(v);

export function projectRepos(cfg: Config = {}): string[] {
  const p = cfg.projects;
  if (Array.isArray(p)) return p.filter((r): r is string => typeof r === "string");
  return p && typeof p === "object" ? Object.keys(p) : [];
}

export function projectStage(cfg: Config, repo: string): string | undefined {
  const stage = object(object(cfg.projects)?.[repo])?.stage;
  return typeof stage === "string" ? stage : undefined;
}

export function repoNames(cfg: Config, repo: string): string[] {
  const chosen = projectRepos(cfg);
  const exact = chosen.filter((p) => p.split("/").pop() === repo);
  return exact.length ? exact : [...new Set(chosen.map((p) => p.split("/")[0]))].map((o) => `${o}/${repo}`);
}

export function badConfigValues(cfg: unknown): string[] {
  const c = object(cfg) ?? {};
  const out: string[] = [];
  for (const [repo, v] of Object.entries(object(c.projects) ?? {})) {
    const stage = object(v)?.stage;
    if (stage != null && !allowed(PROJECT_STAGES, stage))
      out.push(`projects["${repo}"].stage ${JSON.stringify(stage)} is not one of ${PROJECT_STAGES.join(", ")}`);
  }
  for (const [i, v] of list(c.vendors).entries()) {
    const { name, criticality } = object(v) ?? {};
    if (criticality != null && !allowed(API_CRITICALITIES, criticality))
      out.push(
        `vendors[${i}] (${who(name)}).criticality ${JSON.stringify(criticality)} is not one of ${API_CRITICALITIES.join(", ")}`,
      );
  }
  for (const [i, v] of list(c.subscriptions).entries()) {
    const { name, renews } = object(v) ?? {};
    if (renews != null && !isRenewsDate(renews))
      out.push(`subscriptions[${i}] (${who(name)}).renews ${JSON.stringify(renews)} is not a date (YYYY-MM-DD)`);
  }
  return out;
}

export function unknownConfigKeys(cfg: unknown): string[] {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return [];
  return Object.keys(cfg).filter((k) => !KNOWN_KEYS.has(k));
}

let cached: { stamp: number; cfg: Config } | null = null;

export function config(): Config {
  let stamp = 0;
  try {
    stamp = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch {
    return {};
  }
  if (cached && cached.stamp === stamp) return cached.cfg;
  try {
    cached = { stamp, cfg: JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Config };
  } catch {
    return cached?.cfg ?? {};
  }
  return cached.cfg;
}

export function writeConfig(cfg: Config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
  cached = null;
}

export const accountsOf = (a: BillingAccount | BillingAccount[]) => (Array.isArray(a) ? a : [a]);
