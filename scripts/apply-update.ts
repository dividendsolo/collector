#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastLine, option, SERVED, short, swapIn } from "../lib/rebuild";
import { restartCommand, stagedSide } from "../lib/update";

const say = (line: string) => console.log(`[update] ${line}`);
const warn = (line: string) => console.error(`[update] ${line}`);

const argv = process.argv.slice(2);
const dir = path.resolve(option(argv, "dir") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const restart = option(argv, "restart") || restartCommand(option(argv, "label"));

const RESTART_TIMEOUT_MS = 60_000;

const staged = stagedSide(dir);
if (!staged) {
  say(`nothing staged in ${dir}: no update to apply`);
  process.exit(0);
}

const name = short(staged.commit ?? staged.id ?? "");
say(`moving the staged build ${name} into ${SERVED}`);
try {
  swapIn(dir);
} catch (e) {
  warn(`could not move the staged build into ${SERVED} (${(e as Error).message}): not restarting`);
  process.exit(1);
}

const page = spawnSync("/bin/sh", ["-c", restart], { cwd: dir, encoding: "utf8", timeout: RESTART_TIMEOUT_MS });
if (page.status !== 0) {
  warn(
    `moved ${name} into ${SERVED}, but could not restart the page (${restart}): ${lastLine(page.stderr || page.stdout)}`,
  );
  process.exit(1);
}
say(`restarted on ${name}: ${restart}`);
process.exit(0);
