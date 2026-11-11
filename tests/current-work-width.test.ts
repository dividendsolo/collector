import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * collector#99: the Current work table scrolled sideways. The Status column holds the refs a card waits on
 * (its blockers, the cards on deck), and that list was one `white-space: nowrap` line, so the column could
 * not shrink: it took 551 px of the panel and the table grew past it (the `.wrap` scrolled 105 px sideways
 * at 1440 px). The cell is capped now and its content wraps inside the cap.
 *
 * The board data is mocked here (the live context is a React context the page fills from its own reads),
 * so the row under test holds twelve on-deck cards — the case that overflowed.
 */
const live = vi.hoisted(() => ({ data: null as any }));
vi.mock("@/components/data", () => ({ useLive: () => live.data }));

const { CurrentWork } = await import("@/components/running");

const REPO = "acme/app";
const DECK = 12;

/** Twelve cards being worked on, and one scheduled card waiting on all of them: its Status cell lists every
 * ref, which is what made the column too wide. */
const fixture = () => ({
  state: { at: 0, machines: [] },
  board: {
    work: {
      loaded: true,
      closed: [],
      cards: [
        ...Array.from({ length: DECK }, (_, i) => ({
          repo: REPO,
          number: i + 1,
          title: `Card ${i + 1}`,
          url: `https://github.com/${REPO}/issues/${i + 1}`,
          lane: "agent-in-progress",
          priority: "P2",
          created: "2026-11-01",
          labels: [],
        })),
        {
          repo: REPO,
          number: 100,
          title: "Waiting on all of them",
          url: `https://github.com/${REPO}/issues/100`,
          lane: "scheduled",
          priority: "P2",
          created: "2026-11-01",
          labels: [],
          hold: {
            after: Array.from({ length: DECK }, (_, i) => ({
              ref: `#${i + 1}`,
              url: `https://github.com/${REPO}/issues/${i + 1}`,
            })),
            from: null,
            why: null,
          },
        },
      ],
    },
    tickets: { each: [], working: ["agent-in-progress", "verify-in-progress"] },
  },
});

const draw = () => {
  live.data = fixture();
  return renderToStaticMarkup(createElement(CurrentWork));
};

/** The Status cell of the row that waits on the twelve cards: the one carrying the "on deck" pill. */
const onDeckCell = (html: string) => {
  const cells = [...html.matchAll(/<td class="status">([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  return cells.find((c) => c.includes("on deck")) ?? "";
};

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

/** The rule that governs one selector, as the stylesheet writes it. */
const rule = (selector: string) => {
  const at = css.indexOf(selector);
  if (at < 0) return "";
  return css.slice(at, css.indexOf("}", at));
};

describe("the Current work table's Status column (collector#99)", () => {
  it("draws the refs of a card that waits on many cards in one cell", () => {
    const cell = onDeckCell(draw());
    expect(cell).toContain("on deck");
    for (let i = 1; i <= DECK; i++) expect(cell).toContain(`#${i}</a>`);
  });

  it("caps that cell, so its content wraps inside the cap instead of widening the column", () => {
    const r = rule("#current-work td.status");
    expect(r).not.toBe("");
    expect(r).toMatch(/max-width:\s*\d+px/);
    expect(r).toMatch(/white-space:\s*normal/);
  });

  it("breaks lines only between refs, never inside one (review on #100: `darndest#1` / `0,` read as card #1)", () => {
    // No emergency break inside a word: it let the column shrink to 98 px at 425 px wide and split each ref.
    expect(rule("#current-work td.status {")).not.toMatch(/overflow-wrap|word-break/);
    // Each ref is one unbreakable piece; the break opportunity is the space after its comma.
    expect(rule("#current-work td.status .sub a {")).toMatch(/white-space:\s*nowrap/);
    const cell = onDeckCell(draw());
    expect(cell).toMatch(/<\/a><\/span><span>, <a /);
  });

  it("leaves the panel's own scroll in place: the width is fixed, the scroll bar is not hidden", () => {
    expect(rule(".wrap {")).toMatch(/overflow-x:\s*auto/);
  });
});
