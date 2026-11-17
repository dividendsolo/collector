import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rulesFor = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) =>
      head
        .split(",")
        .map((s) => s.trim())
        .includes(selector),
    )
    .map(([, , body]) => body);

const controls = ["button", ".btn", '[role="button"]', ".seg button", ".chip"];

describe("a long-press on a control does not select its label", () => {
  it.each(controls)("%s is not selectable and opens no callout", (selector) => {
    const body = rulesFor(selector).join("\n");
    expect(body).toMatch(/(^|[^-])user-select:\s*none/);
    expect(body).toMatch(/-webkit-user-select:\s*none/);
    expect(body).toMatch(/-webkit-touch-callout:\s*none/);
  });

  it.each(["body", ".pill"])("%s stays selectable", (selector) => {
    expect(rulesFor(selector).join("\n")).not.toMatch(/user-select:\s*none/);
  });
});
