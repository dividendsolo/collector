import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const layout = readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8");

type Rule = { media: string | null; selector: string; decls: string };

const closeOf = (open: number) => {
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("unclosed block");
};

const collect = (from: number, to: number, media: string | null, into: Rule[]) => {
  let i = from;
  while (i < to) {
    const open = css.indexOf("{", i);
    if (open < 0 || open >= to) return;
    const selector = css.slice(i, open).trim();
    const close = closeOf(open);
    if (selector.startsWith("@")) {
      collect(open + 1, close, selector.startsWith("@media") ? selector : media, into);
    } else {
      into.push({ media, selector, decls: css.slice(open + 1, close) });
    }
    i = close + 1;
  }
};

const rules: Rule[] = [];
collect(0, css.length, null, rules);

const CONTROLS = [".fields input", ".fields select", ".fields textarea"];

const sizeOf = (decls: string) => {
  const shorthand = decls.match(/(?:^|[;{\s])font:\s*([^;]+)/);
  if (shorthand) return shorthand[1].match(/(\d+(?:\.\d+)?)px/)?.[1] ?? null;
  return decls.match(/font-size:\s*(\d+(?:\.\d+)?)px/)?.[1] ?? null;
};

const sizesFor = (control: string) =>
  rules
    .filter((r) => r.selector.split(",").some((s) => s.trim() === control))
    .map((r) => ({ ...r, size: sizeOf(r.decls) }))
    .filter((r) => r.size !== null);

describe("a proposal form field does not zoom the page on a phone", () => {
  for (const control of CONTROLS) {
    it(`gives ${control} 16px under a coarse pointer`, () => {
      const sizes = sizesFor(control);
      expect(sizes.length, `${control} has a font size at all`).toBeGreaterThan(0);
      const winner = sizes[sizes.length - 1];
      expect(winner.size, `${control}'s winning font size`).toBe("16");
      expect(winner.media, `${control}'s 16px sits behind a coarse-pointer query`).toBe("@media (pointer: coarse)");
    });
  }

  it("keeps the 12px design on a fine pointer", () => {
    for (const control of CONTROLS) {
      const fine = sizesFor(control).filter((r) => r.media === null);
      expect(fine[fine.length - 1].size, `${control} on a desktop pointer`).toBe("12");
    }
  });

  it("keeps every control inside its grid cell, whatever its font size", () => {
    for (const control of CONTROLS) {
      const base = rules.filter((r) => r.media === null && r.selector.split(",").some((s) => s.trim() === control));
      const decls = base.map((r) => r.decls).join(";");
      expect(decls, `${control} fills its cell`).toMatch(/(?:^|[;{\s])width:\s*100%/);
      expect(decls, `${control} may shrink below its intrinsic size`).toMatch(/min-width:\s*0(?:px)?\s*(?:;|$)/);
    }
  });

  it("never disables zoom instead", () => {
    expect(layout).not.toMatch(/maximum-scale|user-scalable/);
    expect(css).not.toMatch(/maximum-scale|user-scalable/);
  });
});
