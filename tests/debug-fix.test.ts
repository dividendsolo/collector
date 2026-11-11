import { describe, expect, it } from "vitest";
import { p0Rows, triageRow } from "@/lib/priority";
import {
  debugPrompt,
  FIX_STEPS,
  openDebugSession,
  openFixes,
  parseFixes,
  STEP_OPTION,
  tmuxArgs,
  triagePrompt,
  unblockKey,
  unblockPrompt,
  workLoopPrompt,
} from "@/lib/server/debug-fix";

import { warnings } from "@/lib/server/warnings";

/**
 * James, 2026-11-11: a failed cron row's "Debug and fix" button opens a new pi session in a new tmux pane, split beside his own, so it
 * never touches a session already at work. The session debugs the failure, writes a failing test first (TDD), fixes
 * it, ships it, reruns the job, and proves it with the test and the job's next run. The row then leaves on its own.
 */
const job = {
  id: "b07ecfc6da04",
  name: "cve-watch",
  last_status: "error",
  last_error: "Script exited with code 1",
  last_run_at: "2026-11-11T13:16:03.189403+00:00",
  script_path: "/home/div/.hermes/scripts/cron-cve-watch.sh",
  profile: "default",
};

describe("debugPrompt", () => {
  const p = debugPrompt({ machine: "ezio", ssh: "div@ezio", local: false }, job);

  it("names the job, the machine, the run and its error", () => {
    expect(p).toContain("cve-watch");
    expect(p).toContain("b07ecfc6da04");
    expect(p).toContain("ezio");
    expect(p).toContain("2026-11-11T13:16:03");
    expect(p).toContain("Script exited with code 1");
    expect(p).toContain("/home/div/.hermes/scripts/cron-cve-watch.sh");
  });

  it("asks for the TDD flow, a ship, a rerun, and the proof", () => {
    expect(p).toMatch(/failing test/i);
    expect(p).toMatch(/shipit/);
    expect(p).toContain("`ssh div@ezio hermes cron run b07ecfc6da04`");
    expect(p).toMatch(/proof/i);
  });

  it("runs the job here when the machine is this one", () => {
    expect(debugPrompt({ machine: "altair", ssh: null, local: true }, job)).toContain("`hermes cron run b07ecfc6da04`");
  });
});

describe("tmuxArgs", () => {
  it("splits the pane James is looking at, running pi with the prompt as its first message", () => {
    const a = tmuxArgs("/Users/me", "fix it");
    expect(a[0]).toBe("split-window");
    expect(a).toContain("-h");
    expect(a).not.toContain("-d");
    expect(a).not.toContain("-t");
    expect(a[a.indexOf("-c") + 1]).toBe("/Users/me");
    expect(a.at(-1)).toBe("fix it");
  });
});

describe("the failed cron row", () => {
  it("carries the job for the Debug and fix button", () => {
    const w = warnings({
      machines: [{ name: "ezio", jobs: [{ ...job, enabled: true }] }],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    } as any);
    expect(w[0].debug).toEqual({ machine: "ezio", id: "b07ecfc6da04" });
  });
});

describe("openDebugSession", () => {
  it("splits the pane, then tags the new pane with the job and its first step", async () => {
    const calls: string[][] = [];
    const r = await openDebugSession({ machine: "ezio", ssh: "div@ezio", local: false }, job, async (cmd) => {
      calls.push(cmd);
      return { ok: true, stdout: "%7\n", error: null };
    });
    expect(r).toEqual({ ok: true, pane: "%7" });
    expect(calls[0].slice(0, 3)).toEqual(["tmux", "split-window", "-h"]);
    expect(calls[1]).toEqual(["tmux", "set", "-p", "-t", "%7", "@collector_fix", "ezio/b07ecfc6da04"]);
    expect(calls[2]).toEqual(["tmux", "set", "-p", "-t", "%7", "@collector_step", "starting"]);
  });

  it("says when no tmux server runs", async () => {
    const r = await openDebugSession({ machine: "ezio", ssh: null, local: true }, job, async () => ({
      ok: false,
      stdout: "",
      error: "no server running on /private/tmp/tmux-501/default",
    }));
    expect(r).toEqual({ ok: false, why: "No tmux session is open on this machine: open one, then click again." });
  });
});

// James, 2026-11-11: the button "should show ... what it's currently doing".
describe("the button's step", () => {
  it("asks the session to write each step on its own pane", () => {
    const p = debugPrompt({ machine: "ezio", ssh: "div@ezio", local: false }, job);
    expect(p).toContain(`tmux set -p -t "$TMUX_PANE" ${STEP_OPTION}`);
  });

  it("reads each open fix pane's job and step, and skips every other pane", () => {
    expect(parseFixes("%0\t\t\n%7\tezio/b07ecfc6da04\twriting the failing test\n%8\tezio/abc\t\n")).toEqual({
      "ezio/b07ecfc6da04": { pane: "%7", step: "writing the failing test" },
      "ezio/abc": { pane: "%8", step: "working" },
    });
  });

  it("reads no tmux as no fix open", async () => {
    expect(await openFixes(async () => ({ ok: false, stdout: "", error: "no server running" }))).toEqual({});
  });
});

