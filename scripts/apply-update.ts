#!/usr/bin/env bun
/**
 * The Update click's one write (card #41): move the finished build the rebuild job staged beside the served one into
 * `.next`, then restart the job that serves the page, so the page comes back on the new build.
 *
 *     bun scripts/apply-update.ts --dir /Users/me/code/collector --label com.james.collector
 *     bun scripts/apply-update.ts --restart "echo restarted"        # a test's stand-in for the restart
 *
 * `POST /api/update` runs this detached, a process of its own: the click's answer has to land before the restart,
 * which is what takes the server away. The restart is whole — the swap is in place first, so the page that comes
 * back is the new build. With nothing staged the run says so and stops: a second click, or a page left open on a
 * build already swapped in, changes nothing.
 *
 * The swap is `lib/rebuild.ts`'s `swapIn`: the served folder moves aside, the staged one takes its name, and the old
 * one is deleted, so the page is without a build for the time between two renames rather than for the length of a
 * build. The build that fails never gets here: the rebuild job stages it only after `next build` exited 0.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastLine, option, SERVED, short, swapIn } from "../lib/rebuild";
import { restartCommand, stagedSide } from "../lib/update";

const say = (line: string) => console.log(`[update] ${line}`);
const warn = (line: string) => console.error(`[update] ${line}`);

const argv = process.argv.slice(2);
/** The checkout the page serves: this script's own, which is the folder the serving plist points at. */
const dir = path.resolve(option(argv, "dir") || path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
/** How the page is restarted, whole, for serving that is not the launchd job of `CONTEXT.md`. */
const restart = option(argv, "restart") || restartCommand(option(argv, "label"));

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

const page = spawnSync("/bin/sh", ["-c", restart], { cwd: dir, encoding: "utf8" });
if (page.status !== 0) {
  warn(
    `moved ${name} into ${SERVED}, but could not restart the page (${restart}): ${lastLine(page.stderr || page.stdout)}`,
  );
  process.exit(1);
}
say(`restarted on ${name}: ${restart}`);
process.exit(0);
