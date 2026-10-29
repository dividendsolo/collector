import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readStamp, SERVED, STAGING, writeStamp } from "@/lib/rebuild";
import {
  bunPath,
  clickAction,
  pendingCommit,
  rememberServed,
  restartCommand,
  servedSide,
  stagedSide,
  updateState,
} from "@/lib/update";

/**
 * The Update button (card #41): the two builds it compares, the click it offers, and the one write a click makes
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
  /** The click's script, as `POST /api/update` runs it, with an echo for the restart. */
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

describe("updateState", () => {
  it("offers nothing while no newer build is staged", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" });
    expect(stagedSide(w.dir)).toBeNull();
    expect(updateState(w.dir)).toEqual({
      running: { id: "old", commit: "a1b2c3d4" },
      staged: null,
      ready: false,
    });
  });

  it("offers the click when a build of a newer commit waits staged", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    const state = updateState(w.dir);
    expect(state.running).toEqual({ id: "old", commit: "a1b2c3d4" });
    expect(state.staged).toEqual({ id: "new", commit: "e5f6a7b8" });
    expect(state.ready).toBe(true);
  });

  it("offers nothing when the staged build is already the one serving", () => {
    const w = world({ id: "same", commit: "a1b2c3d4" }, { id: "same", commit: "a1b2c3d4" });
    expect(updateState(w.dir).ready).toBe(false);
  });

  it("reads the running build from boot, not from the folder a swap has already moved", () => {
    const before = readStamp(ROOT)?.commit ?? null;
    const w = world({ id: "new", commit: "e5f6a7b8" });
    try {
      // The swap landed on disk, and this process still runs what it booted on: that is what the page must be told.
      rememberServed({ id: "old", commit: "a1b2c3d4" });
      expect(servedSide(w.dir)).toEqual({ id: "old", commit: "a1b2c3d4" });
      expect(updateState(w.dir).running.id).toBe("old");
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

describe("clickAction", () => {
  it("swaps and restarts when a newer build waits", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" }, { id: "new", commit: "e5f6a7b8" });
    expect(clickAction(updateState(w.dir))).toEqual({ ok: true, commit: "e5f6a7b8" });
  });
  it("changes nothing and says why when no build waits", () => {
    const w = world({ id: "old", commit: "a1b2c3d4" });
    expect(clickAction(updateState(w.dir))).toEqual({ ok: false, why: "no build is staged" });
  });
  it("changes nothing when the staged build is the one already serving", () => {
    const w = world({ id: "same", commit: "a1b2c3d4" }, { id: "same", commit: "a1b2c3d4" });
    expect(clickAction(updateState(w.dir))).toEqual({ ok: false, why: "that build is already the one serving" });
  });
});

describe("restartCommand", () => {
  it("is the launchd job the page is served by, whole", () => {
    expect(restartCommand("com.example.collector")).toBe(
      `launchctl kickstart -k gui/${process.getuid ? process.getuid() : ""}/com.example.collector`,
    );
  });
});

describe("bunPath", () => {
  it("is this process's own Bun when Bun is running it", () => {
    expect(bunPath("/Users/me/.bun/bin/bun", "/nothing/here")).toBe("/Users/me/.bun/bin/bun");
  });

  it("is the first bun on PATH when node is running it — the live server, whose `next start` is a node bin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-bun-"));
    const at = path.join(dir, "bun");
    fs.writeFileSync(at, "#!/bin/sh\n");
    fs.chmodSync(at, 0o755);
    expect(bunPath("/opt/homebrew/Cellar/node/26.12.1/bin/node", `/nothing/here:${dir}:/usr/bin`)).toBe(at);
  });

  it("is nobody when there is no Bun to run the script with", () => {
    expect(bunPath("/usr/bin/node", "/nonexistent:/also/gone")).toBeNull();
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

    // A second click, or a page left open on a build already in service: nothing staged, nothing done.
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
    // The swap stands — the new build is the one on disk — and the next click finds nothing staged, so a failure
    // here shows up as a page that has not reloaded, not as a build that keeps being offered.
    expect(w.id(SERVED)).toBe("new");
    expect(w.id(STAGING)).toBeNull();
    expect(w.stagedStamp()).toBeNull();
  });
});
