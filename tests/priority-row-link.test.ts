import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriorityRowText } from "@/components/dashboard";

describe("a jump row", () => {
  it("is one link that covers the whole row", () => {
    const html = renderToStaticMarkup(
      createElement(PriorityRowText, {
        x: { text: "2 cards need triage", jump: "waiting-panel", filter: "needs-triage" },
      }),
    );
    expect(html).toContain('class="plain row-link"');
    expect(html).toContain('href="#/dashboard?to=waiting-panel&amp;lane=needs-triage"');
  });
});

describe("a jump row's buttons", () => {
  it("sit above the row link", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.alert:has\(\.row-link\) \.act \{\s*position: relative;\s*z-index: 1;/);
  });
});

describe("a row's age on a phone", () => {
  it("sits at the right edge when the row has no button", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(
      /\.alert > :not\(\.act\) \+ \.since \{\s*flex: 1 0 100%;\s*margin-left: 0;\s*text-align: right;/,
    );
  });
});

describe("a row's copy column", () => {
  it("has a fixed reading width", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(
      /\.alert > span:not\(\.n\):not\(\.aside\):not\(\.act\):not\(\.since\),\s*\.alert > a \{\s*flex: 0 1 72ch;\s*max-width: 72ch;/,
    );
  });
});
