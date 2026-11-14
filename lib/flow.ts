/**
 * The card flow as data (collector#51): every status a card can have, the statuses it can move to, and where each
 * one sits. The page draws it with a flow library (`components/flow.tsx`); the drawing, the hover tooltips and the
 * light pulses all read this file, so the diagram is one list of statuses and one list of paths, and the test can
 * hold both to the agent stack's own flow.
 *
 * The statuses and the paths are the ones the Graphviz drawing carried (commit 3021658, agent-stack's
 * `docs/card-flow.html`); the six note boxes that drawing showed beside the statuses are each status's `tip` now.
 */

/** The three colours of a status box, as the page's own tokens: green for a card ready to move, amber for one that
 * waits, blue for one a machine or a session holds, grey for one parked (a date, another card, or done). */
export type FlowTone = "go" | "wait" | "work" | "park";

export interface FlowStatus {
  /** The lane slug, which is the node's id. */
  id: string;
  /** The label, on one line or two, exactly as the drawing broke it. */
  lines: [string] | [string, string];
  tone: FlowTone;
  /** What the box means: the note box the drawing showed beside it, or the same kind of line for a status that
   * never had one. Shown on hover. */
  tip: string;
  x: number;
  y: number;
}

export interface FlowEdge {
  /** `<from>-><to>`, which is the SVG edge's id and what the page dims on hover. */
  id: string;
  from: string;
  to: string;
}

/** One column and one row of the drawing, in pixels. A box is 168x54, so a row of five spans 968px. */
export const FLOW_COL = 200;
export const FLOW_ROW = 132;

/** The black dot the drawing starts from: a card lands on the board here. It is not a status, so it is not in
 * `FLOW_STATUSES`, and a card never waits in it. */
export const FLOW_START = { id: "start", x: 0, y: 0 };

/** The statuses, in the drawing's own rows: the five a triage can send a card to are side by side under
 * needs-triage, and each row below holds what the row above can move to. */
export const FLOW_STATUSES: FlowStatus[] = [
  {
    id: "needs-triage",
    lines: ["needs-", "triage"],
    tone: "wait",
    tip: "A card lands here first: a triage session sets its status, so this is the one status a card waits on a session rather than on you.",
    x: 0,
    y: FLOW_ROW,
  },
  ...spread(FLOW_ROW * 2, [
    {
      id: "closed-intake",
      lines: ["closed"],
      tone: "park",
      tip: "Closed without work: a duplicate, a no, or work another card already did.",
    },
    {
      id: "blocked",
      lines: ["blocked"],
      tone: "park",
      tip: "Waits on another card. GitHub issue link: Blocked by (issue dependencies)",
    },
    {
      id: "ready-for-human",
      lines: ["ready-for-", "human"],
      tone: "go",
      tip: "Requires a human in the loop (HITL)",
    },
    {
      id: "ready-for-agent",
      lines: ["ready-for-", "agent"],
      tone: "go",
      tip: "Goes into the agent queue",
    },
    {
      id: "scheduled",
      lines: ["scheduled"],
      tone: "park",
      tip: "Waits for a date only (for example, a launch date)",
    },
  ]),
  {
    id: "agent-in-progress",
    lines: ["agent-in-", "progress"],
    tone: "work",
    tip: "A droid the foreman assigned, or an interactive session with the user (label: local)",
    x: 0,
    y: FLOW_ROW * 3,
  },
  ...spread(FLOW_ROW * 4, [
    {
      id: "needs-info",
      lines: ["needs-", "info"],
      tone: "wait",
      tip: "The builder could not finish without more information from the user. A triage miss: triage should have got that information. Keep it rare.",
    },
    {
      id: "verify-in-progress",
      lines: ["verify-in-", "progress"],
      tone: "work",
      tip: "The foreman's gate runs the repo's checks on the committed work; a failure goes back to the builder.",
    },
  ]),
  {
    id: "code-review",
    lines: ["code-", "review"],
    tone: "work",
    tip: "A reviewer reads the diff against the card's brief before it can merge.",
    x: 0,
    y: FLOW_ROW * 5,
  },
  ...spread(FLOW_ROW * 6, [
    {
      id: "needs-manual-qa",
      lines: ["needs-", "manual-qa"],
      tone: "wait",
      tip: "Waits on the user's own look at the finished work, on the surface the card's brief names.",
    },
    {
      id: "ready-to-merge",
      lines: ["ready-to-", "merge"],
      tone: "work",
      tip: "The gate passed: the foreman pushes, opens the PR, and merges it.",
    },
    {
      id: "changes-requested",
      lines: ["changes-", "requested"],
      tone: "wait",
      tip: "The reviewer wanted changes, so the card goes back to a builder.",
    },
  ]),
  {
    id: "merging",
    lines: ["merging"],
    tone: "work",
    tip: "The PR merges; CI runs the whole suite on the default branch just after.",
    x: 0,
    y: FLOW_ROW * 7,
  },
  {
    id: "closed",
    lines: ["closed"],
    tone: "park",
    tip: "Done: not open work on the Work page, and not a wait.",
    x: 0,
    y: FLOW_ROW * 8,
  },
];

