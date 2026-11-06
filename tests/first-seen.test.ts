import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * James, 2026-11-06: each Needs attention row shows how long ago it first showed up. The time is kept per row text,
 * survives a restart, and starts again when a row clears and comes back.
 */
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "first-seen-")), "seen.json");
process.env.COLLECTOR_FIRST_SEEN = file;
const { firstSeen, resetFirstSeen } = await import("@/lib/server/first-seen");

beforeEach(() => {
  fs.rmSync(file, { force: true });
  resetFirstSeen();
});

describe("firstSeen", () => {
  it("stamps a new row with now, and keeps that time while the row stays", () => {
    expect(firstSeen(["a"], 100)).toEqual({ a: 100 });
    expect(firstSeen(["a", "b"], 200)).toEqual({ a: 100, b: 200 });
  });
  it("keeps the times across a restart", () => {
    firstSeen(["a"], 100);
    resetFirstSeen();
    expect(firstSeen(["a"], 500)).toEqual({ a: 100 });
  });
  it("starts a row again from now when it cleared and came back", () => {
    firstSeen(["a"], 100);
    firstSeen([], 200);
    expect(firstSeen(["a"], 300)).toEqual({ a: 300 });
  });
});
