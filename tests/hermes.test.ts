import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { kickstartArgs, parsePid, pidFromRun, startGateway } from "@/lib/server/hermes";
import { warnings } from "@/lib/server/warnings";

/**
 * The waiting crew (agent-stack#261) runs as a Hermes cron on this machine's own Hermes gateway, so a stopped
 * gateway stops the crew silently (James, 2026-11-02). collect.py reads the launchd job `ai.hermes.gateway` and the
 * age of the cron ticker; Needs attention names it and, on the machine Collector runs on, offers to start it —
 * the same shape as the Start Tailscale row.
 */
const DRIVER = `import datetime, json, os, sys, tempfile, time
sys.path.insert(0, os.getcwd())
import collect
spec = json.load(sys.stdin)
home = tempfile.mkdtemp()
os.makedirs(os.path.join(home, ".hermes", "cron"), exist_ok=True)
text = spec.get("ticker_text")
if text is None and spec.get("ticker_age_s") is not None:
    text = str(time.time() - spec["ticker_age_s"])
if text is not None:
    with open(os.path.join(home, ".hermes", "cron", "ticker_last_success"), "w") as f:
        f.write(text)
if spec.get("plist"):
    os.makedirs(os.path.join(home, "Library", "LaunchAgents"), exist_ok=True)
    open(os.path.join(home, "Library", "LaunchAgents", "ai.hermes.gateway.plist"), "w").close()
now = datetime.datetime.now(datetime.timezone.utc)  # main() hands every reader the snapshot's own time
print(json.dumps(collect.hermes_gateway(now, home=home, pid=lambda label: spec["pid"])))`;

/** One gateway read on a throwaway home: the real Python, so the reading under test is the reading a machine does.
 * `pid` is what `launchctl list ai.hermes.gateway` answers: a PID, "" when the job is loaded but nothing runs, or
 * null when launchd does not know the label. */
const read = (spec: { pid: string | null; plist?: boolean; ticker_age_s?: number; ticker_text?: string }) =>
  JSON.parse(
    execFileSync("python3", ["-c", DRIVER], { input: JSON.stringify(spec), encoding: "utf8" }),
  ) as Gateway | null;

interface Gateway {
  installed: boolean;
  running: boolean;
  pid: string | null;
  ticker_age_s: number | null;
  ticker_stale_s: number;
}

const gw = (over: Partial<Gateway> = {}) => ({
  installed: true,
  running: true,
  pid: "1064",
  ticker_age_s: 20,
  ticker_stale_s: 600,
  ...over,
});

