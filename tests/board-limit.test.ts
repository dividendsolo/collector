import { describe, expect, it } from "vitest";
import { boardLimitWait, isRateLimit, limitText } from "@/lib/server/board-limit";

describe("isRateLimit", () => {
  it("knows GitHub's primary and secondary refusals", () => {
    expect(isRateLimit("gh: API rate limit already exceeded for user ID 38703245.")).toBe(true);
    expect(isRateLimit("You have exceeded a secondary rate limit")).toBe(true);
    expect(isRateLimit("gh: GitHub rate limit (secondary): backing off graphql calls until 15:41:54Z")).toBe(true);
  });

  it("is not fooled by other errors", () => {
    expect(isRateLimit("timed out after 30 s")).toBe(false);
    expect(isRateLimit("Could not resolve to a ProjectV2")).toBe(false);
  });
});

describe("boardLimitWait", () => {
  const now = Date.UTC(2026, 10, 18, 15, 30, 0);

  it("waits until GitHub's own reset time", () => {
    const reset = Math.floor(now / 1000) + 1200;
    expect(boardLimitWait({ reset }, now)).toBe(reset * 1000);
  });

  it("waits five minutes when the reset time is unknown", () => {
    expect(boardLimitWait({}, now)).toBe(now + 5 * 60_000);
  });

  it("waits at least a minute when the reset time has already passed", () => {
    expect(boardLimitWait({ reset: Math.floor(now / 1000) - 10 }, now)).toBe(now + 60_000);
  });

  it("never waits more than an hour", () => {
    expect(boardLimitWait({ reset: Math.floor(now / 1000) + 5 * 3600 }, now)).toBe(now + 3600_000);
  });
});

describe("limitText", () => {
  const now = new Date(2026, 10, 18, 14, 0, 0).getTime();

  it("names the board's age and the next try in local time", () => {
    const at = new Date(2026, 10, 18, 10, 27, 0).getTime();
    const until = new Date(2026, 10, 18, 14, 20, 0).getTime();
    expect(limitText(at, until, now)).toBe(
      "GitHub rate limit reached: the board is from 10:27 (3 h 33 min old); next read at 14:20",
    );
  });

  it("says the board never loaded when there is none", () => {
    const until = new Date(2026, 10, 18, 14, 5, 0).getTime();
    expect(limitText(0, until, now)).toBe(
      "GitHub rate limit reached: the board has not loaded yet; next read at 14:05",
    );
  });

  it("gives minutes only under an hour", () => {
    const at = new Date(2026, 10, 18, 13, 48, 0).getTime();
    const until = new Date(2026, 10, 18, 14, 10, 0).getTime();
    expect(limitText(at, until, now)).toBe(
      "GitHub rate limit reached: the board is from 13:48 (12 min old); next read at 14:10",
    );
  });
});
