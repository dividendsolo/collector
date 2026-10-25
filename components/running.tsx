"use client";

import { useState } from "react";
import { doing, duration } from "@/lib/format";
import { currentWork, holdText, LAB, labRun, runName, type WorkRow, type WorkRun } from "@/lib/work";
import { useLive } from "./data";
import { Dash, Icon, PanelHead, Pill, SkelRows } from "./ui";

export type Run = WorkRun;

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

/** Running now: which agent or script works on which card, longest first. A build is amber after 30 minutes, red
 * after an hour. The lab droid's own run has its own colour and its own card. */
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
              running.map((r, i) => {
                const lab = labRun(r);
                return (
                  <tr key={`${r.machine}-${r.repo}-${r.card}-${i}`}>
                    <td>
                      <span className={`pill ${lab ? LAB.marker : r.type}`}>
                        <Icon name={r.type === "agent" ? "bot" : "term"} />
                        {r.type}
                      </span>
                    </td>
                    <td className={lab ? "mono lab" : "mono"}>{runName(r)}</td>
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
                      {r.card == null ? (
                        <Dash />
                      ) : lab ? (
                        <a
                          className="plain card-tip"
                          href={LAB.url}
                          target="_blank"
                          rel="noopener"
                          tabIndex={0}
                          data-repo={LAB.repo}
                          data-card={r.card}
                        >
                          #{r.card}
                        </a>
                      ) : (
                        <span className="card-tip" tabIndex={0} data-repo={r.repo} data-card={r.card}>
                          #{r.card}
                        </span>
                      )}
                    </td>
                    <td>{r.repo ? r.repo : <span className="sub">no repo</span>}</td>
                    <RunTime r={r} />
                  </tr>
                );
              })
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

const SCHEDULED_SHOWN = 10;
const LANE_PILL: Record<string, string> = {
  "ready-for-agent": "human",
  closed: "ok",
  "ready-to-merge": "ok",
  merging: "ok",
  "changes-requested": "warning",
};

/** The age cell of a live run: amber after 30 minutes of a build, red after an hour. A build only: a review, a
 * verify and the lab droid's runs (up to two hours by design) never turn amber or red. */
const RunTime = ({ r }: { r: Run }) => (
  <td
    className={`num mono ${r.kind === "build" && r.seconds > 3600 ? "stuck" : r.kind === "build" && r.seconds > 1800 ? "long" : ""}`}
  >
    {duration(r.seconds)}
  </td>
);

function StateCell({ row }: { row: WorkRow }) {
  const hold = row.card?.lane === "scheduled" ? row.card.hold : null;
  const deck = row.onDeck ?? [];
  return (
    <td>
      {row.run ? (
        <span className={`pill ${labRun(row.run) ? LAB.marker : row.run.type}`}>
          <Icon name={row.run.type === "agent" ? "bot" : "term"} />
          {row.run.type}
        </span>
      ) : (
        <Pill cls={LANE_PILL[row.state] || ""} dot={false}>
          {row.state}
        </Pill>
      )}
      {hold?.after.length ? (
        <span className={`sub${deck.length ? " on-deck" : ""}`}>
          {" after "}
          {hold.after.map((a, i) => (
            <span key={a.url}>
              {i ? ", " : ""}
              <a
                className={`plain${deck.includes(a.ref) ? " moving" : ""}`}
                href={a.url}
                target="_blank"
                rel="noopener"
              >
                {a.ref}
              </a>
            </span>
          ))}
        </span>
      ) : hold ? (
        <span className="sub"> {holdText(hold)}</span>
      ) : null}
      {deck.length ? (
        <Pill cls="deck" dot={false}>
          on deck
        </Pill>
      ) : null}
    </td>
  );
}

/** Current work: every open card that is not waiting on James, with the live agent or script on it when one runs,
 * and the cards closed in the last hour. Live runs first, then review and merge, closed, ready-for-agent, and
 * scheduled (the cards whose blocker is being worked on first, then ten, then "Show all"). */
export function CurrentWork() {
  const { state, board } = useLive();
  const [all, setAll] = useState(false);
  const runs = useRunning();
  const work = board?.work;
  const rows =
    runs && work?.loaded ? currentWork(work.cards, work.closed || [], runs, board?.tickets?.each || []) : null;
  const scheduled = rows ? rows.filter((r) => r.state === "scheduled" && !r.run) : [];
  const hidden = all ? 0 : Math.max(0, scheduled.length - SCHEDULED_SHOWN);
  const cut = new Set(hidden ? scheduled.slice(SCHEDULED_SHOWN).map((r) => r.key) : []);
  const shown = rows ? rows.filter((r) => !cut.has(r.key)) : null;
  return (
    <section className="panel" id="current-work">
      <PanelHead icon="play" title="Current work">
        <span className="count">{rows?.filter((r) => r.state !== "closed").length ?? 0}</span>
      </PanelHead>
      <div className="wrap">
        <table>
          <thead>
            <tr>
              <th>State</th>
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
            {!shown || !state ? (
              <SkelRows n={3} cols={8} />
            ) : shown.length ? (
              shown.map((row) => {
                const r = row.run;
                const c = row.card;
                const lab = r ? labRun(r) : false;
                const repo = c?.repo ?? r?.repo;
                const num = c?.number ?? r?.card;
                return (
                  <tr key={row.key} className={row.state === "closed" ? "done" : ""}>
                    <StateCell row={row} />
                    <td className={lab ? "mono lab" : "mono"}>{r ? runName(r) : <Dash />}</td>
                    <td>{r ? <ModelCell model={r.model} provider={r.provider} /> : <Dash />}</td>
                    <td>
                      {r ? (
                        <>
                          {doing(r.kind)}
                          {r.feature ? (
                            <>
                              {" "}
                              <span className="sub">{r.feature}</span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td>{r ? r.machine : row.local ? "local" : <Dash />}</td>
                    <td className="mono">
                      {num == null ? (
                        <Dash />
                      ) : (
                        <a
                          className="plain card-tip"
                          href={c?.url ?? (lab ? LAB.url : undefined)}
                          target="_blank"
                          rel="noopener"
                          tabIndex={0}
                          data-repo={c?.repo ?? (lab ? LAB.repo : repo)}
                          data-card={num}
                        >
                          #{num}
                        </a>
                      )}
                    </td>
                    <td>{repo ? repo : <span className="sub">no repo</span>}</td>
                    {r ? (
                      <RunTime r={r} />
                    ) : (
                      <td className="num">
                        <Dash />
                      </td>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={8} className="sub">
                  No open work and nothing running.
                </td>
              </tr>
            )}
            {hidden ? (
              <tr>
                <td colSpan={8}>
                  <button type="button" className="btn" onClick={() => setAll(true)}>
                    Show all {scheduled.length} scheduled
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
