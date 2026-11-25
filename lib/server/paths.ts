import os from "node:os";
import path from "node:path";

export const ROOT = process.cwd();
export const HOME = os.homedir();
export const COLLECT = path.join(ROOT, "collect.py");
export const FALLBACKS = path.join(ROOT, "fallbacks.py");
export const CONFIG_PATH = process.env.COLLECTOR_CONFIG || path.join(ROOT, "config.json");
export const PROPOSALS_PATH = path.join(path.dirname(CONFIG_PATH), "proposals.json");
export const BRIEFS_PATH = path.join(path.dirname(CONFIG_PATH), "briefs.json");
export const ENV_PATH = path.join(ROOT, ".env");
export const HERMES_HOME = path.join(HOME, ".hermes");

export const expandHome = (p: string) => (p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
