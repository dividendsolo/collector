import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const GATE = "@media (hover: hover) and (pointer: fine)";

function splitByGate(source: string): { gated: string; ungated: string } {
  let gated = "";
  let ungated = "";
  let cursor = 0;
  for (;;) {
    const start = source.indexOf(GATE, cursor);
    if (start === -1) break;
    const open = source.indexOf("{", start);
    let depth = 1;
    let end = open + 1;
    while (depth > 0 && end < source.length) {
      if (source[end] === "{") depth++;
      if (source[end] === "}") depth--;
      end++;
    }
    ungated += source.slice(cursor, start);
    gated += source.slice(open + 1, end - 1);
    cursor = end;
  }
  ungated += source.slice(cursor);
  return { gated, ungated };
}

const { gated, ungated } = splitByGate(css);

describe("button hovers do not stick after a tap", () => {
  it.each([
    ".btn:hover:not(:disabled)",
    ".btn.danger:hover",
    ".blur-toggle:hover",
    ".release-btn:hover",
    ".seg button:hover",
  ])("%s applies only to a fine pointer that can hover", (selector) => {
    expect(gated).toContain(selector);
    expect(ungated).not.toContain(selector);
  });

  it("keeps the release button's keyboard focus style outside the hover query", () => {
    expect(ungated).toContain(".release-btn:focus-visible");
  });
});
