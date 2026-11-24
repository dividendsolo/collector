import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type AtRule = { selector: string; start: number };
type Rule = { selector: string; body: string; at: AtRule[]; isAt: boolean; start: number };

const rulesOf = (source: string): Rule[] => {
  const found: Rule[] = [];
  const at: AtRule[] = [];
  const open: { selector: string; bodyStart: number; start: number; isAt: boolean }[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      const selector = source.slice(start, i).trim();
      const isAt = selector.startsWith("@");
      open.push({ selector, bodyStart: i + 1, start: i, isAt });
      if (isAt) at.push({ selector, start: i });
      start = i + 1;
    } else if (ch === "}") {
      const top = open.pop();
      if (top?.isAt) at.pop();
      if (top)
        found.push({
          selector: top.selector,
          body: source.slice(top.bodyStart, i),
          at: [...at],
          isAt: top.isAt,
          start: top.start,
        });
      start = i + 1;
    } else if (ch === ";") {
      start = i + 1;
    }
  }
  return found;
};

const rules = rulesOf(css);
const GATE = /^@media\s*\(\s*hover:\s*hover\s*\)\s*and\s*\(\s*pointer:\s*fine\s*\)$/;
const selectorsOf = (rule: Rule) => rule.selector.split(",").map((s) => s.trim());
const gateOf = (rule?: Rule) => rule?.at.find((a) => GATE.test(a.selector));
const rulesFor = (selector: string) => rules.filter((r) => !r.isAt && selectorsOf(r).includes(selector));

const LISTED = [
  "tbody tr:hover td",
  "tr.row:hover td",
  "table.fit tr.row:hover td",
  "table.fit tr.row:hover .chev",
  ".alert:has(.row-link):hover",
  ".alert:has(.row-link):hover .row-link",
  ".tile:hover",
  ".picks label:hover",
  ".net-checks li:hover",
  ".flow-box:hover",
  "a.stat:hover",
  "a.plain:hover",
  ".panel-head .more:hover",
  ".health .sub a:hover",
  ".empty .empty-next:hover",
  ".crumbs a:hover",
  ".briefs-panel a.back:hover",
  ".archived-toggle:hover",
];

describe("a hover state only exists where a pointer can hover", () => {
  it.each(LISTED)("gates %s", (selector) => {
    const found = rulesFor(selector);
    expect(found, `${selector} is one rule`).toHaveLength(1);
    expect(gateOf(found[0]), `${selector} sits inside a capability block`).toBeDefined();
  });

  it("holds the listed hovers in one capability block", () => {
    const blocks = new Set(LISTED.map((selector) => gateOf(rulesFor(selector)[0])?.start));
    expect(blocks.has(undefined), "that block is a capability block").toBe(false);
    expect(blocks.size, "every listed hover is in the same block").toBe(1);
  });

  it("keeps the declarations the hover had", () => {
    expect(rulesFor("tbody tr:hover td")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor("tr.row:hover td")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor("table.fit tr.row:hover td")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor("table.fit tr.row:hover .chev")[0]?.body).toMatch(/opacity:\s*1/);
    expect(rulesFor(".alert:has(.row-link):hover")[0]?.body).toMatch(/background:\s*var\(--panel-2\)/);
    expect(rulesFor(".alert:has(.row-link):hover .row-link")[0]?.body).toMatch(/color:\s*var\(--blue-2\)/);
    expect(rulesFor(".tile:hover")[0]?.body).toMatch(/background:\s*var\(--panel-2\)/);
    expect(rulesFor(".picks label:hover")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor(".net-checks li:hover")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor(".flow-box:hover")[0]?.body).toMatch(/border-color:\s*var\(--flow-tone\)/);
    expect(rulesFor("a.stat:hover")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
    expect(rulesFor("a.plain:hover")[0]?.body).toMatch(/color:\s*var\(--blue-2\)/);
    expect(rulesFor(".panel-head .more:hover")[0]?.body).toMatch(/color:\s*var\(--text\)/);
    expect(rulesFor(".health .sub a:hover")[0]?.body).toMatch(/color:\s*var\(--text\)/);
    expect(rulesFor(".empty .empty-next:hover")[0]?.body).toMatch(/text-decoration:\s*underline/);
    expect(rulesFor(".crumbs a:hover")[0]?.body).toMatch(/color:\s*var\(--text\)/);
    expect(rulesFor(".briefs-panel a.back:hover")[0]?.body).toMatch(/color:\s*var\(--text\)/);
    expect(rulesFor(".archived-toggle:hover")[0]?.body).toMatch(/background:\s*var\(--hover\)/);
  });

  it("leaves the keyboard focus ring outside the block, where every input has it", () => {
    const found = rulesFor(".net-checks li:focus-visible");
    expect(found).toHaveLength(1);
    expect(gateOf(found[0]), ".net-checks li:focus-visible stays ungated").toBeUndefined();
    expect(found[0]?.body).toMatch(/background:\s*var\(--hover\)/);
  });
});
