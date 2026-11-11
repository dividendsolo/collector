import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  lastRestart,
  markRestart,
  RESTART_GAP_MS,
  readStamp,
  rebuildPlan,
  restartWait,
  SERVED,
  STAGING,
  swapIn,
  writeStamp,
} from "@/lib/rebuild";

/** The live Collector's own rebuild (card #29): the "is the build behind main" check on its own, then the real
 * script in a throwaway checkout with a real `origin` on disk, so the pull, the build and the stamp a run here takes
 * are the ones the live job takes. Nothing here goes near the machine's own Collector. */
const ROOT = process.cwd();
const JOB = path.join(ROOT, "scripts", "rebuild-if-stale.ts");
const STAMP_SCRIPT = path.join(ROOT, "scripts", "build-stamp.ts");

/** A git command in a folder, isolated from whatever global git config this machine carries. */
const gitEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" });
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: gitEnv() });
const write = (p: string, body: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
/** A commit on main of a checkout. */
const commit = (dir: string, body: string) => {
  write(path.join(dir, "notes.md"), `${body}\n`);
  git(dir, "add", "notes.md");
  git(dir, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", body);
};

/** A stand-in for `next build` that does to its folder what `next build` does: empties the distDir it was given
 * (`COLLECTOR_DIST_DIR`, as `next.config.ts` reads it, else `.next`) before anything else, then writes a BUILD_ID and
 * a chunk — or, when `fail` is set, exits 3 after the wipe, as a type error on main does. */
const fakeNextBuild = (id: string, fail = false, midway = "") =>
  `d=\${COLLECTOR_DIST_DIR:-.next}; rm -rf "$d"; ${midway} mkdir -p "$d/static"; ${
    fail ? "exit 3" : `echo ${id} > "$d/BUILD_ID"; echo chunk > "$d/static/app.js"`
  }`;

/** The world the job runs in: a bare `origin` with two commits on main, `live` (the checkout the job is pointed at)
 * and `work` (where a newer commit on main is made). `live` holds a package.json shaped like the live Collector's:
 * `bun run build` (a stand-in for `next build`, which wipes its folder first), whose postbuild records the commit
 * the build was made from. `live` starts out serving an old build: a BUILD_ID and a chunk in `.next`. */
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-rebuild-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");
  git(root, "init", "-b", "main", "seed");
  commit(seed, "first");
  git(root, "init", "--bare", "-b", "main", "origin.git");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "origin", "main");
  const live = path.join(root, "live");
  const work = path.join(root, "work");
  git(root, "clone", origin, "live");
  git(root, "clone", origin, "work");
  write(
    path.join(live, "package.json"),
    `${JSON.stringify({ name: "live", scripts: { build: fakeNextBuild("new"), postbuild: `bun ${STAMP_SCRIPT}` } }, null, 2)}\n`,
  );
  write(path.join(live, ".next", "BUILD_ID"), "old\n");
  write(path.join(live, ".next", "static", "app.js"), "old chunk\n");

  /** The commit one of the world's checkouts is at. */
  const head = (dir: string) => git(dir, "rev-parse", "HEAD").trim();
  /** A newer commit on main, made where the checkout the job reads has not seen it: another clone, pushed, which is
   * what a merge to main does to a checkout nobody has pulled. */
  const merge = (body: string) => {
    commit(work, body);
    git(work, "push", "origin", "main");
    return git(work, "rev-parse", "HEAD").trim();
  };
  /** The job, as the launchd job runs it: `bun scripts/rebuild-if-stale.ts --dir <checkout>`, with an echo into
   * `restarts.txt` for the restart: the real one kickstarts the launchd job, which only the live page runs. */
  const run = (...flags: string[]) => {
    const restart = ["--restart", "echo restarted >> restarts.txt"];
    const r = spawnSync("bun", [JOB, "--dir", live, ...restart, ...flags], {
      cwd: live,
      encoding: "utf8",
      env: gitEnv(),
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const file = (name: string) => path.join(live, name);
  /** The BUILD_ID a build folder holds, null when it holds no build. */
  const buildId = (folder: string) =>
    fs.existsSync(file(`${folder}/BUILD_ID`)) ? fs.readFileSync(file(`${folder}/BUILD_ID`), "utf8").trim() : null;
  /** The BUILD_ID the page serves, and the one the job staged beside it. */
  const served = () => buildId(SERVED);
  const staged = () => buildId(STAGING);
  const built = () => staged() === "new";
  const stamp = () => readStamp(live)?.commit ?? null;
  const stagedStamp = () => readStamp(live, STAGING)?.commit ?? null;
  /** How many times the job restarted the page. */
  const restarts = () =>
    fs.existsSync(file("restarts.txt")) ? fs.readFileSync(file("restarts.txt"), "utf8").trim().split("\n").length : 0;

  return { root, origin, live, work, head, merge, run, file, served, staged, built, stamp, stagedStamp, restarts };
}

describe("rebuildPlan", () => {
  it("is quiet when the build the page serves is the commit main is at", () => {
    expect(rebuildPlan({ built: "a1b2c3d4", head: "a1b2c3d4", main: "a1b2c3d4" })).toBeNull();
  });
  it("pulls and builds when the checkout and its build are both behind main", () => {
    expect(rebuildPlan({ built: "a1b2c3d4", head: "a1b2c3d4", main: "e5f6a7b8" })).toEqual({
      pull: true,
      build: true,
      why: "the build was made from a1b2c3d",
    });
  });
  it("builds without pulling when the checkout is already at main but its last build did not finish", () => {
    expect(rebuildPlan({ built: "a1b2c3d4", head: "e5f6a7b8", main: "e5f6a7b8" })).toEqual({
      pull: false,
      build: true,
      why: "the build was made from a1b2c3d",
    });
  });
  it("builds when no build ever recorded a commit — the build the page served before this job existed", () => {
    expect(rebuildPlan({ built: null, head: "e5f6a7b8", main: "e5f6a7b8" })).toEqual({
      pull: false,
      build: true,
      why: "no build has recorded a commit",
    });
  });
});

describe("build stamp", () => {
  it("records the commit the build was made from beside the build, and reads it back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-stamp-"));
    expect(readStamp(dir)).toBeNull();
    const at = new Date("2026-10-25T12:00:00Z");
    writeStamp(dir, "a1b2c3d4", at);
    expect(readStamp(dir)).toEqual({ commit: "a1b2c3d4", built_at: "2026-10-25T12:00:00.000Z" });
    expect(fs.existsSync(path.join(dir, ".next", "collector-build.json"))).toBe(true);
  });
  it("is no stamp at all when the file is missing, unreadable, or names no commit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-stamp-"));
    write(path.join(dir, ".next", "collector-build.json"), "{not json");
    expect(readStamp(dir)).toBeNull();
    write(path.join(dir, ".next", "collector-build.json"), '{"built_at":"2026-10-25T12:00:00Z"}');
    expect(readStamp(dir)).toBeNull();
  });
});

