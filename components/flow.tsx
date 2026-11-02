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
  Position,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { type CSSProperties, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  edgeDimmed,
  FLOW_EDGES,
  FLOW_PULSE_SECONDS,
  FLOW_START,
  FLOW_STATUSES,
  type FlowEdge,
  type FlowStatus,
  type FlowTone,
  isMainEdge,
  nodeDimmed,
  pulseBegins,
  tipAbove,
} from "@/lib/flow";
import { isAgentStack, STATUS_GROUPS, STATUS_PILL, type StatusSets } from "@/lib/statuses";
import { useLive } from "./data";
import { PanelHead, Pill, SkelItems } from "./ui";

/**
 * Card flow: every status a card can have and the statuses it can move to (James, 2026-11-02). The drawing is
 * `lib/flow.ts` laid out with React Flow (`@xyflow/react`, MIT). What the old Graphviz picture showed as white
 * note boxes are the statuses' hover tooltips now, every path carries light pulses travelling the way a card
 * moves — brightest down the main path — and hovering a status brightens its own paths, dims the rest and opens
 * its tooltip.
 */

/** The box every status gets, which is what the drawing laid out and what the handles sit on. */
const NODE_W = 168;
const NODE_H = 54;

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

/** One status box, with its tooltip. React Flow measures it, so it stays the size the drawing laid out. */
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
      <div className={`flow-tip ${tipAbove(status.y) ? "above" : "below"}`}>{status.tip}</div>
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

/** `prefers-reduced-motion`: the pulses stop, the paths stay (James, 2026-11-02). */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const nodeTypes = { status: StatusBox, start: StartBox };
const edgeTypes = { pulse: PulsePath };

/** The drawing. Hovering a status is its only state: it decides what stays bright and what fades, on the boxes
 * and on the paths, and it is handed down through `FlowHighlight` so React Flow's own arrays never change. */
function Drawing() {
  const [hover, setHover] = useState<string | null>(null);
  const still = useReducedMotion();

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
  const highlight = useMemo<Highlight>(() => ({ hover, setHover, still }), [hover, still]);

  return (
    <div className="flow-canvas" style={{ ["--flow-node-h" as string]: `${NODE_H}px` } as CSSProperties}>
      <FlowHighlight.Provider value={highlight}>
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.25}
            maxZoom={1.4}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            onNodeMouseEnter={enter}
            onNodeMouseLeave={leave}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--line)" />
          </ReactFlow>
        </ReactFlowProvider>
      </FlowHighlight.Provider>
    </div>
  );
}

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
          STATUS_GROUPS.map((g) => (
            <li key={g.key}>
              <div>
                <div className="name">
                  {g.label} <span className="sub">{sets[g.key].length}</span>
                </div>
                <div className="sub">{g.does}</div>
              </div>
              <div className="right">
                {sets[g.key].length ? (
                  sets[g.key].map((s) => (
                    <Pill key={s} cls={STATUS_PILL[g.key]} dot={false}>
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
            hover a status for what it means: the bright path is the usual route from triage to closed
          </span>
        </PanelHead>
        <Drawing />
      </div>
      <Statuses />
    </>
  );
}
