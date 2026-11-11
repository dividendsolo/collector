import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriorityRowText } from "@/components/dashboard";

// James, 2026-11-11: "The row for triage cards is not clickable ... make the row clickable regardless". The text is
// the link, and the link's hit area covers the whole row (the row's own class `row-link`).
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

// James, 2026-11-11: the Triage button sits on the one-card row, which is a link from edge to edge; the button must
// take its own click. The rule lifts the row's buttons above the link's cover.
describe("a jump row's buttons", () => {
  it("sit above the row link", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\.alert:has\(\.row-link\) \.act \{\s*position: relative;\s*z-index: 1;/);
  });
});

// A phone: a row with no button (a P0) keeps its age at the right edge, under the other rows' ages (2026-11-11).
describe("a row's age on a phone", () => {
  it("sits at the right edge when the row has no button", async () => {
    const css = (await import("node:fs")).readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(
      /\.alert > :not\(\.act\) \+ \.since \{\s*flex: 1 0 100%;\s*margin-left: 0;\s*text-align: right;/,
    );
  });
});
