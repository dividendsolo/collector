import { describe, expect, it } from "vitest";
import { acked } from "@/components/acks";
import { ackKey, failingJobs, status } from "@/lib/format";
import { warnings } from "@/lib/server/warnings";

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

describe("a failed job's row", () => {
  it("has no Acknowledge, only Debug and fix", () => {
    expect(row(job).ack).toBeUndefined();
    expect(row({ ...job, id: "abc" }).debug).toEqual({ machine: "ezio", id: "abc" });
  });
});

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

describe("the Could not list tickets row", () => {
  const find = (error: string | null) =>
    warnings({ ...base, machines: [], ticketsError: error }).find((x) => x.text.startsWith("Could not list tickets"));
  const row = (error: string) => {
    const found = find(error);
    if (!found) throw new Error(`no tickets row for: ${error}`);
    return found;
  };

  it("carries an Acknowledge, keyed by the error text", () => {
    expect(row("gh: API rate limit already exceeded for user ID 12345678.").ack).toEqual({
      key: "tickets|gh: API rate limit already exceeded for user ID 12345678.",
      next: null,
    });
  });

  it("shows the row again for a new or different error, since the key is the error text", () => {
    expect(row("gh: rate limit").ack?.key).toBe("tickets|gh: rate limit");
    expect(row("gh: no such host").ack?.key).not.toBe("tickets|gh: rate limit");
  });

  it("hides the row once its key is acknowledged, and shows a different error", () => {
    const key = "tickets|gh: rate limit";
    expect(acked(row("gh: rate limit"), [])).toBe(false);
    expect(acked(row("gh: rate limit"), [key])).toBe(true);
    expect(acked(row("gh: no such host"), [key])).toBe(false);
  });

  it("is no row at all when the next ticket read works, acknowledged or not", () => {
    expect(find(null)).toBeUndefined();
  });
});
