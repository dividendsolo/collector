import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { restartSshJobs, tailscaleBin } from "@/lib/server/tailscale";
import { warnings } from "@/lib/server/warnings";

/**
 * signal-tunnel on altair, 2026-11-02: Tailscale was stopped, so the tunnel's ssh could not resolve ezio, and
 * Needs attention said only "last run exit 255". The row now names the cause, and on the machine Collector runs
 * on it carries a Start Tailscale button.
 */
const DRIVER = `import json, os, sys
sys.path.insert(0, os.getcwd())
import collect
spec = json.load(sys.stdin)
print(json.dumps(collect.tailnet_reasons(*spec["args"])))`;

const reasons = (jobs: any[], state: string | null) =>
  JSON.parse(
    execFileSync("python3", ["-c", DRIVER], { input: JSON.stringify({ args: [jobs, state] }), encoding: "utf8" }),
  );

const tunnel = { name: "signal-tunnel", enabled: true, ssh_host: "ezio", last_status: "exit 255", last_error: "" };

describe("collect.py tailnet_reasons", () => {
  it("names a stopped tailnet as why a failed ssh job failed", () => {
    expect(reasons([tunnel], "Stopped")[0].last_error).toBe("Tailscale is stopped here, so ssh cannot reach ezio");
  });
  it("leaves the job alone while the tailnet runs, and a job that is not ssh", () => {
    expect(reasons([tunnel], "Running")[0].last_error).toBe("");
    expect(reasons([{ ...tunnel, ssh_host: "" }], "Stopped")[0].last_error).toBe("");
  });
});

const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;

describe("Needs attention with a stopped tailnet", () => {
  it("puts the reason and a Start Tailscale button on this machine's failed ssh job", () => {
    const job = { ...tunnel, last_error: "Tailscale is stopped here, so ssh cannot reach ezio" };
    const w = warnings({ ...base, machines: [{ name: "altair", local: true, tailscale: "Stopped", jobs: [job] }] });
    expect(w).toHaveLength(1);
    expect(w[0].text).toBe(
      "signal-tunnel on altair: last run exit 255 (Tailscale is stopped here, so ssh cannot reach ezio)",
    );
    expect(w[0].action).toEqual({ label: "Start Tailscale", post: "/api/tailscale" });
  });
  it("offers no button for a machine read over ssh: the click would act on the wrong machine", () => {
    const w = warnings({ ...base, machines: [{ name: "ezio", local: false, tailscale: "Stopped", jobs: [tunnel] }] });
    expect(w[0].action).toBeUndefined();
  });
  it("says the tailnet is stopped when no ssh job has failed yet", () => {
    const w = warnings({ ...base, machines: [{ name: "altair", local: true, tailscale: "Stopped", jobs: [] }] });
    expect(w).toEqual([
      {
        level: "warn",
        text: "Tailscale is stopped on altair",
        action: { label: "Start Tailscale", post: "/api/tailscale" },
      },
    ]);
  });
  it("says nothing while the tailnet runs or the machine has no Tailscale", () => {
    for (const tailscale of ["Running", null])
      expect(warnings({ ...base, machines: [{ name: "altair", local: true, tailscale, jobs: [] }] })).toEqual([]);
  });
});

describe("a machine that could not be read while the tailnet here is down", () => {
  it("names the stopped tailnet and carries the button", () => {
    const w = warnings({
      ...base,
      machines: [
        { name: "altair", local: true, tailscale: "Stopped", jobs: [] },
        { name: "ezio", local: false, error: "ssh: Could not resolve hostname ezio", jobs: [] },
      ],
    });
    const row = w.find((x) => x.text.startsWith("Could not read ezio"));
    expect(row?.text).toBe(
      "Could not read ezio: ssh: Could not resolve hostname ezio (Tailscale is stopped on altair)",
    );
    expect(row?.action).toEqual({ label: "Start Tailscale", post: "/api/tailscale" });
  });
  it("adds nothing while the tailnet here runs", () => {
    const w = warnings({
      ...base,
      machines: [
        { name: "altair", local: true, tailscale: "Running", jobs: [] },
        { name: "ezio", local: false, error: "timed out after 20 s", jobs: [] },
      ],
    });
    expect(w).toEqual([{ level: "error", text: "Could not read ezio: timed out after 20 s" }]);
  });
});

describe("tailscaleBin", () => {
  it("finds the Mac app's CLI when nothing is on PATH", () => {
    expect(tailscaleBin((p) => p.startsWith("/Applications/"))).toBe(
      "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    );
    expect(tailscaleBin(() => false)).toBeNull();
  });
});

describe("restartSshJobs", () => {
  it("picks only the failed launchd ssh jobs", async () => {
    const jobs = [
      { scheduler: "launchd", id: "com.example.tunnel", ssh_host: "h", last_status: "exit 255" },
      { scheduler: "launchd", id: "com.example.ok", ssh_host: "h", last_status: "ok" },
      { scheduler: "launchd", id: "com.example.local", ssh_host: "", last_status: "exit 1" },
      { scheduler: "cron", id: "x", ssh_host: "h", last_status: "exit 255" },
    ];
    // uid -1 names no launchd domain, so the kickstart fails harmlessly: only the choice is under test.
    expect(await restartSshJobs(jobs, -1)).toEqual(["com.example.tunnel"]);
  });
});
