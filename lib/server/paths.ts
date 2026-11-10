import os from "node:os";
import path from "node:path";

/** The Collector folder: `bun start` and `bun dev` run from it. */
export const ROOT = process.cwd();
export const HOME = os.homedir();
export const COLLECT = path.join(ROOT, "collect.py");
export const CONFIG_PATH = process.env.COLLECTOR_CONFIG || path.join(ROOT, "config.json");
/** The client proposals sit beside `config.json`, wherever that is: one folder of this machine's own state, and out of
 * the repo (collector#77). */
export const PROPOSALS_PATH = path.join(path.dirname(CONFIG_PATH), "proposals.json");
/** Which briefs James has read and archived, beside them, on this machine and not on the machine that has the files
 * (collector#64): a browser reset and a Collector restart both leave it in place. */
export const BRIEFS_PATH = path.join(path.dirname(CONFIG_PATH), "briefs.json");
export const ENV_PATH = path.join(ROOT, ".env");
export const HERMES_HOME = path.join(HOME, ".hermes");

export const expandHome = (p: string) => (p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
