import { describe, expect, it } from "vitest";
import {
  closeStreams,
  etimeSeconds,
  openStream,
  openStreams,
  recentProcesses,
  redact,
  startLine,
  termLine,
} from "@/lib/server/lifecycle";

// `ps -Ao pid,ppid,etime,command` as macOS prints it, cut down. 85632 is the server itself.
const PS = `  PID  PPID     ELAPSED COMMAND
    1     0 12-03:04:05 /sbin/launchd
85631     1       19:41 /Users/james/.bun/bin/bun run start
85632 85631       19:40 next-server (v16.4.2)
73110 73100       00:04 /bin/bash -c kill 85632
73111 73110       00:03 sleep 1
73120 85632       00:00 ps -Ao pid,ppid,etime,command
73119 73001       00:12 git status
73000 1         00:16 /bin/bash old
`;

describe("the server's own start and SIGTERM lines (card #41, item 3)", () => {
  it("reads ps's elapsed time in every shape it prints", () => {
    expect(etimeSeconds("05")).toBe(5);
    expect(etimeSeconds("01:05")).toBe(65);
    expect(etimeSeconds("02:01:05")).toBe(7265);
    expect(etimeSeconds("1-00:00:01")).toBe(86401);
    expect(etimeSeconds("junk")).toBeNull();
  });

  it("names the processes that started in the last seconds, never the server or the ps it ran", () => {
    const lines = recentProcesses(PS, { self: 85632, within: 15 });
    expect(lines).toEqual([
      "73110 (parent 73100, 4 s): /bin/bash -c kill 85632",
      "73111 (parent 73110, 3 s): sleep 1",
      "73119 (parent 73001, 12 s): git status",
    ]);
  });

  it("masks anything shaped like a credential in another process's command line", () => {
    expect(redact('curl -H "Authorization: Bearer abc.def" https://x')).toBe(
      'curl -H "Authorization: Bearer ***" https://x',
    );
    expect(redact("tool --api-key=s3cret --token abc")).toBe("tool --api-key=*** --token abc");
    expect(redact("GH_TOKEN=ghp_0123456789abcdef run")).toBe("GH_TOKEN=*** run");
    expect(redact("echo ghp_0123456789abcdef")).toBe("echo ***");
    expect(redact("git status")).toBe("git status");
  });

  it("stamps a start with its time, pid, parent and build", () => {
    const at = new Date("2026-10-29T20:33:03.600Z");
    expect(startLine(at, 73253, 73252, { id: "abc", commit: "6b1456d0000" })).toBe(
      "[server] start 2026-10-29T20:33:03.600Z pid 73253 parent 73252 build abc (6b1456d)",
    );
    expect(startLine(at, 1, 0, { id: null, commit: null })).toBe(
      "[server] start 2026-10-29T20:33:03.600Z pid 1 parent 0 build none",
    );
  });

  it("stamps a SIGTERM with its time, pid, the open streams it ends and who started lately", () => {
    const at = new Date("2026-10-29T20:22:55.000Z");
    expect(termLine(at, 85632, 85631, 1, ["73110 (parent 73100, 4 s): /bin/bash -c kill 85632"])).toBe(
      "[server] SIGTERM 2026-10-29T20:22:55.000Z pid 85632 parent 85631; ending 1 open event stream so the " +
        "server can exit; started in the last 15 s:\n[server]   73110 (parent 73100, 4 s): /bin/bash -c kill 85632",
    );
    expect(termLine(at, 2, 1, 0, [])).toBe(
      "[server] SIGTERM 2026-10-29T20:22:55.000Z pid 2 parent 1; ending 0 open event streams so the server can " +
        "exit; started in the last 15 s: nothing",
    );
  });

  it("ends every open event stream at once, so a SIGTERM does not leave the server alive with its port shut", () => {
    closeStreams();
    const ended: string[] = [];
    const off = openStream(() => ended.push("a"));
    openStream(() => ended.push("b"));
    off();
    expect(openStreams()).toBe(1);
    expect(closeStreams()).toBe(1);
    expect(ended).toEqual(["b"]);
    expect(openStreams()).toBe(0);
  });
});
