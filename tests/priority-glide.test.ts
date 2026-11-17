import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { transitionNames } from "@/lib/priority";

const root = path.join(__dirname, "..");
const dashboard = readFileSync(path.join(root, "components", "dashboard.tsx"), "utf8");
const css = readFileSync(path.join(root, "app", "globals.css"), "utf8");

describe("a Priority tasks row's view transition name", () => {
  it("is its ack key, else its text, as a CSS ident", () => {
    const names = transitionNames([
      { ack: { key: "host-a|job|2026-11-02T13:21:52+00:00" }, text: "x" },
      { text: "3 cards" },
    ]);
    expect(names).toEqual(["alert-host-a_job_2026-11-02T13_21_52_00_00", "alert-3_cards"]);
    for (const n of names) expect(n).toMatch(/^[A-Za-z_-][A-Za-z0-9_-]*$/);
  });

  it("is unique even when two rows read the same", () => {
    const names = transitionNames([{ text: "a b" }, { text: "a_b" }, { text: "a_b-1" }, { text: "a b" }]);
    expect(new Set(names).size).toBe(4);
  });

  it("stays the same when a row is acknowledged, since it does not depend on the row's side of the rule", () => {
    const rows = [
      { text: "one", ack: { key: "k1" } },
      { text: "two", ack: { key: "k2" } },
    ];
    expect(transitionNames(rows)).toEqual(transitionNames(rows.map((r) => ({ ...r }))));
  });
});

describe("Acknowledge and Undo glide the row", () => {
  it("both clicks run in a view transition", () => {
    expect(dashboard).toContain("withViewTransition(() => setAck(x.ack.key, true))");
    expect(dashboard).toContain("withViewTransition(() => setAck(x.ack.key, false))");
    expect(dashboard).not.toMatch(/onClick=\{\(\) => setAck\(/);
  });

  it("open rows, acked rows and the rule carry a view transition name", () => {
    expect(dashboard.match(/viewTransitionName: names\.get\(x\)/g)?.length).toBe(2);
    expect(css).toMatch(/\.acked-rule \{[^}]*view-transition-name: acked-rule;/);
  });

  it("moves for 200ms on the strong ease-in-out, with the page itself not animated", () => {
    expect(css).toContain("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);");
    expect(css).toMatch(
      /::view-transition-group\(\*\) \{\s*animation-duration: 200ms;\s*animation-timing-function: var\(--ease-in-out\);/,
    );
    expect(css).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\) \{\s*animation: none;/);
  });

  it("drops the movement under reduced motion and keeps the 200ms crossfade, which inherits the group's duration", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*::view-transition-group\(\*\) \{\s*animation-name: none;\s*\}/,
    );
  });
});
