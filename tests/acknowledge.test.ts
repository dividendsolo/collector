import { describe, expect, it } from "vitest";
import { acked } from "@/components/acks";
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

describe("Acknowledge on a failed job's row", () => {
  it("names the machine, the job and that run, and when the next run is", () => {
    expect(row(job).ack).toEqual({
      key: "ezio|situation-maintainer|2026-11-02T13:21:52+00:00",
      next: "2026-11-09T08:30:00+00:00",
    });
  });
  it("covers that run only: a new failed run is open again", () => {
    const acks = [(row(job).ack as { key: string }).key];
    expect(acked(row(job), acks)).toBe(true);
    expect(acked(row({ ...job, last_run_at: "2026-11-09T08:31:00+00:00" }), acks)).toBe(false);
  });
});
