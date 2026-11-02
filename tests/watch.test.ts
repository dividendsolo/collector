import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { watchFor } from "@/lib/server/machines";
import { warnings } from "@/lib/server/warnings";

/**
 * The agents and jobs Collector watches (collector#54). The Hermes jobs, the launchd jobs, the crontab lines, the
 * systemd timers, the Hermes gateway and its ticker, and the Claude Code and Codex sessions are read with no setting
 * at all; `config.json`'s `watch` adds a user's own. One entry names one thing and the signal that says how it is
 * doing — a process, a session, a launchd label and its last exit code, a log file's last line or age, or a
 * heartbeat file — and idle too long or failing shows in Needs attention, the same as our droids.
 *
 * The reading lives in collect.py, which runs on each machine (over ssh), so these fixtures go through the real
 * Python: `tests/watch.driver.py` writes the case's files into a throwaway home and hands one case to
 * `collect.watch_rows`, with a fixed `now` (Monday 2026-11-02, 12:00 in the machine's own zone) that a fixture
 * file's age is measured back from, so an age is the same on every machine and at every hour.
 */
const ROOT = process.cwd();
const NOW = "2026-11-02T12:00:00-05:00";

interface Row {
  name: string;
  signal: string | null;
  state: string;
  detail: string;
}

interface Case {
  entries: unknown;
  now?: string;
  ps?: string;
  launchd?: Record<string, { ok?: boolean; out?: string }>;
  files?: Record<string, { content?: string; age_s?: number }>;
  ok_exits?: Record<string, Record<string, string>>;
  self_pid?: number;
}

/** One watch read on fixtures: the real Python, so the reading under test is the reading a machine does. */
function read(spec: Case): Row[] {
  return JSON.parse(
    execFileSync("python3", [path.join(ROOT, "tests", "watch.driver.py")], {
      cwd: ROOT,
      input: JSON.stringify({ now: NOW, ...spec }),
      encoding: "utf8",
    }),
  ) as Row[];
}

/** A `ps -axo pid=,etime=,command=` list, one line per process. */
const ps = (...lines: string[]) => lines.join("\n");
const proc = (pid: number, etime: string, command: string) => `${pid} ${etime} ${command}`;

/** `launchctl list <label>` output: the job's own dictionary, one line per setting. launchd reports the raw wait
 * status, so a job that exited 1 shows 256 and the live Collector job, which a kickstart ends with SIGTERM (143),
 * shows 36608: the reader divides the code back out (see the live `com.james.collector` job). */
const job = (...lines: string[]) => `{\n${lines.map((l) => `\t${l}`).join("\n")}\n};`;
const FAILED = job('"LastExitStatus" = 256;', '"Label" = "com.example.report";');
const WORKED = job('"LastExitStatus" = 0;', '"Label" = "com.example.report";');
const UP = job('"LastExitStatus" = 0;', '"Label" = "com.example.report";', '"PID" = 1064;');

/** One function of collect.py, on fixtures. */
const DRIVER = `import inspect, json, os, sys
sys.path.insert(0, os.getcwd())
import collect
spec = json.load(sys.stdin)
print(json.dumps(getattr(collect, spec["fn"])(*spec["args"])))`;

function call(fn: string, ...args: unknown[]): any {
  return JSON.parse(
    execFileSync("python3", ["-c", DRIVER], { cwd: ROOT, input: JSON.stringify({ fn, args }), encoding: "utf8" }),
  );
}

