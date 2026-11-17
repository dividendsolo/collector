import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const css = read(path.join("app", "globals.css"));
const layout = read(path.join("app", "layout.tsx"));

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

describe("the page letterboxes inside the safe area instead of painting edge to edge (collector#177)", () => {
  it("asks the browser for the whole screen, since env(safe-area-inset-*) is 0px without it", () => {
    expect(layout).toMatch(/export const viewport/);
    expect(layout).toMatch(/viewportFit:\s*"cover"/);
    expect(layout).toMatch(/interactiveWidget:\s*"resizes-content"/);
  });

  it("grows the sticky top bar by the top inset and pads its content down by the same", () => {
    const topbar = rule(".topbar");
    expect(topbar).toMatch(/height:\s*calc\(48px \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(topbar).toMatch(/padding-top:\s*env\(safe-area-inset-top, 0px\)/);
  });

  it("keeps an open brief's sticky head under the taller top bar", () => {
    expect(rule(".brief-panel > .panel-head")).toMatch(/top:\s*calc\(48px \+ env\(safe-area-inset-top, 0px\)\)/);
  });

  it("pads the rail past the notch on the left and the home indicator below, keeping its own edge", () => {
    const rail = rule(".rail");
    expect(rail).toMatch(/padding-left:\s*calc\(8px \+ env\(safe-area-inset-left, 0px\)\)/);
    expect(rail).toMatch(/padding-bottom:\s*calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it("widens the rail and its column by the left inset, so the padding past the notch keeps every icon inside", () => {
    const wide = /width:\s*calc\(var\(--sidebar\) \+ env\(safe-area-inset-left, 0px\)\)/;
    expect(rule(".sidebar")).toMatch(wide);
    expect(rule(".rail")).toMatch(wide);
    expect(rule(".rail:has(:focus-visible)")).toMatch(/width:\s*calc\(200px \+ env\(safe-area-inset-left, 0px\)\)/);
  });

  it("grows the rail's head by the top inset, so the logo clears the status bar and its line meets the top bar's", () => {
    const home = rule(".rail .home");
    expect(home).toMatch(/height:\s*calc\(48px \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(home).toMatch(/padding-top:\s*env\(safe-area-inset-top, 0px\)/);
    expect(home).toMatch(/flex:\s*none/);
    expect(home).toMatch(/margin-left:\s*calc\(-8px - env\(safe-area-inset-left, 0px\)\)/);
    expect(home).toMatch(/padding-left:\s*calc\(12px \+ env\(safe-area-inset-left, 0px\)\)/);
  });

  it("pads the top bar and the content past the inset on the right, so text and panels clear the cutout", () => {
    const right = (px: number) =>
      new RegExp(`padding-right:\\s*calc\\(${px}px \\+ env\\(safe-area-inset-right, 0px\\)\\)`);
    expect(rule(".topbar")).toMatch(right(24));
    expect(rule(".content")).toMatch(right(24));
    const narrow = css.slice(css.indexOf("@media (max-width: 600px) {\n    .content {"));
    const narrowRule = (selector: string) => {
      const at = narrow.indexOf(`${selector} {`);
      return narrow.slice(at, narrow.indexOf("}", at));
    };
    expect(narrowRule(".content")).toMatch(right(16));
    expect(narrowRule(".topbar")).toMatch(right(16));
  });

  it("scrolls a panel into view clear of the taller top bar", () => {
    expect(css).toMatch(/\.panel \{\s*scroll-margin-top:\s*calc\(64px \+ env\(safe-area-inset-top, 0px\)\);/);
  });

  it("lifts the toasts past the home indicator and the inset on the right", () => {
    const toasts = rule(".toasts");
    expect(toasts).toMatch(/bottom:\s*calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(toasts).toMatch(/right:\s*calc\(16px \+ env\(safe-area-inset-right, 0px\)\)/);
  });
});
