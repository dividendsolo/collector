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
  type JourneyTrail,
  journeyStepMs,
  narrowViewport,
  nodeDimmed,
  pulseBegins,
  tipAbove,
  tipAlign,
  trailLit,
} from "@/lib/flow";
import { isAgentStack, otherStatuses, STATUS_GROUPS, STATUS_PILL, type StatusSets } from "@/lib/statuses";
import { useLive } from "./data";
import { PanelHead, Pill, SkelItems } from "./ui";

const NODE_W = FLOW_NODE_W;
const NODE_H = FLOW_NODE_H;

const TONE: Record<FlowTone, string> = {
  go: "var(--green)",
  wait: "var(--amber)",
  work: "var(--blue)",
  park: "var(--faint)",
};

type StatusData = { status: FlowStatus };
type StatusNode = Node<StatusData, "status">;

type Trail = { nodes: string[]; edges: string[]; visits: Record<string, number>; now: string | null } | null;
type Highlight = { hover: string | null; setHover: (id: string | null) => void; still: boolean; trail: Trail };
const FlowHighlight = createContext<Highlight>({ hover: null, setHover: () => {}, still: false, trail: null });
const useHighlight = () => useContext(FlowHighlight);

function StatusBox({ data }: NodeProps<StatusNode>) {
  const { status } = data;
  const { hover, trail } = useHighlight();
  const lit = !trail || trail.nodes.includes(status.id);
  const visits = trail?.visits[status.id] ?? 0;
  const dimmed = nodeDimmed(status.id, hover) || !lit;
  return (
    <div
      className={`flow-box tone-${status.tone}${dimmed ? " dim" : ""}${trail?.now === status.id ? " now" : ""}`}
      data-status={status.id}
    >
      <Handle type="target" position={Position.Top} className="flow-handle" isConnectable={false} />
      <span className="flow-label">
        {status.lines.map((line, i) => (
          <span key={`${line}-${i}`}>{line}</span>
        ))}
      </span>
      {lit && visits > 1 ? (
        <span className="flow-visits" title={`${visits} visits`}>
          {visits}×
        </span>
      ) : null}
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
  const { hover, still, trail } = useHighlight();
  const [d] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const tone = data ? TONE[data.tone] : TONE.park;
  const main = Boolean(data?.main);
  const onTrail = Boolean(trail?.edges.includes(id));
  const dim = (data ? edgeDimmed({ id, from: data.from, to: data.to }, hover) : false) || (Boolean(trail) && !onTrail);
  const arrow = `flow-arrow-${id}`;
  return (
    <g
      className={`flow-edge${main ? " main" : ""}${onTrail ? " trail" : ""}${dim ? " dim" : ""}`}
      style={{ "--flow-tone": tone } as CSSProperties}
    >
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

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

const NARROW = "(max-width: 700px)";
const NARROW_VIEW = narrowViewport();

const nodeTypes = { status: StatusBox, start: StartBox };
const edgeTypes = { pulse: PulsePath };

export function Drawing({
  journey,
  drawKey = 0,
  hoverNode,
  onHover,
}: {
  journey?: JourneyTrail | null;
  drawKey?: number;
  hoverNode?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const still = useReducedMotion();
  const narrow = useMedia(NARROW);
  const scroller = useRef<HTMLDivElement>(null);
  const [ownHover, setOwnHover] = useState<string | null>(null);
  const controlled = hoverNode !== undefined;
  const hover = (controlled ? hoverNode : ownHover) ?? null;
  const setHover = useCallback(
    (id: string | null) => (controlled ? onHover?.(id) : setOwnHover(id)),
    [controlled, onHover],
  );
  const walk = useMemo(() => journey?.walk ?? [], [journey]);
  const [drawn, setDrawn] = useState(0);
  const replay = useMemo(() => ({ steps: walk.length, round: drawKey }), [walk, drawKey]);
  useEffect(() => {
    if (!replay.steps || still) return;
    setDrawn(0);
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      setDrawn(step);
      if (step >= replay.steps) clearInterval(timer);
    }, journeyStepMs(replay.steps));
    return () => clearInterval(timer);
  }, [replay, still]);
  const shown = still ? walk.length : drawn;
  const trail = useMemo<Trail>(() => {
    if (!journey || !walk.length) return null;
    const lit = trailLit(walk, shown);
    return { ...lit, visits: journey.visits, now: shown > 0 ? walk[Math.min(shown, walk.length) - 1] : null };
  }, [journey, walk, shown]);

  useEffect(() => {
    const el = scroller.current;
    if (narrow && el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [narrow]);

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

  const enter = useCallback((_: unknown, n: Node) => setHover(n.id), [setHover]);
  const leave = useCallback(() => setHover(null), [setHover]);
  const tap = useCallback(
    (_: unknown, n: Node) => {
      if (n.type !== "status") return;
      setHover(n.id);
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-tip="${CSS.escape(n.id)}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }),
      );
    },
    [setHover],
  );
  const highlight = useMemo<Highlight>(() => ({ hover, setHover, still, trail }), [hover, setHover, still, trail]);

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

const PILL_BY_TONE: Record<FlowTone, string> = { go: "human", wait: "warning", work: "agent", park: "" };
const pillFor = (status: string, fallback: string) => {
  const tone = FLOW_STATUSES.find((f) => f.id === status)?.tone;
  return tone ? PILL_BY_TONE[tone] : fallback;
};

function Statuses() {
  const { board } = useLive();
  const t = board?.tickets;
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
