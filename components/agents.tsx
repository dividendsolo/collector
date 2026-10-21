"use client";

import { ago, doing, STATUS_RANK, schedule, shortRole, status } from "@/lib/format";
import { jobHref, useZones } from "./cron";
import { useLive } from "./data";
import { ModelCell, RunningNow, useRunning } from "./running";
import { Dash, PanelHead, SkelRows } from "./ui";

export interface Agent {
  name: string;
  model?: string;
  provider?: string;
  role?: string;
  last_session?: number;
  machine: string;
  busy: any[];
  cronJobs: any[];
  note: string;
}

/** Every Hermes profile per machine, A to Z by profile, then by machine. */
export function useAgents(): Agent[] | null {
  const { state } = useLive();
  const running = useRunning();
  if (!state || !running) return null;
  return state.machines
    .flatMap((m: any) =>
      (m.profiles || []).map((p: any) => {
        const sched = p.name === "default" ? "Hermes" : `Hermes (${p.name})`;
        return {
          ...p,
          machine: m.name,
          busy: running.filter((r) => r.machine === m.name && r.name === p.name),
          cronJobs: (m.jobs || []).filter((j: any) => j.scheduler === sched),
          note: state.agent_notes?.[p.name] || shortRole(p.role),
        };
      }),
    )
    .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name) || a.machine.localeCompare(b.machine));
}

/** The cron jobs a profile owns: the active ones, plus the paused ones in grey. */
function CronCount({ p }: { p: Agent }) {
  const on = p.cronJobs.filter((j) => j.enabled).length;
  const off = p.cronJobs.length - on;
  if (!p.cronJobs.length) return <Dash />;
  return (
    <>
      {on}
      {off ? (
        <>
          {" "}
          <span className="sub">+{off} paused</span>
        </>
      ) : null}
    </>
  );
}

const go = (href: string) => (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest("a")) location.hash = href;
};

export function AgentsPage() {
  const pool = useAgents();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Agents</h1>
        <p>What runs now, then every agent you can use.</p>
      </div>
      <RunningNow />
      <section className="panel">
        <PanelHead icon="bot" title="All agents">
          <span className="count">{pool?.length ?? 0}</span>
          <span className="sub">every Hermes profile on every machine</span>
        </PanelHead>
        <div className="wrap">
          <table className="fit pool">
            <thead>
              <tr>
                <th>Status</th>
                <th>Profile</th>
                <th>Note</th>
                <th>Type</th>
                <th>Model</th>
                <th>Machine</th>
                <th className="num">Cron jobs</th>
              </tr>
            </thead>
            <tbody>
              {!pool ? (
                <SkelRows n={8} cols={7} />
              ) : pool.length ? (
                pool.map((p) => {
                  const href = `#/agents/${p.machine}/${p.name}`;
                  return (
                    <tr className="row" key={`${p.machine}/${p.name}`} onClick={go(href)}>
                      <td>
                        {p.busy.length ? (
                          p.busy.map((r, i) => (
                            <span key={i}>
                              {i ? " " : ""}
                              <span className="pill agent">
                                #{r.card} {doing(r.kind)}
                              </span>
                            </span>
                          ))
                        ) : (
                          <span className="sub">Idle</span>
                        )}
                      </td>
                      <td>
                        <a className="plain mono" href={href}>
                          {p.name}
                        </a>
                      </td>
                      <td className="role">{p.note ? p.note : <span className="sub">No note yet</span>}</td>
                      <td>Hermes</td>
                      <td>
                        <ModelCell model={p.model} provider={p.provider} />
                      </td>
                      <td>{p.machine}</td>
                      <td className="num mono">
                        <CronCount p={p} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="sub">
                    No Hermes profiles found.
                  </td>
                </tr>
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

export function AgentPage({ machine, name }: { machine: string; name: string }) {
  const pool = useAgents();
  const zones = useZones();
  const a = pool?.find((p) => p.machine === machine && p.name === name);
  const jobs = a
    ? a.cronJobs
        .map((j) => ({ ...j, s: status(j) }))
        .sort(
          (x, y) =>
            STATUS_RANK[x.s as keyof typeof STATUS_RANK] - STATUS_RANK[y.s as keyof typeof STATUS_RANK] ||
            x.name.localeCompare(y.name),
        )
    : [];
  return (
    <div className="page">
      <div className="page-head">
        <div className="crumbs">
          <a href="#/agents">&larr; All agents</a>
        </div>
        <h1 className="mono-title">{name}</h1>
        <p>{a ? a.note || "" : "Loading…"}</p>
      </div>
      <section className="panel">
        <dl className="facts">
          {a && (
            <>
              <Fact label="Type">Hermes</Fact>
              <Fact label="Machine">{machine}</Fact>
              <Fact label="Model">{a.model ? <span className="mono">{a.model}</span> : "—"}</Fact>
              <Fact label="Provider">{a.provider || "—"}</Fact>
              <Fact label="Status">
                {a.busy.length
                  ? a.busy.map((r, i) => (
                      <span key={i}>
                        {i ? " " : ""}
                        <span className="pill agent">
                          #{r.card} {doing(r.kind)} · {r.repo}
                        </span>
                      </span>
                    ))
                  : "Idle"}
              </Fact>
              <Fact label="Last session">{a.last_session ? ago(new Date(a.last_session * 1000)) : "never"}</Fact>
            </>
          )}
        </dl>
      </section>
      <section className="panel">
        <PanelHead icon="bot" title="Role">
          <span className="sub">the first sentence of the profile&apos;s rules</span>
        </PanelHead>
        <div className="role-text">
          {a ? a.role ? a.role : <span className="sub">This profile uses the stock Hermes rules.</span> : null}
        </div>
      </section>
      <section className="panel">
        <PanelHead icon="clock" title="Cron jobs it runs" />
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Job</th>
                <th>Schedule</th>
                <th>Runs</th>
                <th>Last run</th>
                <th>Last result</th>
              </tr>
            </thead>
            <tbody>
              {a ? (
                jobs.length ? (
                  jobs.map((j) => (
                    <tr className={`row ${j.enabled ? "" : "off"}`} key={j.id} onClick={go(jobHref({ ...j, machine }))}>
                      <td>
                        <span className={`pill ${j.s.toLowerCase()}`}>
                          <span className="dot" />
                          {j.s}
                        </span>
                      </td>
                      <td>
                        <span className="mono">{j.name}</span>
                      </td>
                      <td>{schedule(j.schedule, zones.zone(j.machine), zones.first)}</td>
                      <td className="sub">{j.agent ? "agent" : "script"}</td>
                      <td className="sub">{ago(j.last_run_at)}</td>
                      <td>{j.last_status || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="sub">
                      This profile runs no cron jobs.
                    </td>
                  </tr>
                )
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
