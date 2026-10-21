import fs from "node:fs";
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
}
export interface Subscription {
  name: string;
  amount: number;
  billing?: string;
  currency?: string;
  status?: string;
  project?: string;
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
    max_starts_10m?: number;
  };
  verify_label?: string;
  services?: Service[];
  vendors?: Vendor[];
  domains?: string[];
  tickets?: { each?: string[]; count?: string[]; all?: string[]; command?: string[] };
  board?: Board;
  subscriptions?: Subscription[];
  projects?: string[];
  /** Actions minutes a month the GitHub plan includes; read from the plan when left out. */
  actions_minutes?: number;
  agent_notes?: Record<string, string>;
  billing?: Record<string, BillingAccount | BillingAccount[]>;
  repos_dir?: string;
  [key: string]: unknown;
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
