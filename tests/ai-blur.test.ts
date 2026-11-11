import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiPlan } from "@/components/ai";

// James, 2026-11-11: "looks like the blur toggle doesn't do anything anymore". The eye blurs `.money`; since the
// Nous top-up became a usage bar (b1bb5aa), its "$0.00 of $25 left" printed as plain text, so nothing blurred.
describe("AI usage blur", () => {
  it("blurs the dollar amounts in a window's left text", () => {
    const html = renderToStaticMarkup(
      createElement(AiPlan, {
        a: {
          provider: "nous",
          profiles: 1,
          windows: [{ label: "Top-up ($25)", used: 100, left: "$0.00 of $25 left" }],
        },
      }),
    );
    expect(html).toContain('<span class="money">$0.00</span>');
    expect(html).toContain('<span class="money">$25</span>');
    expect(html).toContain('Top-up (<span class="money">$25</span>)');
  });

  it("blurs the dollar amounts in a provider's note", () => {
    const html = renderToStaticMarkup(createElement(AiPlan, { a: { provider: "x", profiles: 1, note: "$3.10 left" } }));
    expect(html).toContain('<span class="money">$3.10</span>');
  });
});
