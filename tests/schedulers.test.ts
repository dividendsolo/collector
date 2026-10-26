import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { status } from "@/lib/format";

/**
 * The plain-cron and systemd reading lives in collect.py, which runs on each machine (over ssh), so these
 * fixtures go through the same functions the reader itself calls: this driver imports collect.py and hands one
 * fixture to one function, with a fixed `now` (Friday 2026-10-23, 09:30 in the machine's own zone) so the next
 * runs a cron line works out are the same on every machine. No live system is needed — a Mac has no systemctl,
 * and a fixture covers a failed service.
 */
const DRIVER = `import inspect, json, os, sys
sys.path.insert(0, os.getcwd())
from datetime import datetime
import collect
spec = json.load(sys.stdin)
fn = getattr(collect, spec["fn"])
kw = {"now": datetime.fromisoformat(spec["now"])} if "now" in inspect.signature(fn).parameters else {}
print(json.dumps(fn(*spec["args"], **kw), default=lambda x: x.isoformat()))
`;

const NOW = "2026-10-23T09:30:00-04:00";

/** One function of collect.py, on fixture text, with `now` where the reader takes it. */
function call(fn: string, ...args: unknown[]): any {
  return JSON.parse(
    execFileSync("python3", ["-c", DRIVER], {
      cwd: process.cwd(),
      input: JSON.stringify({ fn, args, now: NOW }),
      encoding: "utf8",
    }),
  );
}

/** A user's `crontab -l`, as it comes: settings and comments first, then the lines that are jobs. */
const CRONTAB = `# m h  dom mon dow   command
SHELL=/bin/sh
PATH=/usr/bin:/bin
MAILTO = me@example.com

*/5 * * * * /usr/bin/backup.sh --now >/dev/null 2>&1
30 9 * * 1-5 cd /srv/app && ./deploy.sh
@daily ~/bin/tick.py
@reboot /usr/local/bin/startup
@every 5m /usr/bin/something
hello world this is not a schedule
not a cron line at all
`;

describe("parse_crontab", () => {
  it("reads one job per line: its command, its schedule and its next run", () => {
    const rows = call("parse_crontab", CRONTAB);
    expect(rows.map((j: any) => [j.name, j.schedule, j.next_run_at, j.script])).toEqual([
      ["/usr/bin/backup.sh --now >/dev/null 2>&1", "*/5 * * * *", "2026-10-23T09:35:00-04:00", "backup.sh"],
      ["cd /srv/app && ./deploy.sh", "30 9 * * 1-5", "2026-10-26T09:30:00-04:00", "deploy.sh"],
      ["~/bin/tick.py", "0 0 * * *", "2026-10-24T00:00:00-04:00", "tick.py"],
      ["/usr/local/bin/startup", "@reboot", null, "startup"],
    ]);
    // The @-shortcut stays on the page as the person wrote it, and @reboot has no next run to work out.
    expect(rows[2].schedule_raw).toBe("@daily");
    expect(rows[3].schedule_raw).toBe("@reboot");
  });

  it("keeps the command and the line's own id on the row, and a crontab keeps no history", () => {
    const rows = call("parse_crontab", CRONTAB);
    expect(rows[0]).toMatchObject({
      scheduler: "cron",
      command: "/usr/bin/backup.sh --now >/dev/null 2>&1",
      enabled: true,
      history: false,
      last_run_at: null,
      last_status: null,
      runs: [],
    });
    const ids = rows.map((j: any) => j.id);
    expect(new Set(ids).size).toBe(rows.length);
    expect(call("parse_crontab", CRONTAB).map((j: any) => j.id)).toEqual(ids);
  });

  it("leaves out comments, settings, an unknown @-shortcut, and a line that is not a schedule", () => {
    const rows = call("parse_crontab", CRONTAB);
    expect(rows).toHaveLength(4);
    expect(rows.some((j: any) => j.name.includes("something"))).toBe(false);
    expect(rows.some((j: any) => j.name.includes("hello"))).toBe(false);
  });

  it("shows nothing for a machine with no crontab (macOS, or `crontab -l` saying none)", () => {
    expect(call("parse_crontab", "")).toEqual([]);
  });
});

