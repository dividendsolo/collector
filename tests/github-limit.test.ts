import { describe, expect, it } from "vitest";
import { clearsText, PER_MINUTE_WINDOW_S, recentRefusal, refusalKind, retryAfterSeconds } from "@/lib/github-limit";

const PRIMARY = "GraphQL: API rate limit already exceeded for user ID 38703245. (RATE_LIMITED)";
const SECONDARY = "HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";

describe("which GitHub limit refused a call (collector#219)", () => {
  it("reads a refusal that names the secondary limit as the per-minute limit", () => {
    expect(refusalKind(SECONDARY, 1444)).toBe("minute");
  });

  it("reads a refusal while the hourly limit still has points left as the per-minute limit", () => {
    expect(refusalKind(PRIMARY, 1444)).toBe("minute");
  });

  it("reads a refusal with no points left as the hourly limit", () => {
    expect(refusalKind(PRIMARY, 0)).toBe("hourly");
  });

  it("keeps the secondary limit's own words over the count", () => {
    expect(refusalKind(SECONDARY, 0)).toBe("minute");
  });

  it("reads a refusal with no count to go on as the per-minute limit", () => {
    expect(refusalKind(PRIMARY, null)).toBe("minute");
  });
});

describe("the retry-after a refusal named (collector#219)", () => {
  it("reads the seconds off the refusal's own headers", () => {
    expect(retryAfterSeconds("HTTP/2.0 403 Forbidden\nRetry-After: 120\nContent-Type: application/json")).toBe(120);
  });

  it("reads a lowercase header", () => {
    expect(retryAfterSeconds("retry-after: 60")).toBe(60);
  });

  it("is nothing when the refusal named none, or named a date", () => {
    expect(retryAfterSeconds("HTTP/2.0 403 Forbidden")).toBeNull();
    expect(retryAfterSeconds("Retry-After: Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(retryAfterSeconds(null)).toBeNull();
  });
});

describe("how long a refusal shows (collector#219)", () => {
  const now = 1_800_000_000;

  it("keeps a refusal inside the ten minutes", () => {
    expect(recentRefusal({ at: now - 60, limit: "minute", retryAfter: 60 }, now)?.at).toBe(now - 60);
  });

  it("keeps one right on the edge", () => {
    const at = now - PER_MINUTE_WINDOW_S;
    expect(recentRefusal({ at, limit: "minute", retryAfter: null }, now)?.at).toBe(at);
  });

  it("forgets one older than that, and one that never happened", () => {
    expect(recentRefusal({ at: now - PER_MINUTE_WINDOW_S - 1, limit: "minute", retryAfter: null }, now)).toBeNull();
    expect(recentRefusal(null, now)).toBeNull();
  });
});

describe("when a per-minute refusal clears (collector#219)", () => {
  it("counts the retry-after in minutes", () => {
    expect(clearsText(60)).toBe("clears in about 1 min");
    expect(clearsText(120)).toBe("clears in about 2 min");
    expect(clearsText(90)).toBe("clears in about 2 min");
  });

  it("says a few minutes when GitHub named none", () => {
    expect(clearsText(null)).toBe("clears in a few minutes");
  });
});
