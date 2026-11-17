import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const preludes = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/\s+/g, " ")));

const notTapTargets = [".rail:hover", "tbody tr:hover", ".flow-box:hover"];
const pressOwnedByButtonCard = [".btn", ".seg button", ".blur-toggle", ".release-btn"];

const needsPressTwin = (selector: string) =>
  selector.includes(":hover") &&
  !notTapTargets.some((s) => selector.startsWith(s)) &&
  !pressOwnedByButtonCard.some((s) => selector.startsWith(s));

describe("a tap shows the app's own feedback, not the browser's highlight box", () => {
  it("turns off the browser's tap highlight on the html rule", () => {
    const html = preludes.findIndex((list) => list.length === 1 && list[0] === "html");
    expect(html, "an html { ... } rule must exist").toBeGreaterThanOrEqual(0);
    const body = css.match(/(^|[}\s])html\s*\{([^}]*)\}/);
    expect(body?.[2]).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });

  it("gives every tappable link and row a press state beside its hover state", () => {
    const missing = preludes.flatMap((list) =>
      list.filter(needsPressTwin).filter((s) => !list.includes(s.replace(":hover", ":active"))),
    );
    expect(missing).toEqual([]);
  });
});