describe("cron_next", () => {
  it("reads steps, ranges, names, and 7 as Sunday", () => {
    expect(call("cron_next", "*/15 8-9 * * *")).toBe("2026-10-23T09:45:00-04:00");
    expect(call("cron_next", "0 0 1 jan *")).toBe("2027-01-01T00:00:00-04:00");
    expect(call("cron_next", "0 12 * * 7")).toBe("2026-10-25T12:00:00-04:00");
    expect(call("cron_next", "0 12 * * 0")).toBe("2026-10-25T12:00:00-04:00");
  });

  it("moves to the next day once the time has gone by, weekdays included", () => {
    // 09:30 on a Friday: today's 09:30 has gone, so a weekday line waits for Monday.
    expect(call("cron_next", "30 9 * * 1-5")).toBe("2026-10-26T09:30:00-04:00");
    expect(call("cron_next", "0 3 * * *")).toBe("2026-10-24T03:00:00-04:00");
    expect(call("cron_next", "* * * * *")).toBe("2026-10-23T09:31:00-04:00");
  });
});

/** `systemctl list-timers --all` on a Linux machine: the columns are NEXT, LEFT, LAST, PASSED, UNIT, ACTIVATES. */
const LISTED = `Fri 2026-10-23 18:20:00 UTC     5min Fri 2026-10-23 18:10:20 UTC     4min ago sysstat-collect.timer          sysstat-collect.service
Sat 2026-10-24 00:08:38 UTC        6h Fri 2026-10-23 00:47:09 UTC      17h ago logrotate.timer                logrotate.service
Mon 2026-10-26 00:00:00 UTC 2 days 6h Mon 2026-10-19 00:00:15 UTC            - tmp-sweep.timer                tmp-sweep.service
-                                      - -                                      - apport-autoreport.timer        apport-autoreport.service
`;

/** `systemctl show <timer>...`: one block per unit, which is what tells the row when it ran and when it runs. */
const TIMERS_SHOW = `Id=sysstat-collect.timer
ActiveState=active
TimersCalendar={ OnCalendar=*-*-* *:00/10:00 ; next_elapse=Fri 2026-10-23 18:20:00 UTC }
NextElapseUSecRealtime=Fri 2026-10-23 18:20:00 UTC
LastTriggerUSec=Fri 2026-10-23 18:10:20 UTC

Id=logrotate.timer
ActiveState=active
TimersCalendar={ OnCalendar=*-*-* 00:00:00 ; next_elapse=Sat 2026-10-24 00:00:00 UTC }
NextElapseUSecRealtime=Sat 2026-10-24 00:00:00 UTC
LastTriggerUSec=Fri 2026-10-23 00:47:09 UTC

Id=tmp-sweep.timer
ActiveState=active
TimersCalendar={ OnCalendar=Mon *-*-* 00:00:00 ; next_elapse=Mon 2026-10-26 00:00:00 UTC }
NextElapseUSecRealtime=Mon 2026-10-26 00:00:00 UTC
LastTriggerUSec=Mon 2026-10-19 00:00:15 UTC

Id=apport-autoreport.timer
ActiveState=inactive
`;

/** `systemctl show <service>...`: the last exit of the service each timer starts, a failed one included. */
const SERVICES_SHOW = `Id=sysstat-collect.service
Result=success
ExecMainExitTimestamp=Fri 2026-10-23 18:10:20 UTC
ExecMainStatus=0

Id=logrotate.service
Result=exit-code
ExecMainExitTimestamp=Fri 2026-10-23 00:47:09 UTC
ExecMainStatus=1

Id=tmp-sweep.service
Result=success
ExecMainExitTimestamp=Mon 2026-10-19 00:00:15 UTC
ExecMainStatus=0

Id=apport-autoreport.service
Result=success
ExecMainExitTimestamp=
ExecMainStatus=0
`;

