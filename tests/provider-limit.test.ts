import { describe, expect, it } from "vitest";
import { ackKey, status } from "@/lib/format";
import { providerLimit } from "@/lib/provider-limit";
import { warnings } from "@/lib/server/warnings";

const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;

const demandWatch = {
  id: "ba43a117e994",
  name: "Demand Watch",
  enabled: true,
  last_status: "error",
  last_error: "RuntimeError: HTTP 429: This request would exceed your account's rate limit. Please try again later.",
  last_run_at: "2026-11-18T13:50:42.837059+00:00",
  next_run_at: "2026-11-25T13:30:00+00:00",
};

const row = (j: any) => warnings({ ...base, machines: [{ name: "ezio", jobs: [j] }] })[0];

describe("providerLimit reads the provider's own refusal", () => {
  it("names a 429 rate limit", () => {
    expect(providerLimit(demandWatch.last_error)).toBe("its rate limit is used up");
  });

  it("names a usage limit with the date it comes back", () => {
    expect(
      providerLimit(
        "RuntimeError: HTTP 400: You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.",
      ),
    ).toBe("the account's usage limit is reached until 2026-12-01 at 00:00 UTC");
  });

  it("names Hermes's daily usage limit with the time it resets, so the row is acknowledged, not debugged", () => {
    const error =
      "RuntimeError: HTTP 402: Your included Hermes usage for today is used up and your credits can't cover this request. It resets at Nov 24, 4:22 PM UTC. Add credits to keep going now.";
    expect(providerLimit(error)).toBe("the account's usage limit is reached until Nov 24, 4:22 PM UTC");
    const r = row({ ...demandWatch, name: "Lead Watch", last_error: error });
    expect(r.ack).toBeDefined();
    expect(r.debug).toBeUndefined();
  });

  it("names an out-of-credits refusal", () => {
    expect(
      providerLimit(
        "RuntimeError: HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 131072 tokens, but can only afford 318.",
      ),
    ).toBe("the account is out of credits");
  });

  it("is null for a failure in our own code", () => {
    expect(providerLimit("Script exited with code 4")).toBeNull();
    expect(providerLimit("Traceback: KeyError: 'hits'")).toBeNull();
    expect(providerLimit("")).toBeNull();
  });

  it("is null for a 429 our own script hit against someone else's API", () => {
    expect(providerLimit("lead-watch: Reddit returned HTTP 429 for the batch")).toBeNull();
  });
});

describe("a job the AI provider refused", () => {
  const r = row(demandWatch);

  it("says the provider refused it, not that the job erred", () => {
    expect(r.text).toContain("the AI provider refused the run");
    expect(r.text).toContain("its rate limit is used up");
    expect(r.text).toContain("Nothing in our code to fix");
  });

  it("still shows the provider's own words", () => {
    expect(r.text).toContain("would exceed your account's rate limit");
  });

  it("offers Acknowledge, not Debug and fix", () => {
    expect(r.ack).toEqual({ key: ackKey({ ...demandWatch, machine: "ezio" }), next: demandWatch.next_run_at });
    expect(r.debug).toBeUndefined();
  });

  it("acknowledging it clears the Cron Jobs icon too, because the key is the job's", () => {
    const j = { ...demandWatch, machine: "ezio" };
    expect(status(j, [])).toBe("Failed");
    expect(status(j, [ackKey(j)])).toBe("Acknowledged");
  });

  it("is a warning, not an error: nobody has to act", () => {
    expect(r.level).toBe("warn");
  });
});

describe("a job that failed in our own code", () => {
  const r = row({ ...demandWatch, last_error: "Script exited with code 4" });

  it("keeps Debug and fix and says nothing about a provider", () => {
    expect(r.debug).toEqual({ machine: "ezio", id: "ba43a117e994" });
    expect(r.ack).toBeUndefined();
    expect(r.text).not.toContain("provider");
    expect(r.level).toBe("error");
  });
});
