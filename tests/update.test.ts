import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStamp, SERVED, STAGING, writeStamp } from "@/lib/rebuild";
import { pendingCommit, rememberServed, restartCommand, servedSide, stagedSide } from "@/lib/update";

/**
 * The two builds of the live Collector (cards #41, #122), and the swap and restart the rebuild job makes
 * (`scripts/apply-update.ts`) in a throwaway checkout. Nothing here goes near the machine's own Collector, and the
 * restart is an echo: the real one is the launchd job, which only the live page runs.
 */
const ROOT = process.cwd();
const APPLY = path.join(ROOT, "scripts", "apply-update.ts");

const write = (p: string, body: string) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};

/** A checkout the way the live one sits: a build the page serves, and a finished one staged beside it when asked. */
function world(served: { id: string; commit: string }, staged?: { id: string; commit: string }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-update-"));
  write(path.join(dir, SERVED, "BUILD_ID"), `${served.id}\n`);
  writeStamp(dir, served.commit);
  if (staged) {
    write(path.join(dir, STAGING, "BUILD_ID"), `${staged.id}\n`);
    writeStamp(dir, staged.commit, new Date(), STAGING);
  }
  /** The BUILD_ID a folder holds, null when it holds no build. */
  const id = (folder: string) =>
    fs.existsSync(path.join(dir, folder, "BUILD_ID"))
      ? fs.readFileSync(path.join(dir, folder, "BUILD_ID"), "utf8").trim()
      : null;
  /** The swap and restart, as the rebuild job runs it, with an echo for the restart. */
  const apply = () =>
    spawnSync("bun", [APPLY, "--dir", dir, "--restart", "echo restarted > restarted.txt"], {
      cwd: dir,
      encoding: "utf8",
    });
  return {
    dir,
    id,
    apply,
    restarted: () => fs.existsSync(path.join(dir, "restarted.txt")),
    stagedStamp: () => readStamp(dir, STAGING)?.commit ?? null,
    stamp: () => readStamp(dir)?.commit ?? null,
  };
}

describe("the two builds", () => {
  it("finds no staged build when none waits, and the staged one when it does", () => {
    expect(stagedSide(world({ id: "old", commit: "a1b2c3d4" }).dir)).toBeNull();
    const w = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    expect(stagedSide(w.dir)).toEqual({ id: "new", commit: "e5f6a7b8" });
  });

  it("reads the running build from boot, not from the folder a swap has already moved", () => {
    const before = readStamp(ROOT)?.commit ?? null;
    const w = world({ id: "new", commit: "e5f6a7b8" });
    try {
      // The swap landed on disk, and this process still runs what it booted on: that is what the page must be told.
      rememberServed({ id: "old", commit: "a1b2c3d4" });
      expect(servedSide(w.dir)).toEqual({ id: "old", commit: "a1b2c3d4" });
    } finally {
      rememberServed({ id: null, commit: null });
    }
    // With nothing recorded — `bun dev`, or a test — it answers from the folder, as the route did before this card.
    expect(servedSide(w.dir)).toEqual({ id: "new", commit: "e5f6a7b8" });
    expect(readStamp(ROOT)?.commit ?? null).toBe(before);
  });
});

describe("pendingCommit", () => {
  it("is the staged build's commit while one waits, and the served one's otherwise", () => {
    const waiting = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    expect(pendingCommit(waiting.dir)).toBe("e5f6a7b8");
    const current = world({ id: "old", commit: "a1b2c3d4" });
    expect(pendingCommit(current.dir)).toBe("a1b2c3d4");
  });
});

describe("restartCommand", () => {
  it("is the launchd job the page is served by, whole", () => {
    expect(restartCommand("com.example.collector")).toBe(
      `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/com.example.collector`,
    );
  });
});

describe("scripts/apply-update.ts", () => {
  it("moves the staged build into the served folder and restarts on it, once", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    const r = w.apply();
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("[update]");
    expect(w.id(SERVED)).toBe("new");
    expect(w.stamp()).toBe("e5f6a7b8");
    expect(fs.existsSync(path.join(w.dir, STAGING))).toBe(false);
    expect(fs.existsSync(path.join(w.dir, ".next-previous"))).toBe(false);
    expect(w.restarted()).toBe(true);

    // A second run with the build already in service: nothing staged, nothing done.
    const again = w.apply();
    expect(again.status).toBe(0);
    expect(`${again.stdout}${again.stderr}`).toContain("nothing staged");
    expect(w.id(SERVED)).toBe("new");
  });

  it("leaves the served build alone, and never restarts, when nothing is staged", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" });
    const r = w.apply();
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("nothing staged");
    expect(w.id(SERVED)).toBe("old");
    expect(w.stamp()).toBe("a1b2c3d4");
    expect(w.restarted()).toBe(false);
  });

  it("keeps the staged build and says so when the restart itself fails", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    const r = spawnSync("bun", [APPLY, "--dir", w.dir, "--restart", "exit 3"], { cwd: w.dir, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("could not restart");
    // The swap stands — the new build is the one on disk — and the next run finds nothing staged, so a failure
    // here shows up as a page that has not reloaded, not as a restart tried every five minutes.
    expect(w.id(SERVED)).toBe("new");
    expect(w.id(STAGING)).toBeNull();
    expect(w.stagedStamp()).toBeNull();
  });
});
