import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("the app shell is as tall as the visible area (collector#168)", () => {
  it("gives the shell the dynamic height, which follows the browser chrome", () => {
    expect(rule(".app")).toMatch(/min-height:\s*100dvh/);
  });

  it("gives the sticky sidebar the dynamic height too", () => {
    expect(rule(".sidebar")).toMatch(/height:\s*100dvh/);
  });

  it("leaves no height in vh on either: vh is the viewport with the chrome collapsed", () => {
    expect(rule(".app")).not.toMatch(/\d+vh/);
    expect(rule(".sidebar")).not.toMatch(/\d+vh/);
  });
});
