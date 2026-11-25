#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastLine, option } from "../lib/rebuild";

const say = (line: string) => console.log(`[launchd] ${line}`);
const warn = (line: string) => console.error(`[launchd] ${line}`);

const argv = process.argv.slice(2);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkout = path.resolve(option(argv, "dir") || here);
const port = option(argv, "port") || "4000";
const home = process.env.HOME || os.homedir();
const agents = path.join(home, "Library", "LaunchAgents");
const launchctl = (option(argv, "launchctl") || "launchctl").split(" ");
const uid = process.getuid?.() ?? 0;
const LOAD_TIMEOUT_MS = 30_000;

const SERVING = "com.example.collector.plist";
const REBUILD = "com.example.collector-rebuild.plist";
const files = argv.includes("--rebuild") || argv.includes("--uninstall") ? [SERVING, REBUILD] : [SERVING];

const isCheckout = (dir: string, files: string[]) => files.every((f) => fs.existsSync(path.join(dir, f)));
if (!isCheckout(checkout, ["package.json", "collect.py", "install.sh", "launchd", "scripts"])) {
  warn(`${checkout} does not hold Collector: run this from a Collector checkout, or name one with --dir`);
  process.exit(1);
}
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
  warn(`--port needs a port number: ${port} is not one`);
  process.exit(1);
}

const portsIn = (text: string) => /<key>COLLECTOR_PORT<\/key><string>\d+<\/string>/.test(text);
const labelOf = (text: string) => /<key>Label<\/key><string>([^<]+)<\/string>/.exec(text)?.[1] ?? "";
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const render = (text: string) =>
  text
    .replaceAll("/path/to/.bun/bin/bun", xml(process.execPath))
    .replaceAll("/path/to/collector", xml(checkout))
    .replace(/(<key>COLLECTOR_PORT<\/key><string>)\d+(<\/string>)/, `$1${port}$2`);

const jobs = files.map((file) => {
  const text = render(fs.readFileSync(path.join(checkout, "launchd", file), "utf8"));
  const label = labelOf(text);
  if (!label) {
    warn(`launchd/${file} names no label: fix the file`);
    process.exit(1);
  }
  if (text.includes("/path/to/")) {
    warn(`launchd/${file} carries a /path/to path this script does not fill: fix the file`);
    process.exit(1);
  }
  if (!portsIn(text) && file === SERVING) {
    warn(`launchd/${file} sets no COLLECTOR_PORT: fix the file`);
    process.exit(1);
  }
  return { file, label, text, target: path.join(agents, file) };
});

const launchctlRun = (args: string[]) => {
  const r = spawnSync(launchctl[0], [...launchctl.slice(1), ...args], { encoding: "utf8", timeout: LOAD_TIMEOUT_MS });
  return { ok: r.status === 0, why: lastLine(`${r.stderr || ""}${r.stdout || ""}`) || r.error?.message || "" };
};

const bootout = (label: string) => {
  const r = launchctlRun(["bootout", `gui/${uid}/${label}`]);
  if (!r.ok) say(`${label} is not loaded (${r.why})`);
};

if (argv.includes("--print")) {
  for (const job of jobs) say(`would write ${job.target} and load ${job.label}`);
  for (const job of jobs) console.log(job.text);
  process.exit(0);
}

if (argv.includes("--uninstall")) {
  for (const job of jobs) {
    bootout(job.label);
    if (fs.existsSync(job.target)) {
      fs.rmSync(job.target);
      say(`removed ${job.target}`);
    }
  }
  say("Collector no longer starts at login; its folder and its build are where they were");
  process.exit(0);
}

fs.mkdirSync(agents, { recursive: true });
for (const job of jobs) {
  fs.writeFileSync(job.target, job.text);
  say(`wrote ${job.target}`);
}

let failed = false;
for (const job of jobs) {
  bootout(job.label);
  const loaded = launchctlRun(["bootstrap", `gui/${uid}`, job.target]);
  if (!loaded.ok) {
    warn(`could not load ${job.label} (${loaded.why}): the job is at ${job.target}, for launchctl bootstrap`);
    failed = true;
  } else {
    say(`loaded ${job.label}`);
  }
}
if (failed) process.exit(1);

say(`Collector is at http://127.0.0.1:${port}, and launchd starts it at every login`);
say("to stop that: bun scripts/launchd.ts --uninstall");
