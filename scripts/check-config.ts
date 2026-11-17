import fs from "node:fs";
import { badConfigValues, CONFIG_KEYS, unknownConfigKeys } from "../lib/server/config";
import { CONFIG_PATH } from "../lib/server/paths";

const where = process.argv[2] || CONFIG_PATH;

let raw: string;
try {
  raw = fs.readFileSync(where, "utf8");
} catch {
  console.error(`could not read ${where}: write it first (SETUP.md), or copy config.example.json`);
  process.exit(1);
}

let cfg: unknown;
try {
  cfg = JSON.parse(raw);
} catch (e) {
  console.error(`${where} is not valid JSON: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

const unknown = unknownConfigKeys(cfg);
if (unknown.length) {
  console.error(
    `${where}: ${unknown.length === 1 ? "1 key Collector does not read" : `${unknown.length} keys Collector does not read`}: ${unknown.join(", ")}`,
  );
  console.error(`Collector reads: ${CONFIG_KEYS.join(", ")}`);
  process.exit(1);
}

const bad = badConfigValues(cfg);
if (bad.length) {
  console.error(
    `${where}: ${bad.length === 1 ? "1 value Collector does not use" : `${bad.length} values Collector does not use`}:`,
  );
  for (const b of bad) console.error(`  ${b}`);
  process.exit(1);
}

console.log(`${where}: ${Object.keys(cfg as Record<string, unknown>).length} keys, every one read by Collector`);
