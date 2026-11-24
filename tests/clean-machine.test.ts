import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function snapshot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-clean-"));
  const bin = path.join(dir, "bin");
  const home = path.join(dir, "home");
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const python = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(python, path.join(bin, "python3"));
  const run = spawnSync(python, [path.join(ROOT, "collect.py"), "{}"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { PATH: bin, HOME: home, NODE_ENV: "test" },
  });
  return { run, dir };
}

describe("a clean machine (collector#55)", () => {
  it("reads it with no tool of its own and no file of the user's: no crash, empty rows", () => {
    const { run } = snapshot();
    expect(run.stderr).toBe("");
    expect(run.stdout).not.toContain("Traceback");
    expect(run.status).toBe(0);
    const snap = JSON.parse(run.stdout);
    expect(Array.isArray(snap.jobs)).toBe(true);
    expect(snap.jobs).toEqual([]);
    expect(snap.running).toEqual([]);
    expect(snap.watch).toEqual([]);
    expect(snap.profiles).toEqual([]);
    expect(snap.hermes_gateway).toBeNull();
    expect(snap.host_broken).toEqual([]);
    expect(snap.crew).toBeNull();
    expect(Object.keys(snap.network.networks).sort()).toEqual(["internet", "lan", "tailnet"]);
    expect(Array.isArray(snap.network.sockets)).toBe(true);
    for (const s of snap.network.sockets) expect(["internet", "lan", "tailnet", "machine"]).toContain(s.reach);
    expect(Array.isArray(snap.network.connections)).toBe(true);
  });

  it("still names the machine it read, whatever it is", () => {
    const { run } = snapshot();
    const snap = JSON.parse(run.stdout);
    expect(typeof snap.host).toBe("string");
    expect(snap.host.length).toBeGreaterThan(0);
    expect(typeof snap.now).toBe("string");
  });
});