describe("collect.py's gateway read", () => {
  it("reads a running job and a fresh ticker", () => {
    expect(read({ pid: "1064", ticker_age_s: 30 })).toEqual(gw({ ticker_age_s: 30 }));
  });
  it("reads a job launchd knows but nothing runs, and keeps the ticker's age", () => {
    expect(read({ pid: "", ticker_age_s: 900 })).toEqual(gw({ running: false, pid: null, ticker_age_s: 900 }));
  });
  it("reads no job at all as nothing to say: no launchd label and no plist", () => {
    expect(read({ pid: null })).toBeNull();
  });
  it("counts a plist launchd has not loaded as an installed job that is not running", () => {
    expect(read({ pid: null, plist: true })).toEqual(gw({ running: false, pid: null, ticker_age_s: null }));
  });
  it("reads no ticker file, and a file that holds no number, as no age", () => {
    expect(read({ pid: "1064", ticker_text: "" })?.ticker_age_s).toBeNull();
    expect(read({ pid: "1064", ticker_text: "tick" })?.ticker_age_s).toBeNull();
  });
  // The reader's own unit tests pass a time the way main() does: a read that crashes the snapshot or reports the
  // wrong shape must fail here, not on the page.
  it("is on this machine's snapshot, in the shape the page reads", () => {
    const out = JSON.parse(execFileSync("python3", ["collect.py"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    expect("hermes_gateway" in out).toBe(true);
    if (out.hermes_gateway)
      expect(Object.keys(out.hermes_gateway).sort()).toEqual([
        "installed",
        "pid",
        "running",
        "ticker_age_s",
        "ticker_stale_s",
      ]);
  });
});

const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;
const machine = (over: Record<string, unknown> = {}) => ({ name: "altair", local: true, ...over });

describe("Needs attention with the Hermes gateway", () => {
  const START = { label: "Start Hermes", post: "/api/hermes" };
  it("says nothing while the gateway runs and its ticker is fresh", () => {
    expect(warnings({ ...base, machines: [machine({ hermes_gateway: gw() })] })).toEqual([]);
  });
  it("names a gateway that is not running, with the Start Hermes button", () => {
    expect(warnings({ ...base, machines: [machine({ hermes_gateway: gw({ running: false, pid: null }) })] })).toEqual([
      { group: "cant-work", level: "error", text: "Hermes gateway is down on altair", action: START },
    ]);
  });
  it("names a ticker that stopped, with its age", () => {
    expect(warnings({ ...base, machines: [machine({ hermes_gateway: gw({ ticker_age_s: 900 }) })] })).toEqual([
      { group: "cant-work", level: "warn", text: "Hermes cron ticker stopped 15 min ago on altair", action: START },
    ]);
    expect(warnings({ ...base, machines: [machine({ hermes_gateway: gw({ ticker_age_s: 4 * 3600 }) })] })[0].text).toBe(
      "Hermes cron ticker stopped 4 h ago on altair",
    );
  });
  it("names the gateway, not the ticker, when both are wrong: one row per machine", () => {
    const w = warnings({
      ...base,
      machines: [machine({ hermes_gateway: gw({ running: false, ticker_age_s: 9000 }) })],
    });
    expect(w).toEqual([
      { group: "cant-work", level: "error", text: "Hermes gateway is down on altair", action: START },
    ]);
  });
  it("offers no button for a machine read over ssh: the click would act on the wrong machine", () => {
    const w = warnings({
      ...base,
      machines: [machine({ name: "ezio", local: false, hermes_gateway: gw({ running: false }) })],
    });
    expect(w).toEqual([{ group: "cant-work", level: "error", text: "Hermes gateway is down on ezio" }]);
  });
  it("says nothing on a machine with no gateway job", () => {
    expect(warnings({ ...base, machines: [machine({ hermes_gateway: null })] })).toEqual([]);
    expect(warnings({ ...base, machines: [machine()] })).toEqual([]);
  });
});

describe("the Start Hermes button", () => {
  it("kickstarts the gateway's launchd job in the user's own domain", () => {
    expect(kickstartArgs(501)).toEqual(["/bin/launchctl", "kickstart", "-k", "gui/501/ai.hermes.gateway"]);
  });
  it("reads the job's PID out of launchd's own output", () => {
    const loaded = '{\n\t"LastExitStatus" = 0;\n\t"Label" = "ai.hermes.gateway";\n\t"PID" = 1064;\n};';
    expect(parsePid(loaded, 0)).toBe("1064");
    expect(parsePid('{\n\t"Label" = "ai.hermes.gateway";\n};', 0)).toBe("");
    expect(parsePid('Could not find service "ai.hermes.gateway" in domain for port', 113)).toBeNull();
  });
  it("answers ok once launchd reports a PID, and says what it kicked", async () => {
    const seen: string[][] = [];
    const r = await startGateway({
      uid: 501,
      waitMs: 500,
      run: async (cmd) => {
        seen.push(cmd);
        return { ok: true, stdout: "", error: null };
      },
      read: async () => "4242",
    });
    expect(seen).toEqual([kickstartArgs(501)]);
    expect(r).toEqual({ ok: true, state: "running", pid: "4242" });
  });
  it("waits for the PID the kickstart brings up, then answers with it", async () => {
    let reads = 0;
    const r = await startGateway({
      uid: 501,
      waitMs: 5000,
      run: async () => ({ ok: true, stdout: "", error: null }),
      read: async () => (++reads > 1 ? "4242" : ""),
    });
    expect(r.ok).toBe(true);
    expect(reads).toBe(2);
  });
  it("answers with why when the gateway never comes up, and when launchd has no such job", async () => {
    const fails = { ok: false, stdout: "", error: "exit 113" };
    expect(await startGateway({ uid: 501, waitMs: 0, run: async () => fails, read: async () => "" })).toMatchObject({
      ok: false,
      state: "stopped",
      why: "exit 113",
    });
    const unknown = await startGateway({ uid: 501, waitMs: 0, run: async () => fails, read: async () => null });
    expect(unknown.ok).toBe(false);
    expect(unknown.why).toContain("no ai.hermes.gateway job");
    expect(unknown.why).toContain("exit 113");
  });
});

describe("gatewayPid's read of launchd", () => {
  it("takes the whole answer: a PID, a loaded job with none, or launchd not knowing the label", () => {
    expect(pidFromRun({ ok: true, stdout: '{\n\t"PID" = 7;\n};', error: null })).toBe("7");
    expect(pidFromRun({ ok: false, stdout: "", error: "exit 113" })).toBeNull();
    expect(pidFromRun({ ok: false, stdout: "", error: "timed out after 5 s" })).toBeNull();
  });
});