/** A row of the drawing: the statuses side by side, centred on the column above them. */
function spread<T extends { id: string; lines: [string] | [string, string]; tone: FlowTone; tip: string }>(
  y: number,
  boxes: T[],
): FlowStatus[] {
  return boxes.map((b, i) => ({ ...b, x: (i - (boxes.length - 1) / 2) * FLOW_COL, y }));
}

/** Every path a card moves along, in the drawing's own order. The dashed lines to the old note boxes are gone:
 * a note is its status's tooltip now. */
export const FLOW_EDGES: FlowEdge[] = [
  path("start", "needs-triage"),
  path("needs-triage", "ready-for-human"),
  path("needs-triage", "ready-for-agent"),
  path("needs-triage", "scheduled"),
  path("needs-triage", "blocked"),
  path("needs-triage", "closed-intake"),
  path("ready-for-agent", "agent-in-progress"),
  path("agent-in-progress", "needs-info"),
  path("agent-in-progress", "verify-in-progress"),
  path("verify-in-progress", "code-review"),
  path("code-review", "needs-manual-qa"),
  path("code-review", "ready-to-merge"),
  path("code-review", "changes-requested"),
  path("ready-to-merge", "merging"),
  path("merging", "closed"),
];

function path(from: string, to: string): FlowEdge {
  return { id: `${from}->${to}`, from, to };
}

/** The statuses a card moves through on its way, in order (James, 2026-11-02): needs-triage -> ready-for-agent ->
 * agent-in-progress -> code-review -> ready-to-merge -> closed. `verify-in-progress` and `merging` are the steps
 * that get a card to `code-review` and to `closed`, so they are on the path too: the main path is a route a card
 * can actually take, and every arrow of it is on the drawing. Its edges pulse brightest. */
export const MAIN_PATH = [
  "needs-triage",
  "ready-for-agent",
  "agent-in-progress",
  "verify-in-progress",
  "code-review",
  "ready-to-merge",
  "merging",
  "closed",
];

/** The ids of the main path's edges: one per step of `MAIN_PATH`. */
export const MAIN_EDGES: FlowEdge[] = MAIN_PATH.slice(0, -1).map((from, i) => path(from, MAIN_PATH[i + 1]));

/** Every id on the drawing, the start dot included. */
export const FLOW_IDS = [...FLOW_STATUSES.map((s) => s.id), FLOW_START.id];

/** How many light pulses each path carries, and how long one takes to travel it. Three pulses 3.6s apart is enough
 * movement to read "a card moves this way" and slow enough not to pull the eye off the statuses. */
export const FLOW_PULSES = 3;
export const FLOW_PULSE_SECONDS = 3.6;

/** Where a pulse starts, as an SVG `begin` offset: the pulses are spread evenly along the path, so one is always
 * mid-flight and the path never goes dark. Negative values start the pulse already in flight. */
export function pulseBegins(count = FLOW_PULSES, seconds = FLOW_PULSE_SECONDS): number[] {
  return Array.from({ length: count }, (_, i) => {
    const begin = -(seconds * i) / count;
    return begin === 0 ? 0 : begin; // `-0` reads as "-0s" in the SVG; the first pulse starts now
  });
}

/** The ids of the statuses joined to this one by a path, in either direction. */
export function neighbours(id: string | null): string[] {
  if (!id) return [];
  return FLOW_EDGES.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
}

/** Hovering a status brightens its own paths and dims the rest (James, 2026-11-02). With nothing hovered, every
 * path is drawn plain. */
export const edgeDimmed = (edge: FlowEdge, hovered: string | null) =>
  Boolean(hovered) && edge.from !== hovered && edge.to !== hovered;

