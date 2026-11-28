import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const swr = vi.hoisted(() => ({ data: { at: 0, inbox: [], archived: [] } as unknown }));
vi.mock("swr", () => ({ default: () => ({ data: swr.data }), mutate: vi.fn() }));

const { NAV } = await import("@/components/app");
const { BriefsPage } = await import("@/components/briefs");

describe("the icon-only rail", () => {
  it("gives every page its own icon, so Briefs, Inbox and Proposals read apart", () => {
    const icons = NAV.map((n) => n.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("heads the Briefs page with the Briefs link's own icon", () => {
    const briefs = NAV.find((n) => n.page === "briefs")?.icon;
    expect(renderToStaticMarkup(createElement(BriefsPage))).toContain(`href="#i-${briefs}"`);
  });
});
