import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const body = (selector: string) => {
  const match = css.match(new RegExp(`\\n  ${selector} \\{([^}]*)\\}`));
  expect(match, `${selector} has a rule`).not.toBeNull();
  return (match as RegExpMatchArray)[1];
};

describe("the top bar's live dot", () => {
  it("stands still when nothing is running", () => {
    expect(body("\\.pulse")).not.toMatch(/animation/);
  });

  it("pulses only while the reader is busy", () => {
    expect(body("\\.live\\.busy \\.pulse")).toMatch(/animation: pulse 0\.6s ease-in-out infinite;/);
  });

  it("stands still for a reader who asked for less motion, busy or not", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.pulse,\s*\.live\.busy \.pulse \{\s*animation: none;/,
    );
  });
});