/** Hovering a status brightens the status and the ones it can move to or come from, and dims the rest. */
export const nodeDimmed = (id: string, hovered: string | null) =>
  Boolean(hovered) && id !== hovered && !neighbours(hovered).includes(id);

/** The main path's edges are the brightest: a card more often than not is on its way down them. */
export const isMainEdge = (edge: FlowEdge) => MAIN_EDGES.some((m) => m.id === edge.id);

/** Which side of a box its tooltip opens on: below it, unless the box is in the drawing's bottom two rows, where
 * the canvas would clip the tooltip. */
export const tipAbove = (y: number) => y > FLOW_ROW * 6;

/** Which way a tooltip runs from its box: from the box's own edge toward the middle for the outer columns, so a
 * box at the drawing's side keeps its tooltip inside the canvas (and on a phone, inside the screen). */
export const tipAlign = (x: number): "start" | "center" | "end" =>
  x <= -FLOW_COL ? "start" : x >= FLOW_COL ? "end" : "center";

/** Every status box, as the page draws it; React Flow measures it, so it stays the size the drawing laid out. */
export const FLOW_NODE_W = 168;
export const FLOW_NODE_H = 54;
/** The label size in a box (`.flow-box` in `app/globals.css`), before the canvas zooms it. */
export const FLOW_LABEL_PX = 11.5;

/** The rectangle the drawing covers, boxes and start dot included, in the drawing's own pixels. */
export const FLOW_BOUNDS = (() => {
  const left = Math.min(...FLOW_STATUSES.map((s) => s.x - FLOW_NODE_W / 2));
  const right = Math.max(...FLOW_STATUSES.map((s) => s.x + FLOW_NODE_W / 2));
  const bottom = Math.max(...FLOW_STATUSES.map((s) => s.y + FLOW_NODE_H));
  return { x: left, y: FLOW_START.y, width: right - left, height: bottom - FLOW_START.y };
})();

/** The drawing on a narrow window (collector#51 review): fitting the whole flow to a phone's width drew the labels
 * at about 4px, so a phone draws it at a fixed zoom that keeps them at 9px or more, on a canvas as big as the
 * drawing at that zoom, and scrolls sideways to it. `x`/`y`/`zoom` are React Flow's viewport; `width`/`height`
 * the canvas. */
export function narrowViewport(zoom = 0.8, pad = 14) {
  return {
    zoom,
    x: pad - FLOW_BOUNDS.x * zoom,
    y: pad - FLOW_BOUNDS.y * zoom,
    width: Math.ceil(FLOW_BOUNDS.width * zoom + pad * 2),
    height: Math.ceil(FLOW_BOUNDS.height * zoom + pad * 2),
  };
}

// ---- A card's journey on the drawing (collector#146): the path one card took, lit node by node in time order.

/** One card's journey, as the drawing replays it: the statuses it entered in time order (`journeyWalk`) and how many
 * times it visited each. */
export interface JourneyTrail {
  walk: string[];
  visits: Record<string, number>;
}

/** The whole walk draws in this long, whatever the number of steps (the card's own 1.5 s), and a replay draws it
 * again. */
export const JOURNEY_DRAW_SECONDS = 1.5;

/** How long one step of a walk is drawn for: the whole walk in `JOURNEY_DRAW_SECONDS`. */
export const journeyStepMs = (steps: number) => (steps > 0 ? (JOURNEY_DRAW_SECONDS * 1000) / steps : 0);

/**
 * What a journey lights once `drawn` of its steps are drawn: the statuses the card has entered so far, and every
 * arrow of the drawing one of those moves took. The walk starts at the start dot, where a card lands on the board.
 *
 * A move the drawing has no arrow for (dividend-solo#146 went `blocked -> ready-for-agent`) lights its status and
 * no path: the drawing is the agent stack's own flow, so its arrows stay exactly as they are.
 */
export function trailLit(walk: string[], drawn: number): { nodes: string[]; edges: string[] } {
  const seen = walk.slice(0, Math.max(0, drawn));
  const steps = [FLOW_START.id, ...seen];
  const taken = FLOW_EDGES.filter((e) => steps.some((s, i) => i > 0 && steps[i - 1] === e.from && e.to === s));
  return { nodes: [...new Set(seen)], edges: [...new Set(taken.map((e) => e.id))] };
}
