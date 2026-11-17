import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const flow = readFileSync(path.join(process.cwd(), "components", "flow.tsx"), "utf8");

const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
};

const frames = (name: string) => {
  const at = css.indexOf(`@keyframes ${name} {`);
  expect(at, `@keyframes ${name} is defined`).toBeGreaterThan(-1);
  const end = css.indexOf("\n  }", at);
  expect(end, `@keyframes ${name} is closed`).toBeGreaterThan(-1);
  return css.slice(at, end);
};

describe("a status tooltip's entrance (collector#153)", () => {
  it("grows out of its status box: the page's strong ease-out over 125ms, from scale 0.97 and no opacity", () => {
    expect(rule(":root")).toMatch(/--ease-out:\s*cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/);
    expect(rule(".flow-tip")).toMatch(/animation:\s*flow-tip-in\s+125ms\s+var\(--ease-out\)/);
    const from = frames("flow-tip-in");
    expect(from).toMatch(/opacity:\s*0/);
    expect(from).toMatch(/transform:\s*scale\(0\.97\)/);
  });

  it("scales from the box it opens from, not from its own middle", () => {
    expect(rule('.flow-tip[data-side="top"]')).toMatch(/transform-origin:\s*bottom center/);
    expect(rule('.flow-tip[data-side="bottom"]')).toMatch(/transform-origin:\s*top center/);
    expect(flow).toMatch(/data-side=\{above \? "top" : "bottom"\}/);
  });

  it("keeps only the fade for a reader who asked for less motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.flow-tip \{\s*animation-name: flow-tip-fade;/,
    );
    expect(frames("flow-tip-fade")).toMatch(/opacity:\s*0/);
    expect(frames("flow-tip-fade")).not.toMatch(/transform/);
  });
});

describe("a sweep across the statuses (collector#153)", () => {
  it("calls a tip entered right after another left warm, and one entered a moment later not", async () => {
    const { FLOW_TIP_WARM_MS, tipWarm } = await import("@/lib/flow");
    expect(FLOW_TIP_WARM_MS).toBe(300);
    expect(tipWarm(1000, 800)).toBe(true);
    expect(tipWarm(1299, 1000)).toBe(true);
    expect(tipWarm(1300, 1000)).toBe(false);
    expect(tipWarm(5000, 0)).toBe(false);
  });

  it("shows the next tooltip at once: no entrance on a warm canvas", () => {
    expect(rule(".flow-canvas[data-warm] .flow-tip")).toMatch(/animation:\s*none/);
    expect(flow).toMatch(/data-warm=\{warm \|\| undefined\}/);
  });

  it("reads the clock when the pointer enters and when it leaves", () => {
    expect(flow).toMatch(/left\.current = performance\.now\(\)/);
    expect(flow).toMatch(/tipWarm\(performance\.now\(\), left\.current\)/);
  });
});
