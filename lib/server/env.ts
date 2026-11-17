import fs from "node:fs";
import path from "node:path";
import { ENV_PATH, HERMES_HOME } from "./paths";

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"|"$/g, "")
      .replace(/^'|'$/g, "");
  }
  return out;
}

function readEnv(file: string): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export const envFile = () => readEnv(ENV_PATH);
export const hermesEnv = () => readEnv(path.join(HERMES_HOME, ".env"));

export const secret = (name: string) => envFile()[name] || process.env[name] || "";

export function envStamp(): number {
  try {
    return fs.statSync(ENV_PATH).mtimeMs;
  } catch {
    return 0;
  }
}
