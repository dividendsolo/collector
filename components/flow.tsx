"use client";

import {
  Background,
  BackgroundVariant,
  type Edge,
  type EdgeProps,
  getBezierPath,
  Handle,
  type Node,
  type NodeProps,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  type CSSProperties,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  edgeDimmed,
  FLOW_EDGES,
  FLOW_NODE_H,
  FLOW_NODE_W,
  FLOW_PULSE_SECONDS,
  FLOW_START,
  FLOW_STATUSES,
  type FlowEdge,
  type FlowStatus,
  type FlowTone,
  isMainEdge,
  narrowViewport,
  nodeDimmed,
  pulseBegins,
  tipAbove,
  tipAlign,
} from "@/lib/flow";
import { isAgentStack, otherStatuses, STATUS_GROUPS, STATUS_PILL, type StatusSets } from "@/lib/statuses";
import { useLive } from "./data";
import { PanelHead, Pill, SkelItems } from "./ui";

/**
 * Card flow: every status a card can have and the statuses it can move to (James, 2026-11-02). The drawing is
 * `lib/flow.ts` laid out with React Flow (`@xyflow/react`, MIT). What the old Graphviz picture showed as white
 * note boxes are the statuses' hover tooltips now, every path carries light pulses travelling the way a card
 * moves — brightest down the main path — and hovering a status brightens its own paths, dims the rest and opens
 * its tooltip.
 */

const NODE_W = FLOW_NODE_W;
const NODE_H = FLOW_NODE_H;

/** The colour a status's paths and pulses wear: the status's own tone, in the page's tokens. */
const TONE: Record<FlowTone, string> = {
  go: "var(--green)",
  wait: "var(--amber)",
  work: "var(--blue)",
  park: "var(--faint)",
};

type StatusData = { status: FlowStatus };
type StatusNode = Node<StatusData, "status">;

/**
 * What is hovered, and whether the page should stay still, read by the boxes and the paths. It is a context and
 * not props on the nodes: passing a fresh nodes array on every hover makes React Flow rebuild its own DOM under
 * the pointer, which fires `mouseleave` and `mouseenter` again and sets the whole thing spinning. The arrays
 * handed to React Flow are therefore built once, and only the boxes and the paths below react to a hover.
 */
type Highlight = { hover: string | null; setHover: (id: string | null) => void; still: boolean };
const FlowHighlight = createContext<Highlight>({ hover: null, setHover: () => {}, still: false });
const useHighlight = () => useContext(FlowHighlight);

/**
 * One status box, with its tooltip. React Flow measures the box, so it stays the size the drawing laid out. The
 * tooltip is a `NodeToolbar`: React Flow draws it outside the zoomed viewport, at the box's place on screen, so it
 * reads at its own 11px at any zoom (on a phone the canvas zoom made it a 71px box of 3.6px text, collector#51
 * review). It shows while the status is hovered, or tapped on a touch screen.
 */
function StatusBox({ data }: NodeProps<StatusNode>) {
  const { status } = data;
  const { hover } = useHighlight();
  const dimmed = nodeDimmed(status.id, hover);
  return (
    <div className={`flow-box tone-${status.tone}${dimmed ? " dim" : ""}`} data-status={status.id}>
      <Handle type="target" position={Position.Top} className="flow-handle" isConnectable={false} />
      <span className="flow-label">
        {status.lines.map((line, i) => (
          <span key={`${line}-${i}`}>{line}</span>
        ))}
      </span>
      <NodeToolbar
        isVisible={hover === status.id}
        position={tipAbove(status.y) ? Position.Top : Position.Bottom}
        align={tipAlign(status.x)}
        offset={8}
      >
        <div className={`flow-tip tone-${status.tone}`} data-tip={status.id}>
          {status.tip}
        </div>
      </NodeToolbar>
      <Handle type="source" position={Position.Bottom} className="flow-handle" isConnectable={false} />
    </div>
  );
}

/** The dot the drawing starts from: a card lands on the board here. */
function StartBox() {
  return (
    <div className="flow-box flow-start">
      <Handle type="target" position={Position.Top} className="flow-handle" isConnectable={false} />
      <span className="flow-dot" />
      <Handle type="source" position={Position.Bottom} className="flow-handle" isConnectable={false} />
    </div>
  );
}

type PulseData = { tone: FlowTone; main: boolean; from: string; to: string };
type PulseEdgeType = Edge<PulseData, "pulse">;

