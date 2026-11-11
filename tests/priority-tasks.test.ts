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
