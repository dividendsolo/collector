"use client";

import { useEffect, useRef } from "react";

/** Card flow: every status a card can have and the statuses it can move to, drawn with Graphviz (viz.js).
 *  The reference James and the droids use (2026-11-02); the source was agent-stack/docs/card-flow.html. */
const DOT = `digraph flow {
  graph [rankdir=TB, nodesep=0.55, ranksep=0.9, fontname="Helvetica", bgcolor="white", pad=0.3];
  node  [shape=circle, style=filled, fontname="Helvetica-Bold", fontsize=15, width=1.7, fixedsize=true, color="#333333", penwidth=1.5];
  edge  [fontname="Helvetica", fontsize=13, color="#555555", fontcolor="#222222", arrowsize=0.8];

  start [shape=point, width=0.25, fillcolor=black, label=""];
  triage   [label="needs-\\ntriage", fillcolor="#f2b84b"];
  rfa      [label="ready-for-\\nagent", fillcolor="#8bd17c"];
  rfh      [label="ready-for-\\nhuman", fillcolor="#8bd17c"];
  sched    [label="scheduled", fillcolor="#d0d4dc"];
  blocked  [label="blocked", fillcolor="#d0d4dc"];
  closed2  [label="closed", fillcolor="#d0d4dc"];
  blockednote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="Waits on another card.\\nGitHub issue link:\\nBlocked by (issue dependencies)"];
  rfhnote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="Requires a human in the loop\\n(HITL)"];
  rfanote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="Goes into the agent queue"];
  infonote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="The builder could not finish\\nwithout more information from the user.\\nA triage miss: triage should have\\ngot that information. Keep it rare."];
  aipnote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="A droid the foreman assigned,\\nor an interactive session\\nwith the user (label: local)"];
  schednote [shape=box, style="rounded,filled", fillcolor="#f4f5f7", fixedsize=false, width=0, fontname="Helvetica", fontsize=14, margin="0.2,0.12", label="Waits for a date only\\n(for example, a launch date)"];
  aip      [label="agent-in-\\nprogress", fillcolor="#6cb6ff"];
  vip      [label="verify-in-\\nprogress", fillcolor="#6cb6ff"];
  info     [label="needs-\\ninfo", fillcolor="#f2b84b"];
  review   [label="code-\\nreview", fillcolor="#6cb6ff"];
  changes  [label="changes-\\nrequested", fillcolor="#f2b84b"];
  qa       [label="needs-\\nmanual-qa", fillcolor="#f2b84b"];
  rtm      [label="ready-to-\\nmerge", fillcolor="#6cb6ff"];
  merging  [label="merging", fillcolor="#6cb6ff"];
  closed   [label="closed",  shape=doublecircle, width=1.3, fillcolor="#d0d4dc"];

  // Down the page: one level per step. Arrows marked side=1 go sideways or back up and do not set levels.
  start -> triage [weight=10];
  triage -> rfh; triage -> rfa [weight=10]; triage -> sched; triage -> blocked; triage -> closed2;
  { rank=same; closed2; blocked; rfh; rfa; sched; }
  closed2 -> blocked -> rfh -> rfa -> sched [style=invis];
  rfa -> aip [weight=10];
  blocked -> blockednote [style=dashed, arrowhead=none];
  rfh -> rfhnote [style=dashed, arrowhead=none];
  { rank=same; blockednote; rfhnote; aip; rfanote; schednote; }
  blockednote -> rfhnote -> aip -> rfanote -> schednote [style=invis];
  sched -> schednote [style=dashed, arrowhead=none];
  rfa -> rfanote [style=dashed, arrowhead=none];
  aip -> info; aip -> vip [weight=10]; aip -> aipnote [style=dashed, arrowhead=none];
  { rank=same; info; vip; aipnote; }
  info -> vip -> aipnote [style=invis];
  vip -> review [weight=10];
  info -> infonote [style=dashed, arrowhead=none];
  { rank=same; infonote; review; }
  infonote -> review [style=invis];
  review -> qa; review -> rtm [weight=10]; review -> changes;
  { rank=same; qa; rtm; changes; }
  qa -> rtm -> changes [style=invis];
  rtm -> merging [weight=10];
  merging -> closed [weight=10];
}`;

export function FlowPage() {
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: DOT is the trigger, so an edit redraws on hot reload
  useEffect(() => {
    let live = true;
    import("@viz-js/viz").then(async ({ instance }) => {
      const viz = await instance();
      if (!live || !box.current) return;
      const svg = viz.renderSVGElement(DOT);
      svg.style.width = "100%";
      svg.style.maxWidth = "1100px";
      svg.style.height = "auto";
      svg.style.display = "block";
      svg.style.margin = "0 auto";
      box.current.replaceChildren(svg);
    });
    return () => {
      live = false;
    };
  }, [DOT]);
  return (
    <div className="panel">
      <div ref={box} style={{ background: "#fff", borderRadius: 12, padding: 16, overflow: "auto" }}>
        Drawing…
      </div>
    </div>
  );
}
