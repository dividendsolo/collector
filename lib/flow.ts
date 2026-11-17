export type FlowTone = "go" | "wait" | "work" | "park";

export interface FlowStatus {
  id: string;
  lines: [string] | [string, string];
  tone: FlowTone;
  tip: string;
  x: number;
  y: number;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export const FLOW_COL = 200;
export const FLOW_ROW = 132;

export const FLOW_START = { id: "start", x: 0, y: 0 };

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

function spread<T extends { id: string; lines: [string] | [string, string]; tone: FlowTone; tip: string }>(
  y: number,
  boxes: T[],
): FlowStatus[] {
  return boxes.map((b, i) => ({ ...b, x: (i - (boxes.length - 1) / 2) * FLOW_COL, y }));
}

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

export const MAIN_EDGES: FlowEdge[] = MAIN_PATH.slice(0, -1).map((from, i) => path(from, MAIN_PATH[i + 1]));

export const FLOW_IDS = [...FLOW_STATUSES.map((s) => s.id), FLOW_START.id];

export const FLOW_PULSES = 3;
export const FLOW_PULSE_SECONDS = 3.6;

export function pulseBegins(count = FLOW_PULSES, seconds = FLOW_PULSE_SECONDS): number[] {
  return Array.from({ length: count }, (_, i) => {
    const begin = -(seconds * i) / count;
    return begin === 0 ? 0 : begin;
  });
}

export function neighbours(id: string | null): string[] {
  if (!id) return [];
  return FLOW_EDGES.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
}

export const edgeDimmed = (edge: FlowEdge, hovered: string | null) =>
  Boolean(hovered) && edge.from !== hovered && edge.to !== hovered;

export const nodeDimmed = (id: string, hovered: string | null) =>
  Boolean(hovered) && id !== hovered && !neighbours(hovered).includes(id);

export const isMainEdge = (edge: FlowEdge) => MAIN_EDGES.some((m) => m.id === edge.id);

export const tipAbove = (y: number) => y > FLOW_ROW * 6;

export const tipAlign = (x: number): "start" | "center" | "end" =>
  x <= -FLOW_COL ? "start" : x >= FLOW_COL ? "end" : "center";

export const FLOW_TIP_WARM_MS = 300;

export const tipWarm = (enteredAt: number, leftAt: number) => enteredAt - leftAt < FLOW_TIP_WARM_MS;

export const FLOW_NODE_W = 168;
export const FLOW_NODE_H = 54;
export const FLOW_LABEL_PX = 11.5;

export const FLOW_BOUNDS = (() => {
  const left = Math.min(...FLOW_STATUSES.map((s) => s.x - FLOW_NODE_W / 2));
  const right = Math.max(...FLOW_STATUSES.map((s) => s.x + FLOW_NODE_W / 2));
  const bottom = Math.max(...FLOW_STATUSES.map((s) => s.y + FLOW_NODE_H));
  return { x: left, y: FLOW_START.y, width: right - left, height: bottom - FLOW_START.y };
})();

export function narrowViewport(zoom = 0.8, pad = 14) {
  return {
    zoom,
    x: pad - FLOW_BOUNDS.x * zoom,
    y: pad - FLOW_BOUNDS.y * zoom,
    width: Math.ceil(FLOW_BOUNDS.width * zoom + pad * 2),
    height: Math.ceil(FLOW_BOUNDS.height * zoom + pad * 2),
  };
}

export interface JourneyTrail {
  walk: string[];
  visits: Record<string, number>;
}

export const JOURNEY_DRAW_SECONDS = 1.5;

export const journeyStepMs = (steps: number) => (steps > 0 ? (JOURNEY_DRAW_SECONDS * 1000) / steps : 0);

export function trailLit(walk: string[], drawn: number): { nodes: string[]; edges: string[] } {
  const seen = walk.slice(0, Math.max(0, drawn));
  const steps = [FLOW_START.id, ...seen];
  const taken = FLOW_EDGES.filter((e) => steps.some((s, i) => i > 0 && steps[i - 1] === e.from && e.to === s));
  return { nodes: [...new Set(seen)], edges: [...new Set(taken.map((e) => e.id))] };
}
