import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * James, 2026-11-16: Current work and Waiting on you list every card, so the page scrolls past hundreds of rows.
 * Each panel holds about 15 rows and scrolls the rest inside itself, with the column heads kept in view.
 */
const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const src = (f: string) => readFileSync(path.join(process.cwd(), "components", f), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("the long panels scroll inside themselves", () => {
  it("caps the table area's height and scrolls it", () => {
    const r = rule(".wrap.scroll");
    expect(r).toMatch(/max-height:\s*calc\(/);
    expect(r).toMatch(/overflow-y:\s*auto/);
  });

  it("keeps the column heads in view while the rows scroll", () => {
    const r = rule(".wrap.scroll thead th");
    expect(r).toMatch(/position:\s*sticky/);
    expect(r).toMatch(/top:\s*0/);
  });

  it("uses the scrolling area in Current work and in Waiting on you", () => {
    expect(src("running.tsx")).toMatch(/id="current-work"[\s\S]*?<div className="wrap scroll">/);
    expect(src("dashboard.tsx")).toMatch(/id="waiting-panel"[\s\S]*?<div className="wrap scroll">/);
  });
});
