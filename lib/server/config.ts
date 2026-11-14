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
  /** How much we depend on it: `low`, `medium`, `high` or `critical` (collector#78). */
  criticality?: string;
}
export interface Subscription {
  name: string;
  amount: number;
  billing?: string;
  currency?: string;
  status?: string;
  project?: string;
  /** The day it renews, `YYYY-MM-DD` (collector#78). */
  renews?: string;
}
/** One repo on the Projects page and its own facts (collector#78). */
export interface ProjectEntry {
  /** Where the project stands: `idea`, `development`, `testing`, `production` or `archived`. */
  stage?: string;
}
export interface BillingAccount {
  provider: string;
  key: string;
  note?: string;
}
export interface Board {
  /** The GitHub Projects v2 node id of the board. */
  project_id: string;
  /** Lane slug -> Status option id. */
  lanes: Record<string, string | null>;
  /** P0/P1/P2 -> Priority option id. */
  priorities: Record<string, string>;
  /** owner/repo: repos that keep their lane in a label, off the board. */
  label_repos?: string[];
  /** Seconds between board reads (default 10). */
  interval?: number;
}
/** One agent or job of the user's own to warn about (collector#54). The entry names one thing and the signal that
 * says how it is doing: `process` (a command line that should be running), `session` (a running Claude Code or
 * Codex process), `launchd` (a label, whose last exit code says whether its last run worked), `log` (a file: its
 * last line against `fail_on`, and how long since it was written), or `heartbeat` (a file the agent writes, or its
 * epoch second). `machine` names the machine it lives on, by the name in `machines`; left out, the machine Collector
 * runs on, since a process, a launchd label and a file each belong to one machine. */
export interface Watch {
  name: string;
  machine?: string;
  /** Text a command line carries while the process runs. */
  process?: string;
  /** `claude` or `codex`: a running coding-agent session. */
  session?: string;
  /** A launchd label whose job's last exit code says how its last run went. */
  launchd?: string;
  /** A log file: its last line, and its age, say how the run went. */
  log?: string;
  /** A file the agent writes as it works, or its own epoch second. */
  heartbeat?: string;
  /** Seconds a `log` or a `heartbeat` may go unwritten before the watch reads as idle (default 900). */
  idle_after?: number;
  /** Text in a `log`'s last line that means the run failed. */
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
  /** The card statuses Collector reads: which mean "waits on you" (in that order), "a droid is working", "done"
   * (collector#53). Left out: the agent stack's own statuses, and `tickets.each` for the waiting ones. */
  statuses?: Partial<StatusSets>;
  tickets?: { each?: string[]; count?: string[]; all?: string[]; command?: string[] };
  board?: Board;
  subscriptions?: Subscription[];
  /** The repos on the Projects page: `owner/repo` strings (what the repo picker writes), or a map of
   * `owner/repo` to that project's own facts (`{"stage": "production"}`) — collector#78. Read both ways by
   * `projectRepos` and `projectStage`. */
  projects?: string[] | Record<string, ProjectEntry>;
  /** Actions minutes a month the GitHub plan includes; read from the plan when left out. */
  actions_minutes?: number;
  agent_notes?: Record<string, string>;
  billing?: Record<string, BillingAccount | BillingAccount[]>;
  repos_dir?: string;
  [key: string]: unknown;
}

/** Every top-level key Collector reads, in the order README's "Configure it" table documents them. A key outside
 * this list does nothing: it is a typo, or a key a setup agent invented. */
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

/** A project's stage (Mission Control's ProjectStatus) and how much we depend on a vendor (its ApiCriticality):
 * the allowed values, in the order the docs write them (collector#78). */
export const PROJECT_STAGES = ["idea", "development", "testing", "production", "archived"] as const;
export const API_CRITICALITIES = ["low", "medium", "high", "critical"] as const;

/** A renewal date as config.json writes one: a calendar day, `2026-11-15`. */
export const RENEWS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Is this a renewal date Collector can use: `YYYY-MM-DD`, and a day that exists (`2026-02-31` is not one). */
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

/** The repos on the Projects page, in the order the file writes them, from either shape of the key: the list the
 * repo picker writes, or a map of `owner/repo` to that project's own facts (collector#78). */
export function projectRepos(cfg: Config = {}): string[] {
  const p = cfg.projects;
  if (Array.isArray(p)) return p.filter((r): r is string => typeof r === "string");
  return p && typeof p === "object" ? Object.keys(p) : [];
}

/** One project's stage, or undefined for a project with none — and for a config that keeps `projects` a plain
 * list, where no repo has one (collector#78). */
export function projectStage(cfg: Config, repo: string): string | undefined {
  const stage = object(object(cfg.projects)?.[repo])?.stage;
  return typeof stage === "string" ? stage : undefined;
}

/** The `owner/repo` names a short repo name may be: the chosen projects that end with it, else every chosen owner
 * with this repo. One card number read from the page resolves to a repo this way, whether the page asks for the
 * card's text (collector#64's tooltip) or for its journey (collector#146). */
export function repoNames(cfg: Config, repo: string): string[] {
  const chosen = projectRepos(cfg);
  const exact = chosen.filter((p) => p.split("/").pop() === repo);
  return exact.length ? exact : [...new Set(chosen.map((p) => p.split("/")[0]))].map((o) => `${o}/${repo}`);
}

/** The config.json values Collector would never use — a stage, a criticality or a renewal date outside the
 * allowed ones (collector#78) — each named the way a reader finds it in the file. Reported rather than obeyed,
 * as `unknownConfigKeys` is: `bun run check:config` and the Needs attention row both name them, since a setting
 * that does nothing should not be silent. A config of the wrong shape is reported, never thrown: this runs on a
 * stranger's config.json, inside the page's own read. */
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

/** The top-level keys in a candidate config that Collector would never read. Reported rather than obeyed (as a row in
 * Needs attention, by `bun run check:config`, and by SETUP.md's prompt), since such a key is a setting that does nothing. */
export function unknownConfigKeys(cfg: unknown): string[] {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return [];
  return Object.keys(cfg).filter((k) => !KNOWN_KEYS.has(k));
}

let cached: { stamp: number; cfg: Config } | null = null;

/** config.json, re-read whenever the file changes, so an edit shows on the next refresh. No file: this machine only. */
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