// James, 2026-11-11: "just make it a static list". The session sets each step with its exact command, and the page
// shows only those words.
describe("the fixed list of steps", () => {
  it("is the six steps, then done or stuck", () => {
    expect(FIX_STEPS).toEqual([
      "finding the cause",
      "writing the failing test",
      "fixing",
      "shipping",
      "rerunning the job",
      "done: the job ran ok",
      "stuck",
    ]);
  });

  it("gives the session each step's exact command", () => {
    const p = debugPrompt({ machine: "ezio", ssh: "div@ezio", local: false }, job);
    for (const step of FIX_STEPS) expect(p).toContain(`tmux set -p -t "$TMUX_PANE" ${STEP_OPTION} "${step}"`);
    expect(p).not.toMatch(/for example/);
  });

  it("shows a step not on the list as working", () => {
    expect(parseFixes("%7\tezio/a\treading the logs\n%8\tezio/b\tshipping\n")).toEqual({
      "ezio/a": { pane: "%7", step: "working" },
      "ezio/b": { pane: "%8", step: "shipping" },
    });
  });
});

// James, 2026-11-11: the Lead Watch session started on MiniMax and hit its 429. Collector's PATH has no
// /opt/homebrew/bin, so pi could not reach Claude Code and took the first model with a key. The pane starts from a
// login shell (James's own PATH) and names its model. Then: "just statically assign it to Claude every time because
// we want to use Opus 5.5 on these" — no fallback to Kimi or MiniMax.
describe("the pane's pi", () => {
  it("starts in a login shell, always on Claude Opus 5.5", () => {
    const a = tmuxArgs("/Users/me", "fix it");
    const cmd = a.slice(a.indexOf("-F") + 2);
    expect(cmd).toEqual(["/bin/zsh", "-lc", 'exec pi --provider claude-code --model claude-opus-5-5 "$0"', "fix it"]);
  });
});

// James, 2026-11-11: "add the same debug and fix ... to the foreman started five times in 60 seconds", "remove the
// acknowledge ones in the cron jobs that are red ... we need to fix them", and an Acknowledge on a vendor incident:
// "there's nothing we can do about that".
describe("which rows get which button", () => {
  const base = {
    github: {},
    cfg: { work_script: { label: "Foreman", name: "foreman.py", max_starts_60s: 5 } },
    services: [],
    domains: [],
    ticketsError: null,
    x: null,
    ai: [],
  } as any;
  const at = (s: number[]) => s.map((x) => Date.now() / 1000 - 30 + x);

  it("gives a failed cron run Debug and fix and no Acknowledge", () => {
    const w = warnings({ ...base, machines: [{ name: "ezio", jobs: [{ ...job, enabled: true }] }] });
    expect(w[0].debug).toEqual({ machine: "ezio", id: "b07ecfc6da04" });
    expect(w[0].ack).toBeUndefined();
  });

  it("gives the work script loop Debug and fix", () => {
    const w = warnings({ ...base, machines: [{ name: "ezio", work_starts_10m: at([0, 5, 10, 15, 20]) }] });
    const loop = w.find((x) => x.text.includes("starting itself in a loop"));
    expect(loop?.debug).toEqual({ machine: "ezio", id: "work-loop" });
    expect(loop?.ack).toBeUndefined();
  });

  it("gives a vendor incident Acknowledge, keyed to its incidents, and no Debug and fix", () => {
    const w = warnings({
      ...base,
      machines: [],
      cfg: { ...base.cfg, vendors: [{ name: "Supabase", attention: true }] },
      vendors: [
        {
          name: "Supabase",
          state: "minor",
          url: "https://status.supabase.com",
          incidents: [{ name: "Auth delays", impact: "minor", url: "u" }],
        },
      ],
    });
    const v = w.find((x) => x.text.startsWith("Supabase incident"));
    expect(v?.ack).toEqual({ key: "vendor|Supabase|Auth delays", next: null });
    expect(v?.debug).toBeUndefined();
  });
});

describe("the work script loop's prompt", () => {
  it("names the script, the machine and its log, and asks for the same TDD flow", () => {
    const p = workLoopPrompt(
      { machine: "ezio", ssh: "div@ezio", local: false },
      { label: "Foreman", name: "foreman.py", log: "~/.hermes/foreman/foreman.log" },
      "Foreman on ezio started 5 times in 60 s: it is starting itself in a loop",
    );
    expect(p).toContain("Foreman (foreman.py)");
    expect(p).toContain("on ezio");
    expect(p).toContain("~/.hermes/foreman/foreman.log");
    expect(p).toContain("started 5 times in 60 s");
    expect(p).toMatch(/failing test/i);
    expect(p).toContain(`${STEP_OPTION} "finding the cause"`);
    expect(p).not.toContain("hermes cron run");
  });
});

