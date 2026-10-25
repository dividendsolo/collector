#!/usr/bin/env bun
/**
 * Record the commit a build was made from, beside the build: `postbuild`, so it runs only after `next build`
 * succeeded and a build that failed leaves the old stamp in place (`lib/rebuild.ts`, card #29).
 *
 *     bun scripts/build-stamp.ts        # run for you by `bun run build`, in the checkout being built
 *
 * The stamp is what `scripts/rebuild-if-stale.ts` reads to know whether the page serves the commit `main` is at.
 * Stamping is bookkeeping: a folder with no git (a source tarball) says so and still builds.
 */
import { runGit, SERVED, short, writeStamp } from "../lib/rebuild";

const dir = process.cwd();
const head = runGit(dir, "rev-parse", "HEAD");
if (!head.ok) {
  console.error(`[build-stamp] ${dir} is not a git checkout: no build stamp written`);
  process.exit(0);
}

// Beside the build this run made: `.next`, or the rebuild job's staging folder when it set `COLLECTOR_DIST_DIR`.
const build = process.env.COLLECTOR_DIST_DIR || SERVED;
const stamp = writeStamp(dir, head.out, new Date(), build);
console.log(`[build-stamp] ${dir}/${build}: built from ${short(stamp.commit)} at ${stamp.built_at}`);
