import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const picker = readFileSync(path.join(process.cwd(), "components", "projects.tsx"), "utf8");

describe("the repo search box on a phone", () => {
  it("is 16px on a touch screen, so iOS does not zoom the page on focus", () => {
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.search \{\s*font-size: 16px;\s*\}\s*\}/);
  });

  it("labels the return key as search", () => {
    expect(picker).toMatch(/className="search"[\s\S]*?enterKeyHint="search"[\s\S]*?\/>/);
  });
});
