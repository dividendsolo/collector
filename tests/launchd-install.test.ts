import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts", "launchd.ts");
const SERVING = "com.example.collector.plist";
const REBUILD = "com.example.collector-rebuild.plist";
const UID = process.getuid?.() ?? 0;

const temp = (name: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
const agentsOf = (home: string) => path.join(home, "Library", "LaunchAgents");
const plistOf = (home: string, file: string) => fs.readFileSync(path.join(agentsOf(home), file), "utf8");
const programOf = (text: string) =>
  /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] ?? "";

function world(args: string[] = []) {
  const home = temp("collector-launchd-");
  const fake = path.join(home, "fake-launchctl");
  const log = path.join(home, "loads.txt");
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${log}\n`);
  fs.chmodSync(fake, 0o755);
  const r = spawnSync("bun", [SCRIPT, "--launchctl", fake, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  const loads = () =>
    fs.existsSync(log)
      ? fs
          .readFileSync(log, "utf8")
          .split("\n")
          .filter((l) => l.trim())
      : [];
  const loaded = (file: string) => [
    `bootout gui/${UID}/${labelOf(file)}`,
    `bootstrap gui/${UID} ${path.join(agentsOf(home), file)}`,
  ];
  return { home, code: r.status, out: `${r.stdout}${r.stderr}`, loads, loaded };
}

const labelOf = (file: string) => file.replace(".plist", "");

function fakeCheckout(template: string) {
  return checkoutAt(temp("collector-not-a-checkout-"), template);
}

function checkoutAt(dir: string, template: string) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{}\n");
  fs.writeFileSync(path.join(dir, "collect.py"), "");
  fs.writeFileSync(path.join(dir, "install.sh"), "");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "launchd"));
  fs.writeFileSync(path.join(dir, "launchd", SERVING), template);
  return dir;
}

const TEMPLATE = `<plist><dict>
  <key>Label</key><string>com.example.collector</string>
  <key>WorkingDirectory</key><string>/path/to/collector</string>
  <key>ProgramArguments</key>
  <array><string>/path/to/.bun/bin/bun</string><string>start</string></array>
  <key>EnvironmentVariables</key><dict><key>COLLECTOR_PORT</key><string>4000</string></dict>
</dict></plist>`;

describe("the launchd plists are templates", () => {
  it("carry the paths the script fills, so filling them stays the script's job", () => {
    const serving = fs.readFileSync(path.join(ROOT, "launchd", SERVING), "utf8");
    expect(serving).toContain("/path/to/collector");
    expect(serving).toContain("/path/to/.bun/bin/bun");
    expect(serving).toContain("<key>COLLECTOR_PORT</key>");
    const rebuild = fs.readFileSync(path.join(ROOT, "launchd", REBUILD), "utf8");
    expect(rebuild).toContain("/path/to/collector");
    expect(rebuild).toContain("rebuild-if-stale.ts");
    expect(rebuild).toContain("<string>--label</string>");
  });
});

describe("scripts/launchd.ts", () => {
  it("fills this checkout and the Bun that runs it into the job, then boots the old one out and loads it", () => {
    const w = world();
    expect(w.code).toBe(0);
    const text = plistOf(w.home, SERVING);
    expect(text).not.toContain("/path/to/");
    expect(text).toContain(`<string>${ROOT}</string>`);
    const bun = programOf(text);
    expect(bun.endsWith("bun")).toBe(true);
    expect(fs.existsSync(bun)).toBe(true);
    expect(text).toContain("<key>RunAtLoad</key><true/>");
    expect(text).toContain("<key>KeepAlive</key><true/>");
    expect(w.loads()).toEqual(w.loaded(SERVING));
    expect(w.out).toContain("Collector is at http://127.0.0.1:4000");
    expect(fs.existsSync(path.join(agentsOf(w.home), REBUILD))).toBe(false);
  });

  it("serves the port it is asked for, in the job and in what it says", () => {
    const w = world(["--port", "4011"]);
    expect(w.code).toBe(0);
    expect(plistOf(w.home, SERVING)).toContain("<key>COLLECTOR_PORT</key><string>4011</string>");
    expect(w.out).toContain("http://127.0.0.1:4011");
  });

  it("adds the rebuild job with --rebuild, pointed at that job's own script and at this checkout", () => {
    const w = world(["--rebuild"]);
    expect(w.code).toBe(0);
    const text = plistOf(w.home, REBUILD);
    expect(text).toContain(`<string>${path.join(ROOT, "scripts", "rebuild-if-stale.ts")}</string>`);
    expect(text).toContain("<key>StartInterval</key><integer>300</integer>");
    expect(w.loads()).toEqual([...w.loaded(SERVING), ...w.loaded(REBUILD)]);
    expect(plistOf(w.home, SERVING)).toContain("<key>KeepAlive</key><true/>");
  });

  it("loads a job again without failing when it is already loaded: the old one comes out first", () => {
    const w = world();
    const again = spawnSync("bun", [SCRIPT, "--launchctl", path.join(w.home, "fake-launchctl")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HOME: w.home },
    });
    expect(again.status).toBe(0);
    expect(w.loads().slice(2)).toEqual(w.loaded(SERVING));
  });

  it("--print writes nothing and shows the job it would load", () => {
    const w = world(["--print"]);
    expect(w.code).toBe(0);
    expect(w.out).toContain(`would write ${path.join(agentsOf(w.home), SERVING)} and load com.example.collector`);
    expect(w.out).toContain("<key>Label</key><string>com.example.collector</string>");
    expect(w.out).not.toContain("/path/to/");
    expect(w.loads()).toEqual([]);
    expect(fs.existsSync(path.join(agentsOf(w.home), SERVING))).toBe(false);
  });

  it("--uninstall boots both jobs out, removes both files, and says the folder is left alone", () => {
    const w = world(["--uninstall"]);
    expect(w.code).toBe(0);
    expect(w.loads()).toEqual([
      `bootout gui/${UID}/com.example.collector`,
      `bootout gui/${UID}/com.example.collector-rebuild`,
    ]);
    expect(w.out).toContain("no longer starts at login");
  });

  it("--uninstall removes the two plists an earlier run wrote", () => {
    const w = world(["--rebuild"]);
    expect(fs.existsSync(path.join(agentsOf(w.home), SERVING))).toBe(true);
    expect(fs.existsSync(path.join(agentsOf(w.home), REBUILD))).toBe(true);
    const out = spawnSync("bun", [SCRIPT, "--uninstall", "--launchctl", path.join(w.home, "fake-launchctl")], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HOME: w.home },
    });
    expect(out.status).toBe(0);
    expect(fs.existsSync(path.join(agentsOf(w.home), SERVING))).toBe(false);
    expect(fs.existsSync(path.join(agentsOf(w.home), REBUILD))).toBe(false);
  });

  it("escapes a checkout path that would break the plist XML, so what it writes is still a plist", () => {
    const dir = checkoutAt(path.join(temp("collector-odd-"), "a&b"), TEMPLATE);
    const w = world(["--dir", dir, "--print"]);
    expect(w.code).toBe(0);
    expect(w.out).toContain("a&amp;b");
    expect(w.out).not.toContain("a&b");
  });

  it("refuses a folder that is not a Collector checkout, and names --dir", () => {
    const w = world(["--dir", temp("collector-empty-")]);
    expect(w.code).toBe(1);
    expect(w.out).toContain("does not hold Collector");
  });

  it("refuses a template with a path it does not fill, rather than loading a job that cannot run", () => {
    const dir = fakeCheckout(
      TEMPLATE.replace("</dict>", "<key>StandardOutPath</key><string>/path/to/other.log</string></dict>"),
    );
    const w = world(["--dir", dir]);
    expect(w.code).toBe(1);
    expect(w.out).toContain("carries a /path/to path this script does not fill");
    expect(w.loads()).toEqual([]);
  });

  it("refuses a template with no label", () => {
    const dir = fakeCheckout(TEMPLATE.replace("<key>Label</key><string>com.example.collector</string>", ""));
    const w = world(["--dir", dir]);
    expect(w.code).toBe(1);
    expect(w.out).toContain("names no label");
  });
});

describe("README, the Mac's setup", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const section = readme.split("## Set it up on a Mac")[1].split("\n## ")[0];

  it("holds the three steps, from installing to the login job", () => {
    expect(section).toContain("xcode-select --install");
    expect(section).toMatch(/one command|install\.sh/);
    expect(section).toContain("config.json");
    expect(section).toContain("bun scripts/launchd.ts");
    expect(section).toContain("--rebuild");
    expect(section).toContain("--uninstall");
  });

  it("names the Command Line Tools as a requirement, since git and python3 come from them", () => {
    const requirements = readme.split("## Requirements")[1].split("\n## ")[0];
    expect(requirements).toContain("xcode-select --install");
    expect(requirements).toContain("`git`");
    expect(requirements).toContain("python3");
  });

  it("tells a reader not to copy config.example.json as it stands", () => {
    expect(section).toMatch(/[Dd]o not copy `?\[?config\.example\.json/);
  });

  it("gives the PATH line Bun needs on an account that has no shell startup file for its installer", () => {
    expect(readme).toContain('export PATH="$HOME/.bun/bin:$PATH"');
  });
});