describe("next.config.ts", () => {
  it("builds into COLLECTOR_DIST_DIR when the rebuild job sets it, and into .next otherwise", async () => {
    const before = process.env.COLLECTOR_DIST_DIR;
    try {
      delete process.env.COLLECTOR_DIST_DIR;
      vi.resetModules();
      expect((await import("@/next.config")).default.distDir).toBe(".next");
      process.env.COLLECTOR_DIST_DIR = STAGING;
      vi.resetModules();
      expect((await import("@/next.config")).default.distDir).toBe(STAGING);
    } finally {
      if (before === undefined) delete process.env.COLLECTOR_DIST_DIR;
      else process.env.COLLECTOR_DIST_DIR = before;
      vi.resetModules();
    }
  });
});

describe("tsconfig.json", () => {
  it("already names the staging folder's types, so a build there leaves the live checkout's tsconfig as committed", () => {
    // `next build` adds `<distDir>/types/**/*.ts` to tsconfig's include when it is missing, which would leave the
    // live checkout with a changed file every run and in the way of the next pull.
    const include = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")).include as string[];
    expect(include).toEqual(expect.arrayContaining([`${STAGING}/types/**/*.ts`, `${STAGING}/dev/types/**/*.ts`]));
  });
});

describe("swapIn", () => {
  it("puts the staged build where the page serves it and deletes the old one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-swap-"));
    write(path.join(dir, ".next", "BUILD_ID"), "old\n");
    write(path.join(dir, STAGING, "BUILD_ID"), "new\n");
    swapIn(dir);
    expect(fs.readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8")).toBe("new\n");
    expect(fs.readdirSync(dir).sort()).toEqual([".next"]);
  });
  it("works when nothing was served yet", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-swap-"));
    write(path.join(dir, STAGING, "BUILD_ID"), "new\n");
    swapIn(dir);
    expect(fs.readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8")).toBe("new\n");
  });
});

