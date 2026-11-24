import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/data", () => ({
  useLive: () => ({
    state: { at: 0, machines: [] },
    board: { work: { loaded: true, closed: [], cards: [] }, tickets: { each: [], working: [] } },
  }),
}));

const { CurrentWork } = await import("@/components/running");
const { BriefRow } = await import("@/components/briefs");

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const source = (file: string) => readFileSync(path.join(process.cwd(), "components", file), "utf8");

const PHONE = "@media (max-width: 700px) {";
const phoneBlocks = () => {
  const out: string[] = [];
  for (let at = css.indexOf(PHONE); at !== -1; at = css.indexOf(PHONE, at + 1)) {
    let depth = 0;
    for (let i = at + PHONE.length - 1; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}" && --depth === 0) {
        out.push(css.slice(at, i));
        break;
      }
    }
  }
  return out.join("\n");
};

const phone = phoneBlocks();

const ruleIn = (text: string, selector: string) => {
  const at = text.indexOf(`${selector} {`);
  return at < 0 ? "" : text.slice(at, text.indexOf("}", at));
};

describe("Collector at phone width (collector#217)", () => {
  it("stacks each row of a stack table under 700px: no header row, one wrapping line, the long text on its own line", () => {
    expect(ruleIn(phone, "table.stack thead")).toMatch(/display:\s*none/);
    expect(ruleIn(phone, "table.stack tbody tr")).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleIn(phone, "table.stack td.line")).toMatch(/flex-basis:\s*100%/);
    expect(ruleIn(phone, "table.stack td.phone-off")).toMatch(/display:\s*none/);
  });

  it("lets a panel head wrap, so its buttons drop to a second line instead of past the screen's edge", () => {
    expect(ruleIn(css, ".panel-head")).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleIn(phone, ".panel-head .seg")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("marks Current work, Waiting on you, the open and closed cards and the Briefs inbox as stack tables", () => {
    const html = renderToStaticMarkup(createElement(CurrentWork));
    expect(html).toContain('<table class="stack">');
    expect(source("dashboard.tsx")).toContain('<table className="stack">');
    expect(source("pages.tsx").match(/<table className="stack">/g)).toHaveLength(2);
    expect(source("briefs.tsx")).toContain('<table className="briefs stack">');
    const row = renderToStaticMarkup(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          createElement(BriefRow, {
            b: {
              machine: "m",
              file: "f.md",
              brief: "B",
              subject: "S",
              sent_at: "2026-11-20T16:55:45Z",
              read: false,
            } as any,
          }),
        ),
      ),
    );
    expect(row).toContain('<td class="mono end">');
  });
});
