import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

const narrowBlocks = () =>
  [...css.matchAll(/@media \(max-width: (\d+)px\) \{([\s\S]*?)\n {2}\}/g)]
    .filter((m) => Number(m[1]) >= 425)
    .map((m) => m[2]);

describe("the Inbox on a phone (425 wide)", () => {
  const block = narrowBlocks().find((b) => b.includes("table.inbox")) ?? "";

  it("stacks each row instead of a table wider than the screen", () => {
    expect(block).toMatch(/table\.inbox thead \{\s*display: none;/);
    expect(block).toMatch(/table\.inbox tr \{[^}]*display: grid;/);
  });

  it("puts the time and the Handled button on one line under the message", () => {
    expect(block).toMatch(/table\.inbox td\.wide \{[^}]*min-width: 0;/);
    expect(block).toMatch(/table\.inbox tr\.row td\.mono \{[^}]*grid-column: 1;/);
    expect(block).toMatch(/table\.inbox tr\.row td\.actions \{[^}]*grid-column: 2;/);
  });
});
