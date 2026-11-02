import { describe, expect, it } from "vitest";
import {
  edgeDimmed,
  FLOW_BOUNDS,
  FLOW_EDGES,
  FLOW_LABEL_PX,
  FLOW_NODE_H,
  FLOW_NODE_W,
  FLOW_PULSE_SECONDS,
  FLOW_PULSES,
  FLOW_ROW,
  FLOW_START,
  FLOW_STATUSES,
  isMainEdge,
  MAIN_EDGES,
  MAIN_PATH,
  narrowViewport,
  neighbours,
  nodeDimmed,
  pulseBegins,
  tipAbove,
  tipAlign,
} from "@/lib/flow";

/** The drawing this page replaces: every status its Graphviz source carried, with the colour it gave the box
 * (#8bd17c green, #f2b84b amber, #6cb6ff blue, #d0d4dc grey) and the label's line breaks. */
const DRAWING: { id: string; lines: string[]; tone: string }[] = [
  { id: "needs-triage", lines: ["needs-", "triage"], tone: "wait" },
  { id: "closed-intake", lines: ["closed"], tone: "park" },
  { id: "blocked", lines: ["blocked"], tone: "park" },
  { id: "ready-for-human", lines: ["ready-for-", "human"], tone: "go" },
  { id: "ready-for-agent", lines: ["ready-for-", "agent"], tone: "go" },
  { id: "scheduled", lines: ["scheduled"], tone: "park" },
  { id: "agent-in-progress", lines: ["agent-in-", "progress"], tone: "work" },
  { id: "needs-info", lines: ["needs-", "info"], tone: "wait" },
  { id: "verify-in-progress", lines: ["verify-in-", "progress"], tone: "work" },
  { id: "code-review", lines: ["code-", "review"], tone: "work" },
  { id: "needs-manual-qa", lines: ["needs-", "manual-qa"], tone: "wait" },
  { id: "ready-to-merge", lines: ["ready-to-", "merge"], tone: "work" },
  { id: "changes-requested", lines: ["changes-", "requested"], tone: "wait" },
  { id: "merging", lines: ["merging"], tone: "work" },
  { id: "closed", lines: ["closed"], tone: "park" },
];

/** The same source's solid arrows, which are the paths a card moves along. The dashed lines to the note boxes are
 * not paths, so they are not here. */
const DRAWING_PATHS = [
  "start->needs-triage",
  "needs-triage->ready-for-human",
  "needs-triage->ready-for-agent",
  "needs-triage->scheduled",
  "needs-triage->blocked",
  "needs-triage->closed-intake",
  "ready-for-agent->agent-in-progress",
  "agent-in-progress->needs-info",
  "agent-in-progress->verify-in-progress",
  "verify-in-progress->code-review",
  "code-review->needs-manual-qa",
  "code-review->ready-to-merge",
  "code-review->changes-requested",
  "ready-to-merge->merging",
  "merging->closed",
];

describe("the statuses", () => {
  it("are the ones the drawing carried, with its colours and line breaks", () => {
    expect(FLOW_STATUSES.map((s) => ({ id: s.id, lines: [...s.lines], tone: s.tone }))).toEqual(DRAWING);
  });

  it("every one of them says what it means", () => {
    for (const s of FLOW_STATUSES) expect(s.tip.length, s.id).toBeGreaterThan(20);
    const tip = (id: string) => FLOW_STATUSES.find((s) => s.id === id)?.tip;
    // The six note boxes the drawing showed beside a status, kept word for word.
    expect(tip("blocked")).toBe("Waits on another card. GitHub issue link: Blocked by (issue dependencies)");
    expect(tip("ready-for-human")).toBe("Requires a human in the loop (HITL)");
    expect(tip("ready-for-agent")).toBe("Goes into the agent queue");
    expect(tip("scheduled")).toBe("Waits for a date only (for example, a launch date)");
    expect(tip("agent-in-progress")).toBe(
      "A droid the foreman assigned, or an interactive session with the user (label: local)",
    );
    expect(tip("needs-info")).toBe(
      "The builder could not finish without more information from the user. A triage miss: triage should have got that information. Keep it rare.",
    );
  });

  it("is one row per level, needs-triage alone at the top and its five options side by side under it", () => {
    const y = (id: string) => FLOW_STATUSES.find((s) => s.id === id)?.y;
    const x = (id: string) => FLOW_STATUSES.find((s) => s.id === id)?.x;
    expect(x("needs-triage")).toBe(0);
    expect(FLOW_STATUSES.every((s) => s.y > FLOW_START.y)).toBe(true);
    expect(y("needs-triage")).toBe(FLOW_ROW);
    // One y per level: nothing shares a row with a status a level away.
    const levels = [...new Set(FLOW_STATUSES.map((s) => s.y))];
    expect(levels.length).toBe(8);
    const onRow = (row: number) =>
      FLOW_STATUSES.filter((s) => s.y === row)
        .sort((a, b) => a.x - b.x)
        .map((s) => s.id);
    expect(onRow(FLOW_ROW * 2)).toEqual([
      "closed-intake",
      "blocked",
      "ready-for-human",
      "ready-for-agent",
      "scheduled",
    ]);
    expect(onRow(FLOW_ROW * 4)).toEqual(["needs-info", "verify-in-progress"]);
    expect(onRow(FLOW_ROW * 6)).toEqual(["needs-manual-qa", "ready-to-merge", "changes-requested"]);
    // Side by side means side by side: no two boxes on a row overlap, and the row is centred on the one above.
    for (const row of levels) {
      const boxes = FLOW_STATUSES.filter((s) => s.y === row).sort((a, b) => a.x - b.x);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].x - boxes[i - 1].x).toBeGreaterThanOrEqual(200);
      const mid = (boxes[0].x + boxes[boxes.length - 1].x) / 2;
      expect(mid).toBe(0);
    }
  });
});

