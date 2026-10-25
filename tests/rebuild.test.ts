import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStamp, rebuildPlan, writeStamp } from "@/lib/rebuild";

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

/** The world the job runs in: a bare `origin` with two commits on main, `live` (the checkout the job is pointed at)
 * and `work` (where a newer commit on main is made). `live` holds the package.json the live Collector's checkout
 * holds: `bun run build`, whose postbuild records the commit the build was made from. */
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
    `${JSON.stringify({ name: "live", scripts: { build: "echo built > built.txt", postbuild: `bun ${STAMP_SCRIPT}` } }, null, 2)}\n`,
  );

  /** The commit one of the world's checkouts is at. */
  const head = (dir: string) => git(dir, "rev-parse", "HEAD").trim();
  /** A newer commit on main, made where the checkout the job reads has not seen it: another clone, pushed, which is
   * what a merge to main does to a checkout nobody has pulled. */
  const merge = (body: string) => {
    commit(work, body);
    git(work, "push", "origin", "main");
    return git(work, "rev-parse", "HEAD").trim();
  };
  /** The job, as the launchd job runs it: `bun scripts/rebuild-if-stale.ts --dir <checkout>`. The restart is an
   * echo here — the one step that needs the machine's own launchd job — so the whole run can be read back. */
  const run = (...flags: string[]) => {
    const r = spawnSync("bun", [JOB, "--dir", live, "--restart", "echo restarted > restarted.txt", ...flags], {
      cwd: live,
      encoding: "utf8",
      env: gitEnv(),
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const file = (name: string) => path.join(live, name);
  const built = () => fs.existsSync(file("built.txt"));
  const restarted = () => fs.existsSync(file("restarted.txt"));
  const stamp = () => readStamp(live)?.commit ?? null;

  return { root, origin, live, work, head, merge, run, file, built, restarted, stamp };
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

describe("the rebuild job", () => {
  it("pulls the checkout to main, builds, records the commit it built, and restarts the page", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));
    const newer = w.merge("second");
    expect(w.head(w.live)).not.toBe(newer); // the checkout is behind main: the job's pull is what moves it

    const r = w.run();
    expect(r.out).toContain("[rebuild]");
    expect(r.code).toBe(0);
    expect(w.head(w.live)).toBe(newer);
    expect(w.built()).toBe(true);
    expect(w.stamp()).toBe(newer);
    expect(w.restarted()).toBe(true);
  });

  it("keeps the old build serving when the build fails, and says so", () => {
    const w = world();
    const old = w.head(w.live);
    writeStamp(w.live, old);
    // The same pull as a healthy run, then a build that fails — as a broken main does.
    write(w.file("package.json"), `${JSON.stringify({ name: "live", scripts: { build: "exit 3" } }, null, 2)}\n`);
    w.merge("second");

    const r = w.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("build failed");
    expect(w.stamp()).toBe(old);
    expect(w.restarted()).toBe(false);
  });

  it("does nothing at all when the build is the one main serves", () => {
    const w = world();
    writeStamp(w.live, w.head(w.live));

    const r = w.run();
    expect(r.code).toBe(0);
    expect(w.built()).toBe(false);
    expect(w.restarted()).toBe(false);
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
