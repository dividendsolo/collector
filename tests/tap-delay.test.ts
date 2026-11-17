import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(", "),
  body: body.replace(/\s+/g, " ").trim(),
}));

const declares = (selector: string, declaration: string) =>
  rules.some((r) => r.selectors.includes(selector) && r.body.includes(declaration));

const componentFiles = readdirSync(path.join(process.cwd(), "components")).filter((f) => f.endsWith(".tsx"));

const openingTag = (src: string, at: number) => {
  let depth = 0;
  for (let i = at + 3; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    else if (src[i] === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return src.slice(at);
};

const clickableRows = componentFiles.flatMap((file) => {
  const src = readFileSync(path.join(process.cwd(), "components", file), "utf8");
  return [...src.matchAll(/<tr\b/g)]
    .map((m) => openingTag(src, m.index))
    .filter((tag) => tag.includes("onClick"))
    .map((tag) => ({ file, tag }));
});

describe("a tap fires at once, without waiting out the double-tap zoom check (collector#172)", () => {
  it("turns the check off on a button, a link, a role=button and a clickable row", () => {
    for (const selector of ["button", "a", '[role="button"]', "tr.row"]) {
      expect(declares(selector, "touch-action: manipulation"), `${selector} carries touch-action`).toBe(true);
    }
  });

  it("keeps the class the selector names on every row that navigates on click", () => {
    expect(clickableRows.length).toBeGreaterThan(0);
    for (const { file, tag } of clickableRows) {
      expect(tag, `${file}: a clickable row keeps the row class`).toMatch(/className=\{?["`]row(?![-\w])/);
    }
  });
});
