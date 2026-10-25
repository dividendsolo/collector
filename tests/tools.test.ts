import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** collect.py's Claude Code and Codex helpers, driven on fixtures: `tests/tools.driver.py` runs the real Python, so
 * the parsing under test here is the parsing a machine runs. */
const ROOT = process.cwd();

function drive<T>(probe: unknown): T {
  const out = execFileSync("python3", [path.join(ROOT, "tests", "tools.driver.py")], {
    cwd: ROOT,
    input: JSON.stringify(probe),
    encoding: "utf8",
  });
  return JSON.parse(out) as T;
}

/** A `ps -axo pid=,etime=,command=` list, one line per process. */
const ps = (...lines: string[]) => lines.join("\n");
const proc = (pid: number, etime: string, command: string) => `${pid} ${etime} ${command}`;

/** One row collect.py prints for a tool session, as the page reads it. */
interface Run {
  type: string;
  name: string;
  kind: string;
  repo: string | null;
  card: number | null;
  seconds: number;
  model?: string;
}

/** A throwaway home holding the session files a tool writes locally. */
function home(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-tools-"));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}
const jsonl = (...rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;

describe("tool_rows", () => {
  it("shows a Claude Code session in a card worktree as one live agent run", () => {
    const cwd = "/home/me/code/collector/.worktrees/build-21";
    expect(
      drive<Run[]>({
        fn: "rows",
        ps: ps(proc(4242, "01:12", "/home/me/.local/bin/claude --print hi")),
        facts: { 4242: { cwd, branch: "agent/21", root: cwd } },
        models: [["claude", cwd, { model: "claude-opus-5-5" }]],
      }),
    ).toEqual([
      {
        type: "agent",
        name: "Claude Code",
        kind: "session",
        repo: "collector",
        card: 21,
        seconds: 72,
        model: "claude-opus-5-5",
      },
    ]);
  });
  it("counts the Codex shim and the binary under it as one session, its own model on the row", () => {
    const cwd = "/home/me/code/situation";
    expect(
      drive<Run[]>({
        fn: "rows",
        ps: ps(
          proc(100, "00:30", "/usr/bin/node /usr/lib/node_modules/@openai/codex/bin/codex.js"),
          proc(101, "00:29", "/home/me/.codex/bin/codex-x86_64-unknown-linux-musl"),
        ),
        facts: {
          100: { cwd, branch: "main", root: cwd },
          101: { cwd, branch: "main", root: cwd },
        },
        models: [["codex", cwd, { model: "gpt-5-codex" }]],
      }),
    ).toEqual([
      {
        type: "agent",
        name: "Codex",
        kind: "session",
        repo: "situation",
        card: null,
        seconds: 30,
        model: "gpt-5-codex",
      },
    ]);
  });
  it("cards a session on an agent/<n> branch, and leaves the model blank when none was recorded", () => {
    expect(
      drive<Run[]>({
        fn: "rows",
        ps: ps(proc(7, "10:00", "claude")),
        facts: { 7: { cwd: "/home/me/code/collector/lib", branch: "agent/21", root: "/home/me/code/collector" } },
        models: [],
      }),
    ).toEqual([{ type: "agent", name: "Claude Code", kind: "session", repo: "collector", card: 21, seconds: 600 }]);
  });
  it("shows a session outside any repo as no repo, not as an error", () => {
    expect(
      drive<Run[]>({
        fn: "rows",
        ps: ps(proc(55, "00:05", "/home/me/.local/bin/claude")),
        facts: { 55: { cwd: "/home/me", branch: null, root: null } },
        models: [],
      }),
    ).toEqual([{ type: "agent", name: "Claude Code", kind: "session", repo: null, card: null, seconds: 5 }]);
  });
  it("leaves every other process alone", () => {
    expect(
      drive<Run[]>({
        fn: "rows",
        ps: ps(
          proc(9, "10:00", "/usr/bin/python3 /home/me/code/agent-stack/foreman/foreman.py"),
          proc(8, "00:10", "/bin/bash -lc claude"),
          proc(6, "00:01", "/home/me/.local/bin/claudette notes"),
          proc(5, "00:02", "codex-notes --watch"),
        ),
        facts: {},
        models: [],
      }),
    ).toEqual([]);
  });
});

describe("worktree_rows", () => {
  /** One row collect.py prints for a process in a card worktree. A leftover carries the port it listens on when the
   * machine (`ss` on Linux, `lsof` on a Mac) shows one. */
  interface WorktreeRow {
    repo: string;
    kind: string;
    card: number;
    type: string;
    name: string;
    seconds: number;
    port?: number;
  }
  const worktree = "/home/me/code/collector/.worktrees/build-25";
  // What a builder's test server looks like in `ps`: the shell it was started from holds the worktree in its own
  // command line, which is how this process was ever read as a card's work at all.
  const bunStart = proc(
    9001,
    "01:20:30",
    `/bin/bash -lc cd ${worktree} && COLLECTOR_CONFIG=/tmp/collector-fixture.json COLLECTOR_PORT=4123 /home/me/.bun/bin/bun start`,
  );

  it("shows a process left in a card worktree as a leftover, named after the program it runs", () => {
    // James, 2026-10-25 (card #32): a leftover `bun start` in a build worktree read as `foreman.py | building` for
    // three hours. Nothing is working that card: no agent, no step file, no verify run.
    expect(drive<WorktreeRow[]>({ fn: "worktrees", ps: ps(bunStart), ports: { 9001: [4123] } })).toEqual([
      { repo: "collector", kind: "leftover", card: 25, type: "leftover", name: "bun start", seconds: 4830, port: 4123 },
    ]);
  });
  it("never names a leftover after the work script, and names the program under an interpreter", () => {
    const rows = drive<WorktreeRow[]>({
      fn: "worktrees",
      ps: ps(
        proc(9002, "10:00", `/usr/bin/node ${worktree}/node_modules/next/dist/server/next-server`),
        proc(9005, "09:59", "/home/me/code/collector/.worktrees/build-26/next-server"),
      ),
    });
    expect(rows.map((r) => [r.name, r.type, r.card])).toEqual([
      ["node next-server", "leftover", 25],
      ["next-server", "leftover", 26],
    ]);
    expect(rows.map((r) => r.type)).not.toContain("script");
  });
  it("names the row after the oldest process of the worktree, with the port the child under it listens on", () => {
    // The shape a builder's test server leaves behind on a live machine: `script -a -q -e -c 'cd <worktree> && bun
    // start'` keeps the worktree in its own command line, and the server it started holds the socket without the path
    // in its own (Next renames that process `next-server (v16.4.2)`).
    const rows = drive<WorktreeRow[]>({
      fn: "worktrees",
      ps: ps(bunStart, proc(9003, "01:20:29", "next-server (v16.4.2)")),
      ports: { 9003: [4123] },
      children: { 9001: ["9003"] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "bun start", seconds: 4830, port: 4123 });
  });
  it("reads the program out of the wrapper a builder's shell leaves behind", () => {
    const rows = drive<WorktreeRow[]>({
      fn: "worktrees",
      ps: ps(
        proc(9006, "03:54:44", `script -a -q -e -c cd ${worktree} && COLLECTOR_PORT=4123 /home/me/.bun/bin/bun start`),
      ),
    });
    expect(rows[0]).toMatchObject({ name: "bun start", repo: "collector", card: 25, seconds: 14084 });
  });
  it("shows no port for a leftover the machine shows no listener for", () => {
    const rows = drive<WorktreeRow[]>({ fn: "worktrees", ps: ps(bunStart) });
    expect(rows[0]).not.toHaveProperty("port");
  });
  it("leaves the worktree the work script says it is on now to the script's own step row", () => {
    expect(
      drive<WorktreeRow[]>({
        fn: "worktrees",
        ps: ps(bunStart),
        steps: [{ repo: "collector", card: 25, step: "verifying", since: 1792955413, pid: 68439 }],
      }),
    ).toEqual([]);
  });
  it("leaves the worktree a verify run is on to the verify row", () => {
    expect(
      drive<WorktreeRow[]>({
        fn: "worktrees",
        ps: ps(bunStart),
        verifying: [["collector", "build", 25]],
      }),
    ).toEqual([]);
  });
  it("is the agent's own row while a Hermes agent works in the worktree", () => {
    expect(
      drive<WorktreeRow[]>({
        fn: "worktrees",
        ps: ps(
          proc(
            9004,
            "00:12",
            `script -a -q -e -c /home/me/.local/bin/hermes -p collector-builder chat -Q --yolo -q 'work only in ${worktree}'`,
          ),
        ),
      }),
    ).toEqual([{ repo: "collector", kind: "build", card: 25, type: "agent", name: "collector-builder", seconds: 12 }]);
  });
  it("leaves a process outside any card worktree alone", () => {
    expect(
      drive<WorktreeRow[]>({
        fn: "worktrees",
        ps: ps(
          proc(9, "10:00", "/usr/bin/python3 /home/me/code/agent-stack/foreman/foreman.py"),
          proc(8, "00:10", "/home/me/.bun/bin/bun start"),
        ),
      }),
    ).toEqual([]);
  });
});

describe("lab_droid", () => {
  /** A `ps -axo user=,pid=,etime=,command=` list: one user column in front of the plain list. */
  const withUser = (...lines: string[]) => lines.join("\n");
  const owned = (user: string, pid: number, etime: string, command: string) => `${user} ${pid} ${etime} ${command}`;

  it("shows the lab droid's run as one row while a claude process of user lab is going", () => {
    expect(
      drive<{ pids: [string, number][]; rows: Run[] }>({
        fn: "droid",
        ps: withUser(
          owned("div", 4242, "01:12", "/usr/bin/timeout 2h claude -p build"),
          owned("lab", 5001, "07:30", "claude -p 'Today is 2026-10-25, day 1 of 14' --model claude-opus-5-5"),
        ),
      }),
    ).toEqual({
      pids: [["5001", 450]],
      rows: [{ repo: "lab", kind: "lab", card: 111, type: "agent", name: "lab-droid", seconds: 450 }],
    });
  });
  it("shows no row when the droid is not running", () => {
    expect(
      drive({
        fn: "droid",
        ps: withUser(
          owned("div", 9, "10:00", "/usr/bin/python3 /home/me/code/agent-stack/foreman/foreman.py"),
          owned("div", 8, "00:10", "/bin/bash -lc /home/me/.local/bin/hermes -p builder chat"),
        ),
      }),
    ).toEqual({ pids: [], rows: [] });
  });
  it("leaves another user's claude alone, and a card worktree line", () => {
    expect(
      drive<{ rows: Run[] }>({
        fn: "droid",
        ps: withUser(
          owned("div", 7, "00:30", "claude --print hi"),
          owned("div", 5, "10:00", "/home/me/code/collector/.worktrees/build-21/scripts/run.sh"),
          owned("lab", 6, "00:20", "/usr/bin/timeout 2h bash /home/lab/app/run.sh"),
        ),
      }).rows,
    ).toEqual([]);
  });
  it("counts two processes of one run as that run, the longer one on the row", () => {
    expect(
      drive<{ pids: [string, number][]; rows: Run[] }>({
        fn: "droid",
        ps: withUser(
          owned("lab", 100, "00:42", "/usr/bin/node /home/lab/.local/bin/codex.js --print go"),
          owned("lab", 101, "00:41", "/home/lab/.codex/bin/codex-x86_64-unknown-linux-musl"),
        ),
      }),
    ).toEqual({
      pids: [
        ["100", 42],
        ["101", 41],
      ],
      rows: [{ repo: "lab", kind: "lab", card: 111, type: "agent", name: "lab-droid", seconds: 42 }],
    });
  });
});

describe("tool_sessions", () => {
  it("skips the pids another reader already shows, so the droid's run is one row and not two", () => {
    const line = proc(987654, "07:30", "claude -p 'day 1 of 14'");
    expect(drive<Run[]>({ fn: "sessions", ps: ps(line) })).toEqual([
      { repo: null, kind: "session", card: null, seconds: 450, type: "agent", name: "Claude Code" },
    ]);
    expect(drive<Run[]>({ fn: "sessions", ps: ps(line), skip: ["987654"] })).toEqual([]);
  });
});

describe("process_cwd", () => {
  // macOS has no /proc, so collect.py asks lsof for the folder. This is real `lsof -a -p <pid> -d cwd -Fn` output,
  // the shape taken from a run on ezio; /proc is hidden for the call so that is the branch under test.
  const lsof = "p4242\nn/home/me/code/collector/.worktrees/build-21\n";

  it("reads the folder out of lsof where there is no /proc", () => {
    expect(drive({ fn: "cwd_lsof", pid: 4242, lsof })).toBe("/home/me/code/collector/.worktrees/build-21");
  });
  it("leaves the folder unknown when lsof says nothing, and when a machine has no lsof", () => {
    expect(drive({ fn: "cwd_lsof", pid: 4242, lsof: "" })).toBe(null);
    expect(drive({ fn: "cwd_lsof", pid: 4242, lsof_error: "lsof: command not found" })).toBe(null);
  });
});

describe("session_place", () => {
  it("reads the repo and the card from a card worktree's path, however deep the session sits", () => {
    expect(
      drive({
        fn: "place",
        cwd: "/home/me/code/collector/.worktrees/build-21/components",
        branch: "agent/21",
        root: "/home/me/code/collector/.worktrees/build-21",
      }),
    ).toEqual(["collector", 21]);
  });
  it("names the repo of a plain checkout, with no card on a normal branch", () => {
    expect(
      drive({ fn: "place", cwd: "/home/me/code/situation", branch: "main", root: "/home/me/code/situation" }),
    ).toEqual(["situation", null]);
  });
  it("is no repo outside one", () => {
    expect(drive({ fn: "place", cwd: "/Users/me", branch: null, root: null })).toEqual([null, null]);
  });
});

describe("claude_model", () => {
  const cwd = "/home/me/code/collector";
  const transcript = path.join(".claude", "projects", "-home-me-code-collector", "s1.jsonl");

  it("reads the model the folder's transcript recorded", () => {
    const dir = home({
      [transcript]: jsonl({ message: { model: "claude-sonnet-4-5" } }, { message: { model: "claude-opus-5-5" } }),
    });
    expect(drive({ fn: "claude_model", home: dir, cwd })).toEqual({ model: "claude-opus-5-5" });
  });
  it("skips Claude Code's own <synthetic> placeholder and keeps the model that ran", () => {
    const dir = home({
      [transcript]: jsonl({ message: { model: "claude-opus-5-5" } }, { message: { model: "<synthetic>" } }),
    });
    expect(drive({ fn: "claude_model", home: dir, cwd })).toEqual({ model: "claude-opus-5-5" });
  });
  it("reads the newest transcript when the folder holds several", () => {
    const dir = home({ [transcript]: jsonl({ message: { model: "claude-sonnet-4-5" } }) });
    fs.utimesSync(path.join(dir, transcript), new Date(1000), new Date(1000));
    fs.writeFileSync(
      path.join(path.dirname(path.join(dir, transcript)), "s2.jsonl"),
      jsonl({ message: { model: "claude-opus-5-5" } }),
    );
    expect(drive({ fn: "claude_model", home: dir, cwd })).toEqual({ model: "claude-opus-5-5" });
  });
  it("is blank for a folder Claude Code wrote no transcript for", () => {
    expect(drive({ fn: "claude_model", home: home({}), cwd: "/home/me/nowhere" })).toEqual({});
  });
});

describe("codex_model", () => {
  const cwd = "/home/me/code/situation";
  const rollout = path.join(".codex", "sessions", "2026", "10", "23", "rollout-2026-10-23T10-00-00-abc.jsonl");

  it("reads the model the rollout for that folder recorded", () => {
    const dir = home({
      [rollout]: jsonl(
        { type: "session_meta", payload: { id: "abc", cwd, git: { branch: "main" } } },
        { type: "turn_context", payload: { model: "gpt-5-codex", cwd } },
      ),
    });
    expect(drive({ fn: "codex_model", home: dir, cwd })).toEqual({ model: "gpt-5-codex" });
  });
  it("is blank for another folder's rollout, so a session is never shown another session's model", () => {
    const dir = home({
      [rollout]: jsonl(
        { type: "session_meta", payload: { cwd: "/home/me/elsewhere" } },
        { type: "turn_context", payload: { model: "gpt-5-codex" } },
      ),
    });
    expect(drive({ fn: "codex_model", home: dir, cwd })).toEqual({});
  });
});
