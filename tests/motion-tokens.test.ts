import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = css.match(new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{[^}]*\\}`));
  expect(found, `${selector} must exist in app/globals.css`).not.toBeNull();
  return found?.[0] ?? "";
}

describe("motion tokens", () => {
  it("defines the strong curves and one duration per role in :root", () => {
    const root = rule(":root");
    expect(root).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1);");
    expect(root).toContain("--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);");
    expect(root).toMatch(/--duration-hover:\s*[\d.]+m?s;/);
    expect(root).toMatch(/--duration-enter:\s*[\d.]+m?s;/);
  });

  it("gives every entrance the strong ease-out curve, not a built-in one", () => {
    expect(rule("body.fade-out")).toContain("opacity 0.15s var(--ease-out)");
    expect(rule("body.fade-in")).toContain("page-in 0.25s var(--ease-out)");
    const toast = rule(".toast");
    expect(toast).toContain("opacity var(--duration-enter) var(--ease-out)");
    expect(toast).toContain("transform var(--duration-enter) var(--ease-out)");
  });

  it("keeps ease on hover and colour changes, with the shared hover duration", () => {
    expect(rule(".money")).toContain("filter var(--duration-hover) ease");
    const box = rule(".flow-box");
    expect(box).toContain("opacity var(--duration-hover) ease");
    expect(box).toContain("border-color var(--duration-hover) ease");
    expect(rule(".flow-edge .flow-line")).toContain("opacity var(--duration-hover) ease");
    expect(rule("table.fit .chev")).toContain("opacity var(--duration-hover) ease");
  });

  it("leaves no built-in ease-out on a transition or a one-shot entrance", () => {
    const builtIn = css.match(/\b(transition|animation):[^;]*\s(ease-out|ease-in)\s*;/g) ?? [];
    expect(builtIn.filter((line) => !line.includes("jump-flash"))).toEqual([]);
  });
});