describe("restartWait", () => {
  it("lets a build in at once with no restart on record, or five minutes after the last one", () => {
    expect(restartWait(null, 10_000_000)).toBe(0);
    expect(restartWait(10_000_000 - RESTART_GAP_MS, 10_000_000)).toBe(0);
    expect(restartWait(10_000_000 - 60_000, 10_000_000)).toBe(RESTART_GAP_MS - 60_000);
  });
  it("never waits longer than five minutes, even for a record from a clock set ahead", () => {
    expect(restartWait(10_000_000 + 3_600_000, 10_000_000)).toBe(RESTART_GAP_MS);
  });
  it("reads back the restart the job records in the served build", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-restart-"));
    expect(lastRestart(dir)).toBeNull();
    write(path.join(dir, SERVED, "BUILD_ID"), "x\n");
    markRestart(dir, new Date("2026-11-11T12:00:00Z"));
    expect(lastRestart(dir)).toBe(Date.parse("2026-11-11T12:00:00Z"));
  });
});

describe("the rebuild job", () => {
  it("pulls the checkout to main, builds, swaps the build in and restarts the page, with no click (card #122)", () => {
    const w = world();
    const old = w.head(w.live);
    writeStamp(w.live, old);
    const newer = w.merge("second");
    expect(w.head(w.live)).not.toBe(newer); // the checkout is behind main: the job's pull is what moves it

    const r = w.run();
    expect(r.out).toContain("[rebuild]");
    expect(r.code).toBe(0);
    expect(w.head(w.live)).toBe(newer);
    // The new build serves, the old one and the staging folder are gone, and the page restarted once onto it.
    expect(w.served()).toBe("new");
    expect(fs.readFileSync(w.file(`${SERVED}/static/app.js`), "utf8").trim()).toBe("chunk");
    expect(w.stamp()).toBe(newer);
    expect(w.staged()).toBeNull();
    expect(fs.existsSync(w.file(".next-previous"))).toBe(false);
    expect(w.restarts()).toBe(1);
    expect(r.out).toContain("[update] restarted on");

    // At most one restart per commit: the next run, with main where it was, does nothing at all.
    const again = w.run();
    expect(again.code).toBe(0);
    expect(again.out).toBe("");
    expect(w.restarts()).toBe(1);
  });

  it("keeps the old build serving when the build fails after wiping its folder, as next build does, and says so", () => {
    const w = world();
    const old = w.head(w.live);
    writeStamp(w.live, old);
    // The same pull as a healthy run, then a build that empties its distDir and fails — as a broken main does.
    write(
      w.file("package.json"),
      `${JSON.stringify({ name: "live", scripts: { build: fakeNextBuild("new", true) } }, null, 2)}\n`,
    );
    w.merge("second");

    const r = w.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("build failed");
    // The served build is exactly as it was: its BUILD_ID, its chunk and its stamp.
    expect(w.served()).toBe("old");
    expect(fs.readFileSync(w.file(".next/static/app.js"), "utf8").trim()).toBe("old chunk");
    expect(w.stamp()).toBe(old);
    expect(w.staged()).toBeNull();
    expect(fs.existsSync(w.file(STAGING))).toBe(false);
    expect(w.restarts()).toBe(0);
  });

  it("never builds in the served folder, so the page keeps its build for the whole length of a build", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));
    // A build that reads back what the page is serving midway, after it has emptied its own folder.
    const seen = w.file("seen-during-build.txt");
    const build = fakeNextBuild("new", false, `cat .next/BUILD_ID > ${seen} 2>/dev/null;`);
    write(
      w.file("package.json"),
      `${JSON.stringify({ name: "live", scripts: { build, postbuild: `bun ${STAMP_SCRIPT}` } }, null, 2)}\n`,
    );
    w.merge("second");

    expect(w.run().code).toBe(0);
    expect(fs.readFileSync(seen, "utf8").trim()).toBe("old");
    expect(w.served()).toBe("new");
  });

  it("does nothing at all when the build is the one main serves", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));

    const r = w.run();
    expect(r.code).toBe(0);
    expect(w.built()).toBe(false);
    expect(w.staged()).toBeNull();
    expect(w.restarts()).toBe(0);
  });

  it("never restarts twice within five minutes: a newer main stays staged until a later run puts it in service", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));
    const second = w.merge("second");
    expect(w.run().code).toBe(0);
    expect(w.restarts()).toBe(1);

    // main moves again a minute later: the job builds it and stages it, and restarts nothing.
    const third = w.merge("third");
    const soon = w.run();
    expect(soon.code).toBe(0);
    expect(soon.out).toContain("stays staged");
    expect(w.stamp()).toBe(second);
    expect(w.stagedStamp()).toBe(third);
    expect(w.restarts()).toBe(1);

    // Still within the five minutes: no build again, no restart, and --check says what waits.
    const quiet = w.run();
    expect(quiet.out).not.toContain("rebuilding");
    expect(w.restarts()).toBe(1);
    expect(w.run("--check").out).toContain("would swap it in and restart the page once five minutes have passed");

    // Five minutes after the last restart, the next run puts the staged build in service: once.
    markRestart(w.live, new Date(Date.now() - RESTART_GAP_MS - 1000));
    const later = w.run();
    expect(later.code).toBe(0);
    expect(later.out).not.toContain("rebuilding");
    expect(w.stamp()).toBe(third);
    expect(w.staged()).toBeNull();
    expect(w.restarts()).toBe(2);
    expect(w.run().out).toBe("");
    expect(w.restarts()).toBe(2);
  });

  it("puts a build left staged by an older Collector in service with no click", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));
    const newer = w.merge("second");
    git(w.live, "pull", "--quiet", "origin", "main");
    // What the live checkout holds the day this card lands: a build of main, staged, waiting for a click.
    write(w.file(`${STAGING}/BUILD_ID`), "new\n");
    writeStamp(w.live, newer, new Date(), STAGING);

    const r = w.run();
    expect(r.code).toBe(0);
    expect(w.served()).toBe("new");
    expect(w.stamp()).toBe(newer);
    expect(w.restarts()).toBe(1);
  });

  it("removes a staged build of another commit when the page already serves main", () => {
    const w = world();
    const first = w.head(w.live);
    const newer = w.merge("second");
    // The page restarted by hand onto main, and a build of the commit before it is still staged: the button must not
    // offer that one.
    writeStamp(w.live, newer);
    write(w.file(`${STAGING}/BUILD_ID`), "older\n");
    writeStamp(w.live, first, new Date(), STAGING);

    const r = w.run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("removed a staged build");
    expect(fs.existsSync(w.file(STAGING))).toBe(false);
    expect(w.served()).toBe("old");
    expect(w.stamp()).toBe(newer);
    expect(w.restarts()).toBe(0);
  });

  it("--check reports what a run would do, from the last fetch, and touches nothing", () => {
    const w = world();
    const old = w.head(w.live);
    writeStamp(w.live, old);
    w.merge("second");

    // --check never fetches — it is the read-only form — so it answers from the last fetch, which the every-five-
    // minute job always just made. With nothing fetched since, the checkout cannot know main moved: it says so
    // rather than guessing, and still writes nothing.
    expect(w.run("--check").out).toContain("nothing to do");
    expect(w.head(w.live)).toBe(old);

    git(w.live, "fetch", "--quiet", "origin", "main");
    const r = w.run("--check");
    expect(r.code).toBe(0);
    expect(r.out).toContain("would");
    expect(w.head(w.live)).toBe(old);
    expect(w.built()).toBe(false);
    expect(w.stamp()).toBe(old);
  });

  it("refuses a checkout that is not on main rather than building another branch", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));
    w.merge("second");
    git(w.live, "checkout", "-b", "other");

    const r = w.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("not main");
    expect(w.built()).toBe(false);
  });
});