describe("parse_timers", () => {
  const rows = call("parse_timers", LISTED, TIMERS_SHOW, SERVICES_SHOW);

  it("reads one row per timer, with its last run, its next run and its service", () => {
    expect(rows.map((j: any) => [j.name, j.schedule, j.last_run_at, j.next_run_at, j.service])).toEqual([
      [
        "sysstat-collect",
        "*-*-* *:00/10:00",
        "2026-10-23T18:10:20-04:00",
        "2026-10-23T18:20:00-04:00",
        "sysstat-collect.service",
      ],
      ["logrotate", "*-*-* 00:00:00", "2026-10-23T00:47:09-04:00", "2026-10-24T00:00:00-04:00", "logrotate.service"],
      [
        "tmp-sweep",
        "Mon *-*-* 00:00:00",
        "2026-10-19T00:00:15-04:00",
        "2026-10-26T00:00:00-04:00",
        "tmp-sweep.service",
      ],
      ["apport-autoreport", "", null, null, "apport-autoreport.service"],
    ]);
    expect(rows.every((j: any) => j.scheduler === "systemd" && j.id === j.unit)).toBe(true);
  });

  it("trusts systemd's own verdict: a non-zero exit the unit lists in SuccessExitStatus is ok", () => {
    // fwupd-refresh exits 2 for "no new metadata" and its unit says SuccessExitStatus=2 (Result=success).
    const show = `Id=fwupd-refresh.service
Result=success
ExecMainExitTimestamp=Mon 2026-10-26 12:04:21 UTC
ExecMainStatus=2
`;
    const listed = `NEXT LEFT LAST PASSED UNIT ACTIVATES
Mon 2026-10-26 13:55:22 UTC 31min Mon 2026-10-26 12:04:20 UTC 1h ago fwupd-refresh.timer fwupd-refresh.service
`;
    const timers = `Id=fwupd-refresh.timer
ActiveState=active
TimersCalendar={ OnCalendar=*-*-* 6,18:00:00 ; next_elapse=Mon 2026-10-26 13:55:22 UTC }
NextElapseUSecRealtime=Mon 2026-10-26 13:55:22 UTC
LastTriggerUSec=Mon 2026-10-26 12:04:20 UTC
`;
    const [row] = call("parse_timers", listed, timers, show);
    expect(row.last_status).toBe("ok");
    expect(status(row)).toBe("OK");
  });

  it("shows a failed service as failed, and one that never ran as no result at all", () => {
    expect(rows.map((j: any) => j.last_status)).toEqual(["ok", "exit 1", "ok", null]);
    expect(rows.map((j: any) => status(j))).toEqual(["OK", "Failed", "OK", "Paused"]);
  });

  it("reads a timer that is not active as paused, since it will not run again", () => {
    expect(rows.map((j: any) => [j.state, j.enabled])).toEqual([
      ["active", true],
      ["active", true],
      ["active", true],
      ["inactive", false],
    ]);
    expect(status(rows[3])).toBe("Paused");
  });

  it("shows nothing, and no error, for a machine with no systemctl (macOS) or no timers", () => {
    expect(call("parse_timers", "", "", "")).toEqual([]);
    expect(call("parse_timers", "\n", "", "")).toEqual([]);
  });
});

describe("read_command", () => {
  it("reads a command that works, and nothing at all for one that is missing or fails", () => {
    expect(call("read_command", ["python3", "-c", "print('one line')"]).trim()).toBe("one line");
    expect(call("read_command", ["there-is-no-command-called-this"])).toBe(null);
    // `crontab -l` with no crontab exits 1: a machine with neither cron nor systemd is not an error.
    expect(call("read_command", ["python3", "-c", "import sys; sys.exit(1)"])).toBe(null);
  });
});
