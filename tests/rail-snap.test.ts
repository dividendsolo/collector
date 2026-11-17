import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const flat = css.replace(/\s+/g, " ");

const RAIL = /\.rail(?![\w-])/;

const everyRule = () => [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

const railRules = () => everyRule().filter((r) => RAIL.test(r.selector));

const rule = (selector: string) => {
  const at = flat.indexOf(`${selector} {`);
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return flat.slice(at, flat.indexOf("}", at));
};

describe("the sidebar rail snaps (collector#163)", () => {
  it("animates nothing on the rail: no rule that names it carries a transition", () => {
    const animated = railRules().filter((r) => r.body.includes("transition"));
    expect(animated.map((r) => r.selector)).toEqual([]);
    expect(railRules().length).toBeGreaterThan(10);
  });

  it("keeps the end states: the open rail is 200px wide plus the left safe-area inset, with its shadow", () => {
    for (const open of [rule(".rail:has(:focus-visible)"), rule(".rail:hover")]) {
      expect(open).toMatch(/width:\s*calc\(200px \+ env\(safe-area-inset-left, 0px\)\)/);
      expect(open).toMatch(/box-shadow:/);
    }
  });

  it("keeps the labels and the collapsed dots revealing on hover and on Tab", () => {
    expect(rule(".rail:has(:focus-visible) .label, .rail:has(:focus-visible) .tag")).toMatch(/opacity:\s*1/);
    expect(rule(".rail:hover .label, .rail:hover .tag")).toMatch(/opacity:\s*1/);
    expect(rule(".rail:has(:focus-visible) a.item::after")).toMatch(/opacity:\s*0/);
    expect(rule(".rail:hover a.item::after")).toMatch(/opacity:\s*0/);
    expect(rule(".rail a.item:has(.tag.hot)::after")).toMatch(/background:\s*var\(--red\)/);
    expect(rule(".rail a.item:has(.tag.inbox-dot)::after")).toMatch(/background:\s*var\(--blue\)/);
  });
});
