"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ago, duration, historyless, lastResult, STATUS_RANK, schedule, status } from "@/lib/format";
import { useLive } from "./data";
import { PanelHead, SkelRows } from "./ui";

export const jobHref = (j: { machine: string; id: string }) =>
  `#/cron/${encodeURIComponent(j.machine)}/${encodeURIComponent(j.id)}`;

/** Each machine's time zone; a machine in another zone than the first gets its zone after each time. */
export function useZones() {
  const { state } = useLive();
  const zones: Record<string, string> = Object.fromEntries((state?.machines || []).map((m: any) => [m.name, m.tz]));
  return { zone: (m: string) => zones[m], first: Object.values(zones)[0] };
}

const StatusPill = ({ s }: { s: string }) => (
  <span className={`pill ${s.toLowerCase()}`}>
    <span className="dot" />
    {s}
  </span>
);

export function CronPage() {
  const { state } = useLive();
  const zones = useZones();
  const [filter, setFilter] = useState("all");
  const names: string[] = (state?.machines || []).map((m: any) => m.name);
  const rows = state
    ? state.machines
        .flatMap((m: any) => m.jobs || [])
        .map((j: any) => ({ ...j, s: status(j) }))
        .filter(
          (j: any) =>
            filter === "all" ||
            (filter === "problems" ? STATUS_RANK[j.s as keyof typeof STATUS_RANK] < 2 : j.machine === filter),
        )
        .sort(
          (a: any, b: any) =>
            STATUS_RANK[a.s as keyof typeof STATUS_RANK] - STATUS_RANK[b.s as keyof typeof STATUS_RANK] ||
            a.machine.localeCompare(b.machine) ||
            a.name.localeCompare(b.name),
        )
    : null;
  const filters = [["all", "All"], ...names.map((n) => [n, n]), ["problems", "Problems"]];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Cron Jobs</h1>
        <p>Every scheduled job on every machine.</p>
      </div>
      <section className="panel" id="cron-jobs">
        <PanelHead icon="clock" title="Cron jobs">
          <span className="count">{rows?.length ?? 0}</span>
          <div className="tools">
            <div className="seg" id="filter">
              {filters.map(([f, label]) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </PanelHead>
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Job</th>
                <th>Machine</th>
                <th>What it does</th>
                <th>Schedule</th>
                <th>Last run</th>
                <th>Last result</th>
              </tr>
            </thead>
            <tbody id="jobs">
              {!rows ? (
                <SkelRows n={8} cols={7} />
              ) : (
                rows.map((j: any) => (
                  <tr
                    className={`row ${j.enabled ? "" : "off"}`}
                    key={`${j.machine}/${j.id}`}
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest("a")) location.hash = jobHref(j);
                    }}
                  >
                    <td>
                      <StatusPill s={j.s} />
                    </td>
                    <td>
                      <span className="mono">{j.name}</span>
                    </td>
                    <td>{j.machine}</td>
                    <td className="wide">{j.what}</td>
                    <td>{schedule(j.schedule, zones.zone(j.machine), zones.first)}</td>
                    <td className="sub">{ago(j.last_run_at)}</td>
                    <td>
                      {lastResult(j)}
                      {j.last_error ? <div className="err">{j.last_error.slice(0, 120)}</div> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

function When({ iso }: { iso?: string | null }) {
  if (!iso) return <>—</>;
  const d = new Date(iso);
  return (
    <>
      {d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
      {d.getTime() < Date.now() ? (
        <>
          {" "}
          <span className="sub">{ago(iso)}</span>
        </>
      ) : null}
    </>
  );
}

/** One cron job's own page: #/cron/<machine>/<job id>. */
export function JobPage({ machine, id }: { machine: string; id: string }) {
  const { state } = useLive();
  const zones = useZones();
  const m = state?.machines.find((x: any) => x.name === machine);
  const j = (m?.jobs || []).find((x: any) => x.id === id);
  const setup = useRef<HTMLDListElement>(null);
  // The size numbers get the width of the widest one, so their last digits line up.
  useLayoutEffect(() => {
    const boxes = [...(setup.current?.querySelectorAll<HTMLElement>(".digits") || [])];
    for (const b of boxes) b.style.minWidth = "";
    const widest = Math.max(0, ...boxes.map((b) => b.offsetWidth));
    for (const b of boxes) b.style.minWidth = `${widest}px`;
  });
  const title = j ? j.name : id;
  if (!state)
    return (
      <div className="page">
        <div className="page-head">
          <div className="crumbs">
            <a href="#/cron">&larr; All cron jobs</a>
          </div>
          <h1 className="mono-title">{id}</h1>
        </div>
      </div>
    );
  const n = (x: unknown) => (x ?? "—") as React.ReactNode;
  const s = j ? status(j) : "";
  const chars = j ? (j.agent ? j.prompt_chars : j.script_chars) : 0;
  // Hermes sends a job's output to "local" (a file on the machine) when the job names no target. Many jobs send their
  // own email (email-brief.py, Resend); the prompt or the script says so.
  const target = j?.deliver || "local";
  const emails = j ? /email-brief|resend/i.test(`${j.prompt || ""}\n${j.script_body || ""}`) : false;
  const sendsTo = emails && target === "local" ? "email" : emails ? `${target} and email` : target;
  const prof = (m?.profiles || []).find((p: any) => p.name === j?.profile);
  const model = j?.model || prof?.model;
  const runs: any[] = j?.runs || [];
  const secs = (x: number) => (x < 1 ? "under 1 s" : x < 120 ? `${Math.round(x)} s` : duration(x));
  const took = (r: any) =>
    r.finished && r.at ? secs((new Date(r.finished).getTime() - new Date(r.at).getTime()) / 1000) : "—";
  return (
    <div className="page">
      <div className="page-head">
        <div className="crumbs">
          <a href="#/cron">&larr; All cron jobs</a>
        </div>
        <h1 className="mono-title">{title}</h1>
        <p>{j ? j.what || "" : "This job is not on that machine now."}</p>
      </div>
      <div className="kv-cards">
        <section className="panel">
          <PanelHead icon="server" title="Setup" />
          <dl className="kv" ref={setup}>
            {j && (
              <>
                <Fact label="Machine">{machine}</Fact>
                <Fact label="Runs">{j.agent ? "an agent" : "a script"}</Fact>
                <Fact label="Scheduler">{j.scheduler}</Fact>
                {j.agent ? <Fact label="Model">{model ? <span className="mono">{model}</span> : "—"}</Fact> : null}
                {j.skills?.length ? (
                  <Fact label="Skills">
                    {j.skills.map((x: string, i: number) => (
                      <span key={x}>
                        {i ? " " : ""}
                        <span className="chip">{x}</span>
                      </span>
                    ))}
                  </Fact>
                ) : null}
                {j.scheduler?.startsWith("Hermes") ? <Fact label="Output">{sendsTo}</Fact> : null}
                {j.workdir ? (
                  <Fact label="Folder">
                    <span className="mono">{j.workdir}</span>
                  </Fact>
                ) : null}
                {j.command ? (
                  <Fact label="Command">
                    <span className="mono">{j.command}</span>
                  </Fact>
                ) : null}
                {j.unit ? (
                  <Fact label="Unit">
                    <span className="mono">{j.unit}</span>
                  </Fact>
                ) : null}
                {j.unit && j.service ? (
                  <Fact label="Service">
                    <span className="mono">{j.service}</span>
                  </Fact>
                ) : null}
                {j.plist ? (
                  <Fact label="launchd file">
                    <span className="mono">{j.plist}</span>
                  </Fact>
                ) : null}
                {!j.agent && j.script_lines ? (
                  <Fact label="Lines of code">
                    <span className="digits">{j.script_lines.toLocaleString()}</span>
                  </Fact>
                ) : null}
                {j.agent && chars ? (
                  <Fact label="Characters">
                    <span className="digits">{chars.toLocaleString()}</span>
                  </Fact>
                ) : null}
                {chars ? (
                  <Fact label="Tokens">
                    <span className="digits">~{Math.round(chars / 4).toLocaleString()}</span>
                  </Fact>
                ) : null}
                {j.logs?.length ? (
                  <Fact label="Logs">
                    {j.logs.map((x: string, i: number) => (
                      <span key={x}>
                        {i ? <br /> : null}
                        <span className="mono">{x}</span>
                      </span>
                    ))}
                  </Fact>
                ) : null}
              </>
            )}
          </dl>
        </section>
        <section className="panel">
          <PanelHead icon="clock" title="Schedule" />
          <dl className="kv">
            {j && (
              <>
                <Fact label="Status">
                  <StatusPill s={s} />
                </Fact>
                <Fact label="Schedule">{schedule(j.schedule, zones.zone(machine), zones.first)}</Fact>
                <Fact label="Cron text">
                  {/^[\d*@]/.test(j.schedule_raw || "") ? <span className="mono">{j.schedule_raw}</span> : "—"}
                </Fact>
                <Fact label="Next run">
                  <When iso={j.next_run_at} />
                </Fact>
                <Fact label="Last run">
                  <When iso={j.last_run_at} />
                </Fact>
                <Fact label="Last result">{lastResult(j)}</Fact>
                {j.paused_reason ? <Fact label="Paused because">{j.paused_reason}</Fact> : null}
              </>
            )}
          </dl>
        </section>
        <section className="panel">
          <PanelHead icon="activity" title="Runs" />
          <dl className="kv">
            {j && (
              <>
                <Fact label="Runs, 1 h">{n(j.runs_1h)}</Fact>
                <Fact label="Runs, 24 h">{n(j.runs_24h)}</Fact>
                <Fact label="Failed, 24 h">{n(j.fails_24h)}</Fact>
                <Fact label="Failures in a row">{n(j.failure_streak)}</Fact>
                <Fact label="Runs in all">{j.total_runs != null ? j.total_runs.toLocaleString() : "—"}</Fact>
                <Fact label="Created">
                  <When iso={j.created_at} />
                </Fact>
              </>
            )}
          </dl>
        </section>
      </div>
      {j?.last_error ? (
        <section className="panel">
          <PanelHead icon="alert" title="Last error" />
          <pre className="code">{j.last_error}</pre>
        </section>
      ) : null}
      {j?.agent && j.prompt ? (
        <section className="panel">
          <PanelHead icon="bot" title="What the agent is told">
            <span className="sub">the job&apos;s prompt, word for word</span>
          </PanelHead>
          <pre className="code prose">{j.prompt}</pre>
        </section>
      ) : null}
      {j?.script_path ? (
        <section className="panel">
          <PanelHead icon="term" title="What the script does">
            <span className="sub mono">{j.script_path}</span>
          </PanelHead>
          <pre className="code">{j.script_body ?? "The script file is not on this machine."}</pre>
        </section>
      ) : null}
      {j && !historyless(j) && j.scheduler !== "launchd" ? (
        <section className="panel">
          <PanelHead icon="clock" title="Recent runs">
            <span className="count">{runs.length}</span>
          </PanelHead>
          <div className="wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Took</th>
                  <th>Result</th>
                  <th>Delivery</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {j ? (
                  runs.length ? (
                    runs.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{" "}
                          <span className="sub">{ago(r.at)}</span>
                        </td>
                        <td className="mono">{took(r)}</td>
                        <td>{r.status}</td>
                        <td className="sub">{r.delivery || "—"}</td>
                        <td className="err">{r.error || ""}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="sub">
                        No runs recorded.
                      </td>
                    </tr>
                  )
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
