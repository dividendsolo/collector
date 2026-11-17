import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8").replace(/\s+/g, " ");

const rule = (selector: string, from = 0) => {
  const found = [`} ${selector} {`, `{ ${selector} {`].map((s) => css.indexOf(s, from)).filter((i) => i > -1);
  const at = found.length ? Math.min(...found) : -1;
  expect(at, `${selector} has a rule`).toBeGreaterThan(-1);
  return css.slice(at + 2, css.indexOf("}", at + 2));
};

const pressed = [
  ".btn:active:not(:disabled)",
  ".seg button:active",
  ".blur-toggle:active",
  ".release-btn:active:not(:disabled)",
].join(", ");

describe("a button answers the press", () => {
  it("defines the one ease-out curve", () => {
    expect(css).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1);");
  });

  it.each([".btn", ".seg button", ".blur-toggle", ".release-btn"])("%s eases its transform", (selector) => {
    expect(rule(selector)).toContain("transition: transform 160ms var(--ease-out);");
  });

  it("scales every pressable down a little and shows the press on touch", () => {
    const r = rule(pressed);
    expect(r).toContain("transform: scale(0.97);");
    expect(r).toContain("background: var(--hover);");
  });

  it("keeps a gentler press under reduced motion", () => {
    const media = css.indexOf("@media (prefers-reduced-motion: reduce) { .btn:active");
    expect(media, "a reduced-motion press rule").toBeGreaterThan(-1);
    expect(rule(pressed, media)).toContain("transform: scale(0.99);");
  });
});