describe("collect.py's watch read", () => {
  it("reads a launchd job that exited 1 as failed, with the exit code", () => {
    // The card's own case: a custom launchd job that exits 1 (collector#54).
    const rows = read({
      entries: [{ name: "Nightly backup", launchd: "com.example.report" }],
      launchd: { "com.example.report": { out: FAILED } },
    });
    expect(rows).toEqual([{ name: "Nightly backup", signal: "launchd", state: "failed", detail: "last run exit 1" }]);
  });

  it("reads launchd's raw wait status as the exit code behind it", () => {
    expect(call("launchd_code", 256)).toBe("1");
    expect(call("launchd_code", 36608)).toBe("143");
    expect(call("launchd_code", 1)).toBe("1");
    expect(call("launchd_code", "0")).toBe("0");
    expect(call("launchd_code", null)).toBe(null);
  });

  it("reads a launchd job that last worked, and one running now", () => {
    const [worked] = read({
      entries: [{ name: "Report", launchd: "com.example.report" }],
      launchd: { "com.example.report": { out: WORKED } },
    });
    expect([worked.state, worked.detail]).toEqual(["ok", "last run exit 0"]);
    const [up] = read({
      entries: [{ name: "Report", launchd: "com.example.report" }],
      launchd: { "com.example.report": { out: UP } },
    });
    expect([up.state, up.detail]).toEqual(["busy", "running as pid 1064"]);
  });

  it("reads a label launchd does not know, and a run death's own exit code, as the failure they are", () => {
    expect(read({ entries: [{ name: "Report", launchd: "com.example.gone" }], launchd: {} })[0]).toEqual({
      name: "Report",
      signal: "launchd",
      state: "failed",
      detail: "launchd has no com.example.gone on this machine",
    });
    // A job launchd has loaded and never started carries no exit code: that is not a failure.
    const never = read({
      entries: [{ name: "Report", launchd: "com.example.report" }],
      launchd: { "com.example.report": { out: job('"Label" = "com.example.report";') } },
    });
    expect([never[0].state, never[0].detail]).toEqual(["ok", "last run exit 0"]);
  });

  it("trusts an ok_exits entry: a non-zero exit the job's own setting calls success is not a failure", () => {
    // The setting is written with the code a person means (3), and launchd reports 768 for it: the reader divides
    // it back out before it looks the code up.
    const out = job('"LastExitStatus" = 768;');
    expect(
      read({
        entries: [{ name: "Weekly report", launchd: "com.example.report" }],
        launchd: { "com.example.report": { out } },
      })[0].state,
    ).toBe("failed");
    expect(
      read({
        entries: [{ name: "Weekly report", launchd: "com.example.report" }],
        launchd: { "com.example.report": { out } },
        ok_exits: { "com.example.report": { "3": "ok (opened a PR)" } },
      })[0].state,
    ).toBe("ok");
  });

  it("reads a heartbeat file older than its limit as idle, and one inside it as ok", () => {
    // The card's other case: a heartbeat file older than its limit shows as idle (collector#54).
    const entries = [{ name: "The crew", heartbeat: "~/crew/beat", idle_after: 900 }];
    expect(read({ entries, files: { "crew/beat": { age_s: 7200 } } })[0]).toMatchObject({
      state: "idle",
      detail: "nothing written for 2 h",
    });
    expect(read({ entries, files: { "crew/beat": { age_s: 30 } } })[0]).toMatchObject({
      state: "ok",
      detail: "written 30 s ago",
    });
  });

  it("takes the epoch second a heartbeat file holds over its own mtime, the way the ticker is read", () => {
    const stamp = Math.floor(Date.parse(NOW) / 1000) - 3600;
    const rows = read({
      entries: [{ name: "The crew", heartbeat: "~/beat", idle_after: 600 }],
      files: { beat: { content: `${stamp}\n`, age_s: 1 } },
    });
    expect(rows[0]).toMatchObject({ state: "idle", detail: "nothing written for 1 h" });
  });

  it("reads a heartbeat file that was never written as idle, and says so rather than guessing an age", () => {
    const rows = read({ entries: [{ name: "The crew", heartbeat: "~/crew/beat", idle_after: 900 }] });
    expect(rows[0].state).toBe("idle");
    expect(rows[0].detail).toMatch(/^no heartbeat file at .*\/crew\/beat$/);
  });

  it("reads a log's last line for fail_on, and its age for idle", () => {
    const entry = { name: "Sync", log: "~/sync.log", fail_on: "error", idle_after: 3600 };
    expect(
      read({
        entries: [entry],
        files: { "sync.log": { content: "sync started\npushed 12 files\nERROR: the remote hung up\n" } },
      })[0],
    ).toMatchObject({ state: "failed", detail: "its log ends with 'ERROR: the remote hung up'" });
    expect(
      read({ entries: [entry], files: { "sync.log": { age_s: 7200, content: "pushed 12 files\n" } } })[0],
    ).toMatchObject({
      state: "idle",
      detail: "nothing written for 2 h",
    });
    expect(
      read({ entries: [entry], files: { "sync.log": { age_s: 300, content: "pushed 12 files\n" } } })[0],
    ).toMatchObject({
      state: "ok",
      detail: "written 5 min ago",
    });
    // A log entry with no fail_on has only its age to say, and a log nobody wrote is not a run that worked.
    expect(
      read({ entries: [{ name: "Sync", log: "~/sync.log" }], files: { "sync.log": { age_s: 300 } } })[0].state,
    ).toBe("ok");
    expect(read({ entries: [{ name: "Sync", log: "~/sync.log" }] })[0].state).toBe("idle");
  });

  it("reads a process that is running as busy, and one that is not as idle", () => {
    const entries = [{ name: "Backup agent", process: "backup-agent.py" }];
    expect(
      read({ entries, ps: ps(proc(4242, "01:12", "/usr/bin/python3 /srv/backup-agent.py --watch")) })[0],
    ).toMatchObject({
      state: "busy",
      detail: "running as pid 4242",
    });
    expect(read({ entries, ps: ps(proc(9, "10:00", "/usr/bin/python3 /srv/other.py")) })[0]).toMatchObject({
      state: "idle",
      detail: "not running",
    });
  });

  it("is never the reader's own process, whose command line carries the watch entries themselves", () => {
    // The entries reach collect.py as its own argument, so a watched name is in the reader's own command line.
    const entries = [{ name: "Backup agent", process: "backup-agent.py" }];
    const own = proc(4242, "00:01", `python3 /home/me/collector/collect.py {"watch":[{"process":"backup-agent.py"}]}`);
    expect(read({ entries, ps: ps(own), self_pid: 9 })[0].state).toBe("busy");
    expect(read({ entries, ps: ps(own), self_pid: 4242 })[0].state).toBe("idle");
  });

  it("reads a Claude Code or Codex session as busy, its own helpers as no session", () => {
    const claude = [{ name: "My session", session: "claude" }];
    expect(read({ entries: claude, ps: ps(proc(3101, "01:00", "/Users/me/.local/bin/claude")) })[0]).toMatchObject({
      state: "busy",
      detail: "Claude Code running as pid 3101",
    });
    expect(
      read({ entries: claude, ps: ps(proc(3001, "3-04:00:00", "claude daemon run --json-path /tmp/claude/d.json")) })[0]
        .state,
    ).toBe("idle");
    const codex = [{ name: "My Codex", session: "codex" }];
    expect(
      read({
        entries: codex,
        ps: ps(
          proc(100, "00:30", "/usr/bin/node /usr/lib/node_modules/@openai/codex/bin/codex.js"),
          proc(101, "00:29", "/home/me/.codex/bin/codex-x86_64-unknown-linux-musl"),
        ),
      })[0],
    ).toMatchObject({ state: "busy", detail: "Codex running as pid 100" });
    expect(read({ entries: [{ name: "My session", session: "claud" }], ps: "" })[0]).toMatchObject({
      state: "unknown",
      detail: "session must be one of claude, codex, not claud",
    });
  });

  it("says an entry Collector cannot read rather than dropping the setting silently", () => {
    expect(read({ entries: [{ name: "Thing" }] })[0]).toEqual({
      name: "Thing",
      signal: null,
      state: "unknown",
      detail: "no signal Collector reads (process, session, launchd, log, heartbeat)",
    });
    expect(read({ entries: { name: "Thing" } })[0].detail).toBe("config.json's watch is not a list of entries");
  });

  it("reads nothing, with no setting, so a machine that watches nothing new reads as it did", () => {
    expect(read({ entries: [] })).toEqual([]);
  });
});

