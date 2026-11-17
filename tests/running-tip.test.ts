import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tagClass } from "@/components/app";
import { pillClass, runningTipProps } from "@/components/running";
import { runningTip, runWait, type WorkRun } from "@/lib/work";

const NOW = 1794933000;
const run = (extra: Partial<WorkRun> = {}): WorkRun => ({
  type: "agent",
  name: "collector-builder",
  kind: "build",
  machine: "ezio",
  repo: "collector",
  card: 220,
  seconds: 1500,
  ...extra,
});
const backoff = { on: "GitHub", why: "rate limit", until: Date.UTC(2026, 10, 17, 14, 38) / 1000 };

describe("the running count's hover (collector#220)", () => {
  it("says a run in a GitHub back-off waits on GitHub, and when it retries", () => {
    expect(runWait(run({ wait: backoff }), "UTC")).toBe("waiting on GitHub (rate limit), retry at 14:38");
  });
  it("says nothing of a wait for a run that works", () => {
    expect(runWait(run(), "UTC")).toBe("");
  });
  it("lists each run: card, role, machine, how long, and what it does or waits on", () => {
    expect(
      runningTip(
        [
          run({ wait: backoff }),
          run({ type: "script", name: "work script", kind: "verify", card: 219, seconds: 300, machine: "altair" }),
        ],
        "UTC",
      ),
    ).toEqual([
      ["collector#220", "collector-builder on ezio, 25 min, waiting on GitHub (rate limit), retry at 14:38"],
      ["collector#219", "work script on altair, 5 min, verifying"],
    ]);
  });
  it("names a session with no card by its tool, and says it has no repo", () => {
    expect(runningTip([run({ kind: "session", card: null, repo: null, name: "claude", seconds: NOW })], "UTC")).toEqual(
      [["no repo", "claude on local, interactive, session"]],
    );
  });
});

describe("a waiting run shows without a hover (collector#220)", () => {
  it("wears the amber waiting pill, where a working run wears its type", () => {
    expect(pillClass(run({ wait: backoff }))).toBe("waiting");
    expect(pillClass(run())).toBe("agent");
  });
  it("turns the sidebar's running count amber while a run waits", () => {
    expect(tagClass({ text: "2", hot: false, wait: true })).toBe("tag wait");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.pill\.waiting \{\s*color: var\(--amber\);/);
    expect(css).toMatch(/\.rail \.tag\.wait \{\s*color: var\(--amber\);/);
  });
  it("puts the run list on the count for the shared hover card", () => {
    expect(runningTipProps([run()])).toEqual({
      "data-tip": "",
      "data-tip-title": "Running now",
      "data-tip-facts": JSON.stringify([["collector#220", "collector-builder on ezio, 25 min, building"]]),
    });
    expect(runningTipProps([])).toEqual({});
  });
});

describe("the hover card on a phone (collector#220)", () => {
  it("is as wide as the screen allows, so a run's line is not squeezed against the right edge", () => {
    expect(readFileSync("app/globals.css", "utf8")).toMatch(
      /@media \(max-width: 496px\) \{\s*#card-tip \{\s*max-width: calc\(100vw - 16px\);/,
    );
  });
});