// James, 2026-11-11: "add a button that says triage when there is 1 card to triage in priority tasks". It opens a
// session beside his own that triages that one card with him, the way Debug and fix opens one for a failed job.
describe("the Triage button", () => {
  it("rides on the one-card triage row only", () => {
    expect(triageRow([{ lane: "needs-triage", repo: "dividendsolo/omarchy4mac", number: 45 }])?.triage).toEqual({
      repo: "dividendsolo/omarchy4mac",
      number: 45,
    });
    const two = triageRow([
      { lane: "needs-triage", repo: "o/a", number: 1 },
      { lane: "needs-triage", repo: "o/b", number: 2 },
    ]);
    expect(two?.triage).toBeUndefined();
  });

  it("asks the session to triage that card with James, by the triage rules, and to wait for his word", () => {
    const p = triagePrompt({ repo: "dividendsolo/omarchy4mac", number: 45 });
    expect(p).toContain("dividendsolo/omarchy4mac#45");
    expect(p).toContain("gh issue view 45 -R dividendsolo/omarchy4mac");
    expect(p).toMatch(/product-stage/);
    expect(p).toMatch(/after-triage-sweep/);
    expect(p).toMatch(/wait for James/i);
    expect(p).not.toContain("@collector_step");
  });

  it("shows its open session as triaging", () => {
    expect(parseFixes("%9\ttriage\tstarting\n")).toEqual({ triage: { pane: "%9", step: "triaging" } });
  });

  it("refuses a repo or number that is not a card's", () => {
    expect(() => triagePrompt({ repo: "o/a; rm -rf ~", number: 1 })).toThrow();
    expect(() => triagePrompt({ repo: "o/a", number: 0 })).toThrow();
  });
});

// James, 2026-11-11: when the loop row is gone by the time he clicks, the refusal says it plainly.
describe("the loop row's refusal", () => {
  it("says the loop stopped and there is nothing to fix", async () => {
    const { LOOP_GONE } = await import("@/lib/server/debug-fix");
    expect(LOOP_GONE).toBe("Foreman isn't looping any more (it ran once a minute since). Nothing to fix.");
    const route = (await import("node:fs")).readFileSync("app/api/debug-fix/route.ts", "utf8");
    expect(route).toContain("why: LOOP_GONE");
  });
});

// James, 2026-11-11: "let's get a button for working the p0's as well (open in tmux like the debug one)", and he
// picked "Unblock". The card waits on James; the session gets it moving and brings him only what needs him.
describe("the Unblock button", () => {
  const p0 = { lane: "needs-info", priority: "P0", repo: "dividendsolo/zero-phase", number: 497, title: "t", url: "u" };
  it("rides on every P0 row", () => {
    expect(p0Rows([p0])[0].unblock).toEqual({ repo: "dividendsolo/zero-phase", number: 497 });
  });

  it("asks the session to verify the blocker, do what an agent can, and bring James only what needs him", () => {
    const p = unblockPrompt({ repo: "dividendsolo/zero-phase", number: 497, lane: "needs-info" });
    expect(p).toContain("dividendsolo/zero-phase#497");
    expect(p).toContain("gh issue view 497 -R dividendsolo/zero-phase --comments");
    expect(p).toContain("needs-info");
    expect(p).toMatch(/verify/i);
    expect(p).toMatch(/failing test/i);
    expect(p).toMatch(/shipit/);
    expect(p).toMatch(/only what needs James/i);
    expect(p).toContain("~/.local/bin/status");
  });

  it("keys its pane by card, and shows it as working", () => {
    expect(unblockKey({ repo: "dividendsolo/zero-phase", number: 497 })).toBe("unblock/dividendsolo/zero-phase#497");
    expect(parseFixes("%3\tunblock/dividendsolo/zero-phase#497\tstarting\n")).toEqual({
      "unblock/dividendsolo/zero-phase#497": { pane: "%3", step: "working" },
    });
  });

  // The 500 James hit (2026-11-11): the board names a card's repo without its owner ("zero-phase"), so the button
  // must take owner/repo from the card's URL.
  it("takes owner/repo from the card's URL, the way the board gives it", () => {
    const board = {
      lane: "needs-info",
      priority: "P0",
      repo: "zero-phase",
      number: 497,
      title: "t",
      url: "https://github.com/dividendsolo/zero-phase/issues/497",
    };
    const card = p0Rows([board])[0].unblock;
    expect(card).toEqual({ repo: "dividendsolo/zero-phase", number: 497 });
    expect(() => unblockPrompt({ ...(card as any), lane: "needs-info" })).not.toThrow();
    const one = triageRow([{ ...board, lane: "needs-triage" }]);
    expect(one?.triage).toEqual({ repo: "dividendsolo/zero-phase", number: 497 });
  });

  it("refuses a repo, number or status that is not a card's", () => {
    expect(() => unblockPrompt({ repo: "o/a; rm -rf ~", number: 1, lane: "needs-info" })).toThrow();
    expect(() => unblockPrompt({ repo: "o/a", number: 0, lane: "needs-info" })).toThrow();
    expect(() => unblockPrompt({ repo: "o/a", number: 1, lane: "x`id`" })).toThrow();
  });
});
