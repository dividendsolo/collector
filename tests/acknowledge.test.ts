import { describe, expect, it } from "vitest";
import { ackKey, failingJobs, status } from "@/lib/format";
import { warnings } from "@/lib/server/warnings";

/**
 * situation-maintainer on ezio, 2026-11-02: the weekly pass did its work, the gateway dropped at the end, and the row
 * said "last run error (Script exited with code 4)" for a week. James: "I've acknowledged it and I've handled it and we
 * just have to wait for the next run". An acknowledgement covers one run: the key names the run's time.
 */
const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;
const job = {
  name: "situation-maintainer",
  enabled: true,
  last_status: "error",
  last_error: "Script exited with code 4",
  last_run_at: "2026-11-02T13:21:52+00:00",
  next_run_at: "2026-11-09T08:30:00+00:00",
};
const row = (j: any) => warnings({ ...base, machines: [{ name: "ezio", jobs: [j] }] })[0];

/**
 * James, 2026-11-11: "we don't want to just acknowledge them, we need to fix them". A failed run's row has no
 * Acknowledge any more: it has Debug and fix, and it leaves when the job's next run ends ok.
 */
describe("a failed job's row", () => {
  it("has no Acknowledge, only Debug and fix", () => {
    expect(row(job).ack).toBeUndefined();
    expect(row({ ...job, id: "abc" }).debug).toEqual({ machine: "ezio", id: "abc" });
  });
});

/**
 * James, 2026-11-06: the Cron Jobs icon in the sidebar stayed red for the acknowledged situation-maintainer failure,
 * "it should be checking acknowledgements because we don't want that to just stay there forever". An acknowledged
 * failed run leaves the sidebar's failing count and reads Acknowledged on the Cron Jobs page, until the job runs again.
 */
describe("Acknowledge clears the Cron Jobs icon", () => {
  const key = "ezio|situation-maintainer|2026-11-02T13:21:52+00:00";
  const jobs = [{ ...job, machine: "ezio" }];
  it("an acknowledged failed run is not counted as failing", () => {
    expect(failingJobs(jobs, [])).toHaveLength(1);
    expect(failingJobs(jobs, [key])).toHaveLength(0);
  });
  it("an acknowledged failed run reads Acknowledged, not Failed", () => {
    expect(status(jobs[0], [key])).toBe("Acknowledged");
    expect(status(jobs[0], [])).toBe("Failed");
    expect(status(jobs[0])).toBe("Failed");
  });
  it("the next failed run counts again", () => {
    const next = [{ ...jobs[0], last_run_at: "2026-11-09T08:31:00+00:00" }];
    expect(failingJobs(next, [key])).toHaveLength(1);
    expect(status(next[0], [key])).toBe("Failed");
  });
  it("names the machine, the job and that run, so an old acknowledgement covers that run only", () => {
    expect(ackKey(jobs[0])).toBe(key);
  });
});
