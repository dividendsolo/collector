import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What a stranger installs with (collector#55): the one command, and the README that carries it. The card's Done-when
 * is that a clean checkout on a machine with none of the user's files installs with that command and opens the main
 * page; `tests/clean-machine.test.ts` is the other half of it, the reader on a machine with none of the tools.
 *
 * Every path, name and key in these two files has to work on somebody else's machine, so the test that matters most
 * here is the one that fails when our own machine leaks into them.
 */
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const INSTALL = read("install.sh");
const README = read("README.md");
/** One `## ` section of the README, up to the next heading. */
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
    expect(INSTALL).toContain("is_checkout"); // the folder it sits in, when it came as a file
    expect(INSTALL).toContain("$HOME/collector"); // the piped form's own default folder
    expect(INSTALL).toContain("COLLECTOR_DIR");
  });
  it("uses the port the app reads, and starts the app the app's own way", () => {
    expect(INSTALL).toContain("COLLECTOR_PORT");
    expect(INSTALL).toContain("bun start");
  });
  it("installs the folder it is run from, even as `sh install.sh` with no path in `$0`", () => {
    // A folder that looks like a Collector checkout, on a machine with nothing on PATH: the run stops at the bun
    // check, which is past the decision this test is about — that the script read the checkout, not cloned one.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-install-"));
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
    // Piped in from a folder with nothing in it, the same script takes the clone branch: the git check that only
    // that branch has is what fails.
    const piped = spawnSync("/bin/sh", ["-s", "--", "--dir", path.join(dir, "a-repo")], {
      input: INSTALL,
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), "collector-install-")),
      encoding: "utf8",
      env: { PATH: bin, HOME: dir, NODE_ENV: "test", COLLECTOR_REPO_URL: "https://example.invalid/collector.git" },
    });
    expect(piped.stdout).not.toContain("Collector is here");
    expect(piped.stderr).toContain("git is needed to download Collector");
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
    expect(settings).toContain("check:config"); // every other key, and the check that catches a typo
  });
  it("tells a reader with no agent crew where to start", () => {
    expect(README).toMatch(/no agent crew yet/i);
    expect(README).toContain("https://github.com/NousResearch/hermes-agent");
  });
});
