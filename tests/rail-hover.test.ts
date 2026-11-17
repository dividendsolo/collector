import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const GATE = "@media (hover: hover) and (pointer: fine) {";

const splitGate = () => {
  const at = css.indexOf(GATE);
  if (at === -1) return { body: "", rest: css };
  let depth = 0;
  for (let i = at + GATE.length - 1; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return { body: css.slice(at + GATE.length, i), rest: css.slice(0, at) + css.slice(i + 1) };
    }
  }
  return { body: css.slice(at), rest: css.slice(0, at) };
};

const gated = splitGate();

describe("the rail opens for a mouse and for the keyboard, never for a tap", () => {
  it("keeps every hover style inside the pointer gate", () => {
    expect(gated.body).toContain(".rail:hover {");
    expect(gated.body).toContain(".rail:hover .label");
    expect(gated.body).toContain(".rail:hover .tag");
    expect(gated.body).toContain(".rail:hover a.item::after");
    expect(gated.body).toContain(".rail a.item:hover {");
    expect(gated.body).toContain(".rail a.item:hover svg.i");
  });

  it("leaves no hover style outside the gate", () => {
    expect(gated.rest).not.toContain(".rail:hover");
    expect(gated.rest).not.toContain(".rail a.item:hover");
  });

  it("opens the rail on the keyboard's own focus", () => {
    expect(gated.rest).toMatch(/\.rail:has\(:focus-visible\)\s*\{[^}]*width:\s*200px/);
    expect(gated.rest).toMatch(/\.rail:has\(:focus-visible\)\s+\.label/);
    expect(gated.rest).toMatch(/\.rail:has\(:focus-visible\)\s+a\.item::after/);
  });

  it("never opens the rail on focus-within, which a tap also matches", () => {
    expect(css).not.toContain(":focus-within");
  });
});
