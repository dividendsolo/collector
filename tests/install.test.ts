import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const INSTALL = read("install.sh");
const README = read("README.md");
const section = (name: string) => README.split(`## ${name}`)[1].split("\n## ")[0];
const ONE_COMMAND = "curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh";

describe("install.sh", () => {
  it("is a valid sh script, and prints its help read from a pipe (`curl | sh`)", () => {
    expect(spawnSync("sh", ["-n", path.join(ROOT, "install.sh")], { encoding: "utf8" }).status).toBe(0);
    const piped = spawnSync("sh", ["-s", "--", "--help"], { input: INSTALL, encoding: "utf8" });
    expect(piped.status).toBe(0);
    expect(piped.stdout).toContain(ONE_COMMAND);
    expect(piped.stdout).toContain("--no-install-bun");
  });
  it("refuses an option it does not know, with the help, and exits non-zero", () => {
    const bad = spawnSync("sh", [path.join(ROOT, "install.sh"), "--nonsense"], { cwd: ROOT, encoding: "utf8" });
    expect(bad.status).toBeGreaterThan(0);
    expect(bad.stderr).toContain("unknown option: --nonsense");
  });
  it("holds no path, host, user or job name that only exists on our own machines", () => {
    expect(INSTALL).not.toMatch(/james/i);
    expect(INSTALL).not.toMatch(/\/Users\//);
    expect(INSTALL).not.toMatch(/com\.(james|example)\./);
    expect(INSTALL).not.toMatch(/dividendsolo\.com/);
  });
  it("reads the repo from the checkout it is run in, and clones into the user's own home otherwise", () => {
    expect(INSTALL).toContain("is_checkout");
    expect(INSTALL).toContain("$HOME/collector");
    expect(INSTALL).toContain("COLLECTOR_DIR");
  });
  it("uses the port the app reads, and starts the app the app's own way", () => {
    expect(INSTALL).toContain("COLLECTOR_PORT");
    expect(INSTALL).toContain("bun start");
  });
  it("installs the folder it is run from, even as `sh install.sh` with no path in `$0`", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "collector-install-")));
    fs.writeFileSync(path.join(dir, "install.sh"), INSTALL);
    for (const file of ["package.json", "collect.py"]) fs.writeFileSync(path.join(dir, file), "{}");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    const python = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
    }).stdout.trim();
    fs.symlinkSync(python, path.join(bin, "python3"));
    const out = spawnSync("/bin/sh", ["install.sh", "--no-install-bun"], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: bin, HOME: dir, NODE_ENV: "test" },
    });
    expect(out.stdout).toContain(`Collector is here: ${dir}`);
    expect(out.stderr).toContain("bun is not installed");
    const piped = spawnSync("/bin/sh", ["-s", "--", "--dir", path.join(dir, "a-repo")], {
      input: INSTALL,
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "collector-install-")),
      encoding: "utf8",
      env: { PATH: bin, HOME: dir, NODE_ENV: "test", COLLECTOR_REPO_URL: "https://example.invalid/collector.git" },
    });
    expect(piped.stdout).not.toContain("Collector is here");
    expect(piped.stderr).toContain("git is needed to download Collector");
  });
  it("names the Command Line Tools on a Mac that has none, so the clone it is about to try is not a mystery", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "collector-install-")));
    fs.writeFileSync(path.join(dir, "install.sh"), INSTALL);
    for (const file of ["package.json", "collect.py"]) fs.writeFileSync(path.join(dir, file), "{}");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    for (const [name, body] of [
      ["uname", "#!/bin/sh\necho Darwin\n"],
      ["xcode-select", "#!/bin/sh\nexit 1\n"],
    ]) {
      fs.writeFileSync(path.join(bin, name), body);
      fs.chmodSync(path.join(bin, name), 0o755);
    }
    const out = spawnSync("/bin/sh", ["install.sh", "--no-install-bun"], {
      cwd: dir,
      encoding: "utf8",
      env: { PATH: bin, HOME: dir, NODE_ENV: "test" },
    });
    expect(out.stdout).toContain("no Command Line Tools");
    expect(out.stdout).toContain("xcode-select --install");
    expect(INSTALL).toContain("xcode-select --install");
  });
});

describe("README, for a stranger", () => {
  it("shows a screenshot of the main page, and the file is committed beside it", () => {
    const [, src = ""] = README.match(/!\[[^\]]*\]\((docs\/[\w./-]+)\)/) ?? [];
    expect(src).not.toBe("");
    const file = path.join(ROOT, src);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(2000);
  });
  it("gives one install command, and every command it names runs on a machine that is not ours", () => {
    const install = section("Install");
    expect(install).toContain(ONE_COMMAND);
    expect(install).not.toMatch(/james|\/Users\//i);
  });
  it("opens with what it is and who it is for", () => {
    const lede = README.split("## ")[0];
    expect(lede).toMatch(/One local page that shows every cron job and every agent run/);
    expect(lede).toMatch(/for one person running several agents/);
  });
  it("documents the two settings cards, `statuses` and `watch`, with their shape", () => {
    const settings = section("Settings");
    expect(settings).toContain("`statuses`");
    expect(settings).toContain("`watch`");
    expect(settings).toMatch(/waiting.*working.*done/s);
    expect(settings).toContain('"heartbeat"');
    expect(settings).toContain("check:config");
  });
  it("tells a reader with no agent crew where to start", () => {
    expect(README).toMatch(/no agent crew yet/i);
    expect(README).toContain("https://github.com/NousResearch/hermes-agent");
  });
});
