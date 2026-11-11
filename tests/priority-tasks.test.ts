import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * James, 2026-11-11: "I want this section to be called priority tasks instead of needs attention. And I want it
 * to be above everything else at the top." The Dashboard opens with Priority tasks, before Current work.
 */
const source = readFileSync(path.join(__dirname, "..", "components", "dashboard.tsx"), "utf8");
const dashboard = source.slice(source.indexOf("export function Dashboard()"));

describe("Priority tasks on the Dashboard", () => {
  it("is the panel's title, and Needs attention is gone", () => {
    expect(source).toContain('title="Priority tasks"');
    expect(source).not.toContain('title="Needs attention"');
    expect(source).toContain("Nothing in priority tasks.");
  });

  it("is the first panel on the Dashboard, above Current work", () => {
    const panels = [...dashboard.matchAll(/<([A-Z][A-Za-z]+) \/>/g)].map((m) => m[1]);
    expect(panels[0]).toBe("PriorityTasks");
    expect(panels.indexOf("PriorityTasks")).toBeLessThan(panels.indexOf("CurrentWork"));
  });
});

// James, 2026-11-11: "when all the priority tasks are finished, let's show a link to smooth scroll down to waiting for
// you - also we need a hr above the acked tasks in that panel please".
describe("Priority tasks when it is done", () => {
  const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
  it("links to Waiting on you, through the glide every jump link uses", () => {
    const start = source.indexOf('<div className="empty">');
    const empty = source.slice(start, source.indexOf("</div>", start));
    expect(empty).toContain("Nothing in priority tasks.");
    expect(empty).toContain('href={jumpHref("dashboard", "waiting-panel")}');
    expect(empty).toContain("Waiting on you");
  });

  it("draws a line above the acknowledged rows", () => {
    expect(source).toContain('<hr className="acked-rule" />');
    expect(css).toMatch(/\.acked-rule \{[^}]*border-top: 1px solid var\(--line\)/);
    // The row above drops its own border, so the break is one line with a gap, not a double rule.
    expect(css).toMatch(/\.alert:has\(\+ \.acked-rule\) \{\s*border-bottom: 0;/);
  });
});