/**
 * One path: a thin line, an arrowhead at the box a card moves to, and light pulses travelling it in the direction
 * a card moves. A pulse is a dot moved by SVG `animateMotion` along the very path it draws, so it follows the
 * curve; the pulses are spread along the path (`pulseBegins`) so one is always in flight, and with
 * `prefers-reduced-motion` they are not drawn at all and the path stays.
 */
function PulsePath({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<PulseEdgeType>) {
  const { hover, still } = useHighlight();
  const [d] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const tone = data ? TONE[data.tone] : TONE.park;
  const main = Boolean(data?.main);
  const dim = data ? edgeDimmed({ id, from: data.from, to: data.to }, hover) : false;
  const arrow = `flow-arrow-${id}`;
  return (
    <g
      className={`flow-edge${main ? " main" : ""}${dim ? " dim" : ""}`}
      style={{ "--flow-tone": tone } as CSSProperties}
    >
      {/* One arrowhead per path, at the box the card moves to: the pulses say which way a card goes, and the head
          says it without waiting for one to arrive. Its id carries the edge's, so no two markers share one. */}
      <defs>
        <marker
          id={arrow}
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill={tone} />
        </marker>
      </defs>
      <path className="flow-line" d={d} markerEnd={`url(#${arrow})`} />
      {still
        ? null
        : pulseBegins().map((begin, i) => (
            <circle key={i} className="flow-pulse" r={main ? 3 : 2.2} fill={tone}>
              <animateMotion dur={`${FLOW_PULSE_SECONDS}s`} begin={`${begin}s`} repeatCount="indefinite" path={d} />
            </circle>
          ))}
    </g>
  );
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = matchMedia(query);
    setMatches(mq.matches);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** `prefers-reduced-motion`: the pulses stop, the paths stay (James, 2026-11-02). */
const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

/** A phone-wide window, the same break as the page's own (`max-width: 700px` in `app/globals.css`). */
const NARROW = "(max-width: 700px)";
const NARROW_VIEW = narrowViewport();

const nodeTypes = { status: StatusBox, start: StartBox };
const edgeTypes = { pulse: PulsePath };

/** The drawing. Hovering a status is its only state: it decides what stays bright and what fades, on the boxes
 * and on the paths, and it is handed down through `FlowHighlight` so React Flow's own arrays never change. */
function Drawing() {
  const [hover, setHover] = useState<string | null>(null);
  const still = useReducedMotion();
  const narrow = useMedia(NARROW);
  const scroller = useRef<HTMLDivElement>(null);
  // A phone opens the drawing on its middle, where needs-triage sits, not on its left edge.
  useEffect(() => {
    const el = scroller.current;
    if (narrow && el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [narrow]);

  // Built once, and never again on a hover: see `FlowHighlight`.
  const nodes = useMemo<Node[]>(
    () => [
      {
        id: FLOW_START.id,
        type: "start",
        position: { x: FLOW_START.x - 8, y: FLOW_START.y },
        data: {},
        draggable: false,
        selectable: false,
        focusable: false,
      } satisfies Node,
      ...FLOW_STATUSES.map(
        (status): StatusNode => ({
          id: status.id,
          type: "status",
          position: { x: status.x - NODE_W / 2, y: status.y },
          data: { status },
          draggable: false,
          selectable: false,
          focusable: false,
        }),
      ),
    ],
    [],
  );

  const edges = useMemo<PulseEdgeType[]>(
    () =>
      FLOW_EDGES.map((e: FlowEdge) => {
        const from = FLOW_STATUSES.find((s) => s.id === e.from);
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: "pulse",
          data: { tone: from ? from.tone : "park", main: isMainEdge(e), from: e.from, to: e.to },
          focusable: false,
          selectable: false,
        } satisfies PulseEdgeType;
      }),
    [],
  );

  const enter = useCallback((_: unknown, n: Node) => setHover(n.id), []);
  const leave = useCallback(() => setHover(null), []);
  // A touch screen has no hover: a tap opens the status's tooltip (and its highlight), a tap on the ground closes
  // it, and the tooltip is scrolled into the screen, since on a phone the drawing is wider than the screen.
  const tap = useCallback((_: unknown, n: Node) => {
    if (n.type !== "status") return;
    setHover(n.id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-tip="${CSS.escape(n.id)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }),
    );
  }, []);
  const highlight = useMemo<Highlight>(() => ({ hover, setHover, still }), [hover, still]);

  // On a phone the drawing is not fitted down to the screen's width (labels about 4px): it is drawn at a zoom
  // that keeps them at 9px or more, on a canvas as big as the drawing at that zoom, and the canvas scrolls
  // sideways inside its panel. The canvas's own drag and pinch are off there, so a finger scrolls the page and the
  // drawing the way it scrolls anything else. A wide window is unchanged: fitted, pannable, zoomable.
  const view = narrow
    ? {
        defaultViewport: { x: NARROW_VIEW.x, y: NARROW_VIEW.y, zoom: NARROW_VIEW.zoom },
        minZoom: NARROW_VIEW.zoom,
        maxZoom: NARROW_VIEW.zoom,
        panOnDrag: false,
        zoomOnScroll: false,
        zoomOnPinch: false,
        zoomOnDoubleClick: false,
        preventScrolling: false,
      }
    : { fitView: true, fitViewOptions: { padding: 0.08 }, minZoom: 0.25, maxZoom: 1.4 };
  const size: CSSProperties = narrow ? { width: NARROW_VIEW.width, height: NARROW_VIEW.height } : {};

  return (
    <div ref={scroller} className={`flow-scroll${narrow ? " narrow" : ""}`}>
      <div className="flow-canvas" style={{ ["--flow-node-h" as string]: `${NODE_H}px`, ...size } as CSSProperties}>
        <FlowHighlight.Provider value={highlight}>
          <ReactFlowProvider>
            <ReactFlow
              // A new window width is a new viewport: the drawing mounts again with the other one.
              key={narrow ? "narrow" : "wide"}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              {...view}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              onNodeMouseEnter={enter}
              onNodeMouseLeave={leave}
              onNodeClick={tap}
              onPaneClick={leave}
              proOptions={{ hideAttribution: false }}
            >
              <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--line)" />
            </ReactFlow>
          </ReactFlowProvider>
        </FlowHighlight.Provider>
      </div>
    </div>
  );
}

/** A status's pill wears its colour in the drawing above, so ready-for-human is green there and here. A status the
 * drawing does not have keeps its group's colour. */
const PILL_BY_TONE: Record<FlowTone, string> = { go: "human", wait: "warning", work: "agent", park: "" };
const pillFor = (status: string, fallback: string) => {
  const tone = FLOW_STATUSES.find((f) => f.id === status)?.tone;
  return tone ? PILL_BY_TONE[tone] : fallback;
};

/** The statuses Collector reads, which are a setting (collector#53): `config.json`'s `statuses`, in the set's own
 * order, from the board view. With nothing set they are the agent stack's own statuses, and the page says so. */
function Statuses() {
  const { board } = useLive();
  const t = board?.tickets;
  // `each` is the waiting set under the name this view has always used; working and done come beside it.
  const sets: StatusSets | null = t ? { waiting: t.each, working: t.working, done: t.done } : null;
  const custom = sets ? !isAgentStack(sets) : false;
  return (
    <section className="panel" id="statuses">
      <PanelHead icon="layers" title="Statuses">
        <span className="sub">
          {custom ? "from config.json" : "the agent stack's own: set statuses in config.json to use yours"}
        </span>
      </PanelHead>
      <ul className="health statuses">
        {!sets ? (
          <SkelItems n={3} />
        ) : (
          [
            ...STATUS_GROUPS.map((g) => ({ ...g, list: sets[g.key], cls: STATUS_PILL[g.key] })),
            {
              key: "other",
              label: "In between",
              does: "Queued for a droid or between two steps: nothing to do, and no machine holds the card yet.",
              list: otherStatuses(sets),
              cls: "",
            },
          ].map((g) => (
            <li key={g.key}>
              <div>
                <div className="name">
                  {g.label} <span className="sub">{g.list.length}</span>
                </div>
                <div className="sub">{g.does}</div>
              </div>
              <div className="right">
                {g.list.length ? (
                  g.list.map((s) => (
                    <Pill key={s} cls={pillFor(s, g.cls)} dot={false}>
                      {s}
                    </Pill>
                  ))
                ) : (
                  <span className="sub">none</span>
                )}
              </div>
            </li>
          ))
        )}
        {custom ? (
          <li>
            <div className="sub">
              The drawing above is the agent stack&apos;s own flow: your statuses are the ones listed here.
            </div>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function FlowPage() {
  return (
    <>
      <div className="panel">
        <PanelHead icon="gauge" title="Card flow">
          <span className="sub">
            hover or tap a status for what it means: the bright path is the usual route from triage to closed
          </span>
        </PanelHead>
        <Drawing />
      </div>
      <Statuses />
    </>
  );
}
