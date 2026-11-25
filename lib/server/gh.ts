import fs from "node:fs";
import path from "node:path";
import { HOME } from "./paths";

export const GH_CALLER = "collector";

export const shimDir = (base: NodeJS.ProcessEnv = process.env): string =>
  base.COLLECTOR_GH_BIN || path.join(HOME, ".local", "share", "agent-stack", "current", "vps", "bin");

export function commandEnv(cmd: string, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const dir = shimDir(base);
  if (path.basename(cmd) !== "gh" || !base.PATH || !fs.existsSync(path.join(dir, "gh"))) return base;
  const rest = base.PATH.split(path.delimiter).filter((d) => d && d !== dir);
  return { ...base, PATH: [dir, ...rest].join(path.delimiter), GH_CALLER };
}
