import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const block = (head: string) => {
  const at = css.indexOf(head);
  expect(at, `${head} exists`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`${head} is not closed`);
};

const reducedToastRule = () => {
  const media = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)]
    .map((m) => block(css.slice(m.index)))
    .find((b) => /\.toast\s*\{/.test(b));
  expect(media, "a reduced-motion block styles .toast").toBeDefined();
  return media as string;
};

describe("a toast under reduced motion", () => {
  it("still fades in, so it never pops in during one frame", () => {
    const rule = reducedToastRule();
    expect(rule).not.toMatch(/animation:\s*none/);
    expect(rule).toMatch(/animation(-name)?:\s*toast-fade\b/);
  });

  it("fades with opacity only and does not slide", () => {
    const fade = block("@keyframes toast-fade");
    expect(fade).toMatch(/opacity:\s*0/);
    expect(fade).not.toMatch(/transform/);
  });
});
