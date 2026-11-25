import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BUILDER = {
  repo: "situation",
  kind: "build",
  card: 920,
  type: "agent",
  name: "situation-builder",
  seconds: 2040,
};
const REVIEWER = {
  repo: "echo-form",
  kind: "review",
  card: 55,
  type: "agent",
  name: "echo-form-reviewer",
  seconds: 360,
};
const PYTHON = execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
const SESSION = { repo: "collector", kind: "session", card: 12, type: "agent", name: "Claude Code", seconds: 9000 };

function read({
  hold = [] as string[],
  running = [] as object[],
  steps = [] as object[],
  paused = false,
  files = ["build-1.lock", "build-2.lock", "review.lock"],
  scratch = true,
  env = process.env as NodeJS.ProcessEnv,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-crew-"));
  const foreman = path.join(dir, "foreman");
  if (scratch) {
    fs.mkdirSync(foreman);
    for (const f of files) fs.writeFileSync(path.join(foreman, f), "");
  }
  const pause = path.join(dir, "runs-paused");
  if (paused) fs.writeFileSync(pause, "");
  const holder =
    "import fcntl, sys; f = open(sys.argv[1], 'w'); fcntl.flock(f, fcntl.LOCK_EX); print(flush=True); sys.stdin.read()";
  const code = [
    "import json, os, subprocess, sys",
    `sys.path.insert(0, ${JSON.stringify(process.cwd())})`,
    "import collect",
    `holders = {n: subprocess.Popen([sys.executable, "-c", ${JSON.stringify(holder)}, os.path.join(${JSON.stringify(foreman)}, n)], stdin=subprocess.PIPE, stdout=subprocess.PIPE) for n in ${JSON.stringify(hold)}}`,
    "[h.stdout.readline() for h in holders.values()]",
    `steps = [dict(s, pid=holders[s["pid"]].pid) for s in json.loads(${JSON.stringify(JSON.stringify(steps))})]`,
    `print(json.dumps(collect.crew_read(json.loads(${JSON.stringify(JSON.stringify(running))}), steps=steps, scratch=${JSON.stringify(foreman)}, pause_file=${JSON.stringify(pause)})))`,
    "[h.kill() for h in holders.values()]",
  ].join("\n");
  return JSON.parse(execFileSync(PYTHON, ["-c", code], { encoding: "utf8", env }));
}

const stepOf = (row: { repo: string; card: number }, step: string, lock: string) => ({
  repo: row.repo,
  card: row.card,
  step,
  since: 0,
  pid: lock,
});

describe("collect.py's crew reading (collector#231)", () => {
  it("reads every slot free when no lock is held", () => {
    expect(read()).toEqual({
      paused: false,
      slots: [
        { slot: "build-1", role: "build", state: "free" },
        { slot: "build-2", role: "build", state: "free" },
        { slot: "review", role: "review", state: "free" },
      ],
    });
  });

  it("reads a missing lock file as free", () => {
    expect(read({ files: [] }).slots.map((s: any) => s.state)).toEqual(["free", "free", "free"]);
  });

  it("reads a held slot and carries its repo, card and profile from the running rows", () => {
    const crew = read({
      hold: ["build-1.lock", "review.lock"],
      running: [SESSION, REVIEWER, BUILDER],
      steps: [stepOf(BUILDER, "building", "build-1.lock"), stepOf(REVIEWER, "reviewing", "review.lock")],
    });
    expect(crew.slots).toEqual([
      {
        slot: "build-1",
        role: "build",
        state: "held",
        repo: "situation",
        card: 920,
        profile: "situation-builder",
        seconds: 2040,
      },
      { slot: "build-2", role: "build", state: "free" },
      {
        slot: "review",
        role: "review",
        state: "held",
        repo: "echo-form",
        card: 55,
        profile: "echo-form-reviewer",
        seconds: 360,
      },
    ]);
  });

  it("finds a held slot's card when /usr/sbin is not on the PATH, as under launchd on a Mac", () => {
    const crew = read({
      hold: ["build-1.lock"],
      running: [BUILDER],
      steps: [stepOf(BUILDER, "building", "build-1.lock")],
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(crew.slots[0]).toMatchObject({ state: "held", repo: "situation", card: 920 });
  });

  it("keeps a held slot with no matching run held, with no card", () => {
    expect(read({ hold: ["build-2.lock"], running: [SESSION] }).slots[1]).toEqual({
      slot: "build-2",
      role: "build",
      state: "held",
    });
  });

  it("names no profile for a foreman step that holds the slot between agents", () => {
    const step = { repo: "pageroast", kind: "reviewing", card: 30, type: "script", name: "foreman.py", seconds: 157 };
    expect(
      read({ hold: ["review.lock"], running: [step], steps: [stepOf(step, "reviewing", "review.lock")] }).slots[2],
    ).toEqual({
      slot: "review",
      role: "review",
      state: "held",
      repo: "pageroast",
      card: 30,
      profile: null,
      seconds: 157,
    });
  });

  it("fills the reviewer row, and no builder row, with a review in its preparing step", () => {
    const review = {
      repo: "collector",
      kind: "preparing",
      card: 231,
      type: "script",
      name: "foreman.py",
      seconds: 300,
    };
    const opening = {
      repo: "situation",
      kind: "opening the PR",
      card: 920,
      type: "script",
      name: "foreman.py",
      seconds: 20,
    };
    const crew = read({
      hold: ["build-1.lock", "review.lock"],
      running: [review, opening],
      steps: [stepOf(review, "preparing", "review.lock"), stepOf(opening, "opening the PR", "build-1.lock")],
    });
    expect(crew.slots).toEqual([
      { slot: "build-1", role: "build", state: "held", repo: "situation", card: 920, profile: null, seconds: 20 },
      { slot: "build-2", role: "build", state: "free" },
      { slot: "review", role: "review", state: "held", repo: "collector", card: 231, profile: null, seconds: 300 },
    ]);
  });

  it("fills the reviewer row with its own review while it verifies, with no build held", () => {
    const review = {
      repo: "collector",
      kind: "verifying",
      card: 231,
      type: "script",
      name: "foreman.py",
      seconds: 240,
    };
    const crew = read({
      hold: ["review.lock"],
      running: [review],
      steps: [stepOf(review, "verifying", "review.lock")],
    });
    expect(crew.slots[0]).toEqual({ slot: "build-1", role: "build", state: "free" });
    expect(crew.slots[2]).toEqual({
      slot: "review",
      role: "review",
      state: "held",
      repo: "collector",
      card: 231,
      profile: null,
      seconds: 240,
    });
  });

  it("does not fill a held reviewer row with a merge of another card", () => {
    const merging = { repo: "pointy", kind: "merging", card: 59, type: "script", name: "foreman.py", seconds: 900 };
    const crew = read({
      hold: ["review.lock", "merge.lock"],
      files: ["build-1.lock", "build-2.lock", "review.lock", "merge.lock"],
      running: [merging, REVIEWER],
      steps: [stepOf(merging, "merging", "merge.lock"), stepOf(REVIEWER, "reviewing", "review.lock")],
    });
    expect(crew.slots[2]).toMatchObject({ slot: "review", repo: "echo-form", card: 55, profile: "echo-form-reviewer" });
  });

  it("does not try the merge lock or a base-gate lock as a position", () => {
    const crew = read({ files: ["build-1.lock", "merge.lock", "base-gate-situation.lock"] });
    expect(crew.slots.map((s: any) => s.slot)).toEqual(["build-1", "build-2", "review"]);
  });

  it("says paused when the pause file is there", () => {
    expect(read({ paused: true }).paused).toBe(true);
  });

  it("is null on a machine with no foreman", () => {
    expect(read({ scratch: false })).toBeNull();
  });
});
