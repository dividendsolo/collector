import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Each page says its name once, in the top bar (James, 2026-11-10: "I don't want to see four or five briefs in a
 * row"). No page title under the top bar, no panel title on a page with one panel, and no column headed with the
 * page's own name.
 */
const dir = path.join(process.cwd(), "components");
const src = (f: string) => readFileSync(path.join(dir, f), "utf8");
const pages = readdirSync(dir).filter((f) => f.endsWith(".tsx") && f !== "markdown.tsx");

describe("one name per page", () => {
  it("draws no page title (h1) under the top bar on any page", () => {
    const withH1 = pages.filter((f) => /<h1[\s>]/.test(src(f)));
    expect(withH1).toEqual([]);
  });

  it("gives a page with one panel no panel title", () => {
    expect(src("pages.tsx")).not.toMatch(/title="Domains"/);
    expect(src("pages.tsx")).not.toMatch(/title="Proposals"/);
    expect(src("cron.tsx")).not.toMatch(/title="Cron jobs"/);
    expect(src("projects.tsx")).not.toMatch(/title="Projects"/);
    const servicesPage = src("services.tsx").slice(src("services.tsx").indexOf("export function ServicesPage"));
    expect(servicesPage).not.toMatch(/title="Service health"/);
  });

  it("never heads a column with the page's own name", () => {
    expect(src("pages.tsx")).not.toMatch(/<th>Domain<\/th>/);
    expect(src("projects.tsx")).not.toMatch(/<th>Project<\/th>/);
    expect(src("cron.tsx")).not.toMatch(/<th>Job<\/th>/);
  });
});
