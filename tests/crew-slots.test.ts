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
const SESSION = { repo: "collector", kind: "session", card: 12, type: "agent", name: "Claude Code", seconds: 9000 };

function read({
  hold = [] as string[],
  running = [] as object[],
  paused = false,
  files = ["build-1.lock", "build-2.lock", "review.lock"],
  scratch = true,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-crew-"));
  const foreman = path.join(dir, "foreman");
  if (scratch) {
    fs.mkdirSync(foreman);
    for (const f of files) fs.writeFileSync(path.join(foreman, f), "");
  }
  const pause = path.join(dir, "runs-paused");
  if (paused) fs.writeFileSync(pause, "");
  const code = [
    "import fcntl, json, os, sys",
    `sys.path.insert(0, ${JSON.stringify(process.cwd())})`,
    "import collect",
    `held = [open(os.path.join(${JSON.stringify(foreman)}, n), "w") for n in ${JSON.stringify(hold)}]`,
    "[fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB) for f in held]",
    `print(json.dumps(collect.crew_read(json.loads(${JSON.stringify(JSON.stringify(running))}), ${JSON.stringify(foreman)}, ${JSON.stringify(pause)})))`,
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8" }));
}

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
    const crew = read({ hold: ["build-1.lock", "review.lock"], running: [SESSION, REVIEWER, BUILDER] });
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

  it("keeps a held slot with no matching run held, with no card", () => {
    expect(read({ hold: ["build-2.lock"], running: [SESSION] }).slots[1]).toEqual({
      slot: "build-2",
      role: "build",
      state: "held",
    });
  });

  it("names no profile for a foreman step that holds the slot between agents", () => {
    const step = { repo: "pageroast", kind: "reviewing", card: 30, type: "script", name: "foreman.py", seconds: 157 };
    expect(read({ hold: ["review.lock"], running: [step] }).slots[2]).toEqual({
      slot: "review",
      role: "review",
      state: "held",
      repo: "pageroast",
      card: 30,
      profile: null,
      seconds: 157,
    });
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
