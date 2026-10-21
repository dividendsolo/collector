"use client";

import { doing, duration } from "@/lib/format";
import { useLive } from "./data";
import { Dash, Icon, PanelHead, SkelRows } from "./ui";

export interface Run {
  type: string;
  name?: string;
  model?: string;
  provider?: string;
  kind: string;
  feature?: string;
  machine: string;
  card: number;
  repo: string;
  seconds: number;
}

export function useRunning(): Run[] | null {
  const { state } = useLive();
  if (!state) return null;
  return state.machines
    .flatMap((m: any) => (m.running || []).map((r: any) => ({ ...r, machine: m.name })))
    .sort((a: Run, b: Run) => b.seconds - a.seconds);
}

export const ModelCell = ({ model, provider }: { model?: string; provider?: string }) =>
  model ? (
    <>
      <span className="mono">{model.split("/").pop()}</span>
      {provider ? (
        <>
          {" "}
          <span className="sub">{provider}</span>
        </>
      ) : null}
    </>
  ) : (
    <Dash />
  );

/** Running now: which agent or script works on which card, longest first. A build is amber after 30 minutes, red after an hour. */
export function RunningNow() {
  const running = useRunning();
  return (
    <section className="panel">
      <PanelHead icon="play" title="Running now">
        <span className="count">{running?.length ?? 0}</span>
      </PanelHead>
      <div className="wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Name / profile</th>
              <th>Model</th>
              <th>Task</th>
              <th>Machine</th>
              <th>Card</th>
              <th>Repo</th>
              <th className="num">Running for</th>
            </tr>
          </thead>
          <tbody>
            {!running ? (
              <SkelRows n={2} cols={8} />
            ) : running.length ? (
              running.map((r, i) => (
                <tr key={`${r.machine}-${r.repo}-${r.card}-${i}`}>
                  <td>
                    <span className={`pill ${r.type}`}>
                      <Icon name={r.type === "agent" ? "bot" : "term"} />
                      {r.type}
                    </span>
                  </td>
                  <td className="mono">{r.name || "unknown"}</td>
                  <td>
                    <ModelCell model={r.model} provider={r.provider} />
                  </td>
                  <td>
                    {doing(r.kind)}
                    {r.feature ? (
                      <>
                        {" "}
                        <span className="sub">{r.feature}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{r.machine}</td>
                  <td className="mono">
                    <span className="card-tip" tabIndex={0} data-repo={r.repo} data-card={r.card}>
                      #{r.card}
                    </span>
                  </td>
                  <td>{r.repo}</td>
                  <td
                    className={`num mono ${r.kind === "build" && r.seconds > 3600 ? "stuck" : r.kind === "build" && r.seconds > 1800 ? "long" : ""}`}
                  >
                    {duration(r.seconds)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="sub">
                  No agent or script is running.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
