#!/usr/bin/env bun
import { runGit, SERVED, short, writeStamp } from "../lib/rebuild";

const dir = process.cwd();
const head = runGit(dir, "rev-parse", "HEAD");
if (!head.ok) {
  console.error(`[build-stamp] ${dir} is not a git checkout: no build stamp written`);
  process.exit(0);
}

const build = process.env.COLLECTOR_DIST_DIR || SERVED;
const stamp = writeStamp(dir, head.out, new Date(), build);
console.log(`[build-stamp] ${dir}/${build}: built from ${short(stamp.commit)} at ${stamp.built_at}`);