const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;
const machine = (over: Record<string, unknown> = {}) => ({ name: "altair", local: true, ...over });

describe("Needs attention with a watched agent", () => {
  it("names a custom launchd job that exited 1", () => {
    const rows = read({
      entries: [{ name: "Nightly backup", launchd: "com.example.report" }],
      launchd: { "com.example.report": { out: FAILED } },
    });
    expect(warnings({ ...base, machines: [machine({ watch: rows })] })).toEqual([
      { level: "error", text: "Nightly backup on altair: last run exit 1" },
    ]);
  });

  it("names a heartbeat file older than its limit as idle", () => {
    const rows = read({
      entries: [{ name: "The crew", heartbeat: "~/crew/beat", idle_after: 900 }],
      files: { "crew/beat": { age_s: 7200 } },
    });
    expect(warnings({ ...base, machines: [machine({ watch: rows })] })).toEqual([
      { level: "warn", text: "The crew on altair: nothing written for 2 h" },
    ]);
  });

  it("says nothing while the watched agent is busy or last worked, the way a job that ran says nothing", () => {
    const rows = read({
      entries: [
        { name: "Backup agent", process: "backup-agent.py" },
        { name: "Report", launchd: "com.example.report" },
      ],
      ps: ps(proc(4242, "01:12", "/srv/backup-agent.py")),
      launchd: { "com.example.report": { out: WORKED } },
    });
    expect(rows.map((r) => r.state)).toEqual(["busy", "ok"]);
    expect(warnings({ ...base, machines: [machine({ watch: rows })] })).toEqual([]);
  });

  it("warns about an entry Collector cannot read, so a setting that does nothing is not silent", () => {
    const rows = read({ entries: [{ name: "Thing", launchd_: "com.example.report" }] });
    expect(warnings({ ...base, machines: [machine({ watch: rows })] })).toEqual([
      { level: "warn", text: "Thing on altair: no signal Collector reads (process, session, launchd, log, heartbeat)" },
    ]);
  });

  it("says nothing on a machine with no watch rows at all, as every machine reads today", () => {
    expect(warnings({ ...base, machines: [machine()] })).toEqual([]);
    expect(warnings({ ...base, machines: [machine({ watch: [] })] })).toEqual([]);
  });
});

describe("watchFor", () => {
  const entries = [
    { name: "On the vps", machine: "vps", process: "backup.py" },
    { name: "Here", process: "sync.py" },
    { name: "Also here", machine: "altair", log: "~/sync.log" },
  ];

  it("shows a machine only the entries that name it, and the ones that name no machine here", () => {
    // A process, a launchd label and a file each belong to one machine: reading another machine's entry here would
    // invent an idle row for it.
    expect(watchFor(entries, "vps", "altair").map((w) => w.name)).toEqual(["On the vps"]);
    expect(watchFor(entries, "altair", "altair").map((w) => w.name)).toEqual(["Here", "Also here"]);
  });

  it("reads what names no machine where Collector runs, and nothing at all with no watch key", () => {
    expect(watchFor([{ name: "Here", heartbeat: "~/beat" }], "ezio", "altair")).toEqual([]);
    expect(watchFor(undefined, "altair", "altair")).toEqual([]);
  });
});

describe("collect.py's snapshot with no watch configured", () => {
  it("carries the key on every machine's read, and no rows", () => {
    const out = JSON.parse(execFileSync("python3", ["collect.py"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    expect(out.watch).toEqual([]);
  });
});
