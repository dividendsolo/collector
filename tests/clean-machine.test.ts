import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A clean machine: none of the tools collect.py reads and none of the user's files. This is a stranger's first
 * install (collector#55): the crate of a fresh macOS or Linux box, where `ps`, `git`, `docker`, `systemctl`,
 * `crontab`, `launchctl`, `ss`, `lsof` and `tailscale` may each be missing, and `~/.hermes` may not exist.
 *
 * The reader is run as every machine runs it — the real `python3 collect.py` — because the failure that matters
 * here is a Python traceback on stdout-at-a-stranger, which the page then shows as `Could not read <machine>`.
 */
const ROOT = process.cwd();

/** One snapshot of a machine with only python3 on PATH and an empty home. */
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
    // The Network section (collector#65) reads without failing. A Mac keeps lsof and ifconfig at fixed paths, which
    // collect.py reads by path, so the section may hold this machine's own ports: what it holds is the shape, never
    // an exception. `ssh` is read from a file rather than a tool, so it is whatever this machine's config file holds.
    expect(Object.keys(snap.network.networks).sort()).toEqual(["internet", "lan", "tailnet"]);
    expect(Array.isArray(snap.network.sockets)).toBe(true);
    for (const s of snap.network.sockets) expect(["internet", "lan", "tailnet", "machine"]).toContain(s.reach);
    // What goes out (collector#66) reads the same way: lsof and nettop sit at fixed paths on a Mac, so the rows may
    // be this machine's own, and a machine with neither tool reads none.
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
