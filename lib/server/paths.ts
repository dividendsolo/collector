import os from "node:os";
import path from "node:path";

/** The Collector folder: `bun start` and `bun dev` run from it. */
export const ROOT = process.cwd();
export const HOME = os.homedir();
export const COLLECT = path.join(ROOT, "collect.py");
export const CONFIG_PATH = process.env.COLLECTOR_CONFIG || path.join(ROOT, "config.json");
export const ENV_PATH = path.join(ROOT, ".env");
export const HERMES_HOME = path.join(HOME, ".hermes");

export const expandHome = (p: string) => (p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);
