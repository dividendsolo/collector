import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("an inner scroll area keeps its scroll (collector#175)", () => {
  it.each([".picks", ".code"])("%s is an area that scrolls inside itself", (selector) => {
    const r = rule(selector);
    expect(r).toMatch(/max-height:/);
    expect(r).toMatch(/overflow(-y)?:\s*(auto|scroll)/);
  });

  it.each([".picks", ".code"])("%s does not pass its scroll on to the page", (selector) => {
    expect(rule(selector)).toMatch(/overscroll-behavior:\s*contain/);
  });
});