describe("the paths", () => {
  it("are the drawing's arrows, and nothing else", () => {
    expect(FLOW_EDGES.map((e) => e.id)).toEqual(DRAWING_PATHS);
  });

  it("only joins statuses that are on the drawing", () => {
    const ids = new Set([...FLOW_STATUSES.map((s) => s.id), FLOW_START.id]);
    for (const e of FLOW_EDGES) {
      expect(ids.has(e.from), e.id).toBe(true);
      expect(ids.has(e.to), e.id).toBe(true);
      expect(e.id).toBe(`${e.from}->${e.to}`);
    }
  });

  it("moves a card down the drawing, never up it", () => {
    const y = (id: string) =>
      id === FLOW_START.id ? FLOW_START.y : (FLOW_STATUSES.find((s) => s.id === id)?.y as number);
    for (const e of FLOW_EDGES) expect(y(e.to), e.id).toBeGreaterThan(y(e.from));
  });

  it("carries the main path brightest, from needs-triage to closed (James, 2026-11-02)", () => {
    // The card's own list, in order, is on the path: the extra step is `merging`, which is how a card gets closed.
    const listed = ["needs-triage", "ready-for-agent", "agent-in-progress", "code-review", "ready-to-merge", "closed"];
    let at = -1;
    for (const id of listed) {
      const next = MAIN_PATH.indexOf(id, at + 1);
      expect(next, id).toBeGreaterThan(at);
      at = next;
    }
    expect(MAIN_PATH.at(0)).toBe("needs-triage");
    expect(MAIN_PATH.at(-1)).toBe("closed");
    expect(MAIN_PATH).toEqual([
      "needs-triage",
      "ready-for-agent",
      "agent-in-progress",
      "verify-in-progress",
      "code-review",
      "ready-to-merge",
      "merging",
      "closed",
    ]);
    expect(MAIN_EDGES.map((e) => e.id)).toEqual([
      "needs-triage->ready-for-agent",
      "ready-for-agent->agent-in-progress",
      "agent-in-progress->verify-in-progress",
      "verify-in-progress->code-review",
      "code-review->ready-to-merge",
      "ready-to-merge->merging",
      "merging->closed",
    ]);
    for (const e of FLOW_EDGES) expect(isMainEdge(e), e.id).toBe(MAIN_EDGES.some((m) => m.id === e.id));
  });

  it("is a route a card can actually take: every step of the main path is an arrow on the drawing", () => {
    // The drawing has no agent-in-progress -> code-review arrow (a card goes through verify-in-progress), so the
    // bright path has to carry that step itself or it would be brightest along a gap.
    for (const m of MAIN_EDGES)
      expect(
        FLOW_EDGES.some((e) => e.id === m.id),
        m.id,
      ).toBe(true);
    for (const step of MAIN_PATH.slice(0, -1)) {
      expect(
        FLOW_EDGES.some((e) => e.from === step),
        step,
      ).toBe(true);
    }
  });
});

