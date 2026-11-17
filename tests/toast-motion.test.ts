import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const block = (at: number) => {
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error(`block at ${at} is not closed`);
};

const toastRule = () => {
  const at = css.search(/^\s*\.toast \{/m);
  expect(at, "a .toast rule exists").toBeGreaterThan(-1);
  return block(at);
};

const reducedToastBlock = () => {
  const media = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)]
    .map((m) => block(m.index))
    .find((b) => /\.toast\s*\{/.test(b));
  expect(media, "a reduced-motion block styles .toast").toBeDefined();
  return media as string;
};

describe("a toast under reduced motion", () => {
  it("still fades in, so it never pops in during one frame", () => {
    expect(toastRule()).toMatch(/transition:[^;]*opacity \d+ms/);
    expect(toastRule()).toMatch(/@starting-style\s*\{[^}]*opacity:\s*0/);
    const reduced = reducedToastBlock();
    expect(reduced).not.toMatch(/(animation|transition)(-[a-z]+)?:\s*none/);
    expect(reduced).not.toMatch(/opacity:\s*1/);
  });

  it("fades with opacity only and does not slide in or out", () => {
    const reduced = reducedToastBlock();
    expect(reduced).toMatch(/\.toast\s*\{\s*@starting-style\s*\{\s*transform:\s*none;/);
    expect(reduced).toMatch(/\.toast\.leaving\s*\{\s*transform:\s*none;/);
  });
});
