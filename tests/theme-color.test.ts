import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { viewport } from "@/app/layout";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

describe("the browser chrome takes the app's dark color (collector#176)", () => {
  it("sets theme-color to the page background", () => {
    expect(viewport?.themeColor).toBe("#131415");
  });

  it("tells the browser the page is dark", () => {
    expect(viewport?.colorScheme).toBe("dark");
  });

  it("keeps the dark --bg token the theme color was taken from", () => {
    expect(css).toMatch(/:root \{[^}]*--hue: 255;[^}]*--bg: oklch\(0\.19 0\.0025 var\(--hue\)\);/);
  });
});