describe("hovering a status", () => {
  it("leaves every path plain with nothing hovered", () => {
    for (const e of FLOW_EDGES) {
      expect(edgeDimmed(e, null)).toBe(false);
      expect(nodeDimmed(e.from, null)).toBe(false);
    }
  });

  it("brightens the paths in and out of it and dims the rest", () => {
    const hovered = "code-review";
    const lit = FLOW_EDGES.filter((e) => !edgeDimmed(e, hovered)).map((e) => e.id);
    expect(lit).toEqual([
      "verify-in-progress->code-review",
      "code-review->needs-manual-qa",
      "code-review->ready-to-merge",
      "code-review->changes-requested",
    ]);
    // Its own box and the boxes it moves between stay lit; the far ones fade.
    expect(nodeDimmed("code-review", hovered)).toBe(false);
    expect(nodeDimmed("verify-in-progress", hovered)).toBe(false);
    expect(nodeDimmed("ready-to-merge", hovered)).toBe(false);
    expect(nodeDimmed("scheduled", hovered)).toBe(true);
    expect(nodeDimmed("merging", hovered)).toBe(true);
    expect(nodeDimmed("needs-triage", hovered)).toBe(true);
  });

  it("knows who a status can move to and come from", () => {
    expect(neighbours("agent-in-progress").sort()).toEqual(["needs-info", "ready-for-agent", "verify-in-progress"]);
    expect(neighbours("closed")).toEqual(["merging"]);
    expect(neighbours(null)).toEqual([]);
  });
});

describe("the light pulses", () => {
  it("spread along the path so one is always in flight", () => {
    const begins = pulseBegins();
    expect(begins).toHaveLength(FLOW_PULSES);
    expect(begins[0]).toBe(0);
    for (const b of begins) expect(b).toBeLessThanOrEqual(0);
    const gaps = begins.slice(1).map((b, i) => begins[i] - b);
    for (const g of gaps) expect(g).toBeCloseTo(FLOW_PULSE_SECONDS / FLOW_PULSES, 6);
    // A second pulse a path of its own: the count and the length are what the page draws with.
    expect(pulseBegins(1, 2)).toEqual([0]);
    expect(pulseBegins(2, 4)).toEqual([0, -2]);
  });

  it("opens the tooltip below a box, and above it in the bottom rows where the canvas would clip it", () => {
    expect(tipAbove(FLOW_ROW)).toBe(false);
    expect(tipAbove(FLOW_ROW * 6)).toBe(false);
    expect(tipAbove(FLOW_ROW * 7)).toBe(true);
    expect(tipAbove(FLOW_ROW * 8)).toBe(true);
  });
});

describe("the drawing on a phone (425 wide)", () => {
  it("bounds every box, the start dot included", () => {
    for (const s of FLOW_STATUSES) {
      expect(s.x - FLOW_NODE_W / 2, s.id).toBeGreaterThanOrEqual(FLOW_BOUNDS.x);
      expect(s.x + FLOW_NODE_W / 2, s.id).toBeLessThanOrEqual(FLOW_BOUNDS.x + FLOW_BOUNDS.width);
      expect(s.y + FLOW_NODE_H, s.id).toBeLessThanOrEqual(FLOW_BOUNDS.y + FLOW_BOUNDS.height);
    }
    expect(FLOW_BOUNDS.y).toBeLessThanOrEqual(FLOW_START.y);
  });

  it("draws the labels at 9px or more on screen, never fitted down to the width", () => {
    const v = narrowViewport();
    expect(FLOW_LABEL_PX * v.zoom).toBeGreaterThanOrEqual(9);
    // The canvas is as big as the drawing at that zoom, so the whole flow is in it and the page scrolls to it.
    expect(v.x + FLOW_BOUNDS.x * v.zoom).toBeGreaterThanOrEqual(0);
    expect(v.x + (FLOW_BOUNDS.x + FLOW_BOUNDS.width) * v.zoom).toBeLessThanOrEqual(v.width);
    expect(v.y + FLOW_BOUNDS.y * v.zoom).toBeGreaterThanOrEqual(0);
    expect(v.y + (FLOW_BOUNDS.y + FLOW_BOUNDS.height) * v.zoom).toBeLessThanOrEqual(v.height);
    // and wider than the phone, which is what the sideways scroll is for.
    expect(v.width).toBeGreaterThan(425);
  });

  it("opens a tooltip toward the middle of the drawing, so the edge boxes keep theirs inside the canvas", () => {
    const xs = FLOW_STATUSES.map((s) => s.x);
    expect(tipAlign(Math.min(...xs))).toBe("start");
    expect(tipAlign(Math.max(...xs))).toBe("end");
    expect(tipAlign(0)).toBe("center");
  });
});
