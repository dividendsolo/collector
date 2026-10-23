"use client";

import { Fragment, useState } from "react";
import { ago, waitingOrder } from "@/lib/format";
import { AiPlan, useAi } from "./ai";
import { useApi, useLive } from "./data";
import { CurrentWork } from "./running";
import { ServiceRows, sortServices, useServices } from "./services";
import { BlurText, BlurToggle, Icon, PanelHead, Pill, SkelItems, SkelPlans, SkelRows, SkelStat } from "./ui";

function NeedsAttention() {
  const { state } = useLive();
  const w: any[] = state?.warnings || [];
  const hot = w.some((x) => x.level === "error"); // red only for errors
  return (
    <section className="panel" id="attention">
      <PanelHead icon="alert" title="Needs attention">
        <span className={`count${w.length && hot ? " hot" : ""}`}>{w.length}</span>
      </PanelHead>
      <div className="alerts">
        {!state ? (
          <div className="alert skel-row">
            <span className="skel w2" />
          </div>
        ) : w.length ? (
          w.map((x, i) => (
            <div className={`alert ${x.level}`} key={i}>
              <span className="n">{i + 1}</span>
              <Icon name="alert" />
              {x.url ? (
                <a className="plain" href={x.url} target="_blank" rel="noopener">
                  {x.text}
                </a>
              ) : (
                <span>{x.text}</span>
              )}
              {x.aside ? (
                <span className="aside">
                  <BlurText text={x.aside} />
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <div className="empty">
            <Icon name="check" />
            Nothing needs attention.
          </div>
        )}
      </div>
    </section>
  );
}

/** Work stats on the dashboard: open cards (live from the board), cards closed as done, and deploys today per repo. */
function WorkPanel() {
  const { data: d } = useApi("/api/work-stats");
  const { board } = useLive();
  const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
  const deployed = (d?.deploys || []).reduce((n: number, x: any) => n + x.n, 0);
  const open = board?.work?.loaded ? board.work.cards.length : d?.open;
  return (
    <section className="panel">
      <PanelHead icon="list" title="Work">
        <a className="more" href="#/work">
          All cards &rarr;
        </a>
      </PanelHead>
      <div className="stats" id="work-stats">
        {!d ? (
          [0, 1, 2, 3].map((i) => <SkelStat key={i} />)
        ) : (
          <>
            <Stat label="Open cards" value={num(open)} />
            <Stat label="Closed today" value={num(d.closed_today)} />
            <Stat label="Closed in 30 days" value={num(d.closed_30d)} />
            <Stat
              label="Deploys today"
              value={num(deployed)}
              sub={
                (d.deploys || []).length
                  ? (d.deploys || []).map((x: any, i: number) => (
                      <Fragment key={x.repo}>
                        {i ? " · " : ""}
                        <span>
                          {x.repo} {x.n}
                        </span>
                      </Fragment>
                    ))
                  : null
              }
            />
          </>
        )}
      </div>
    </section>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) => (
  <div className="stat">
    <span className="label">{label}</span>
    <span className="value">{value}</span>
    {sub ? <span className="sub">{sub}</span> : null}
  </div>
);

export function useWaiting() {
  const { board } = useLive();
  const d = board?.tickets;
  if (!d?.loaded) return null;
  const list = d.tickets.filter((t: any) => d.each.includes(t.lane)).sort(waitingOrder);
  const p0 = list.filter((t: any) => t.priority === "P0").length;
  return { d, list, p0 };
}

/** Waiting on you: every ticket in the "each" lanes, by priority, then lane (waitingOrder), then oldest. The chip counts only the P0s, in red. */
function Waiting() {
  const w = useWaiting();
  const [lane, setLane] = useState("all");
  const list = w?.list || [];
  const counts: [string, number][] = w
    ? w.d.count.map((l: string) => [l, w.d.tickets.filter((t: any) => t.lane === l).length]).filter(([, n]: any) => n)
    : [];
  const lanes: string[] = w ? w.d.each.filter((l: string) => list.some((t: any) => t.lane === l)) : [];
  const current = lane !== "all" && !lanes.includes(lane) ? "all" : lane;
  const shown = current === "all" ? list : list.filter((t: any) => t.lane === current);
  const p0 = w?.p0 ?? 0;
  return (
    <section className="panel" id="waiting-panel">
      <PanelHead icon="layers" title="Waiting on you">
        <span
          className="count hot"
          hidden={!p0}
          title={`${p0} P0 ${p0 === 1 ? "ticket waits" : "tickets wait"} on you`}
        >
          {p0}
        </span>
        <div className="tools">
          <div className="seg" id="waiting-filter">
            {w &&
              [
                ["all", "All", list.length] as const,
                ...lanes.map((l) => [l, l, list.filter((t: any) => t.lane === l).length] as const),
              ].map(([f, label, n]) => (
                <button key={f} type="button" aria-pressed={f === current} onClick={() => setLane(f)}>
                  {label} <span className="sub">{n}</span>
                </button>
              ))}
          </div>
        </div>
      </PanelHead>
      <div className="wrap">
        <table>
          <thead>
            <tr>
              <th>Lane</th>
              <th>Ticket</th>
              <th>Reason</th>
              <th>Type</th>
              <th>Priority</th>
              <th className="num">Opened</th>
            </tr>
          </thead>
          <tbody id="waiting">
            {!w ? (
              <SkelRows n={4} cols={6} />
            ) : shown.length || (current === "all" && counts.length) ? (
              <>
                {shown.map((t: any) => (
                  <tr key={t.url}>
                    <td>
                      <Pill cls={t.lane === "ready-for-human" ? "human" : "warning"} dot={false}>
                        {t.lane}
                      </Pill>
                    </td>
                    <td>
                      <a
                        className="plain mono card-tip"
                        href={t.url}
                        target="_blank"
                        rel="noopener"
                        data-repo={t.repo}
                        data-card={t.number}
                      >
                        {t.repo}#{t.number}
                      </a>
                    </td>
                    <td className="wide">
                      {t.reason ? (
                        <a className="plain" href={t.reason.url} target="_blank" rel="noopener">
                          {t.reason.text}
                        </a>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>{t.title}</span>
                      )}
                    </td>
                    <td>{t.type || "—"}</td>
                    <td>
                      {t.priority === "P0" ? (
                        <Pill cls="failed" dot={false}>
                          P0
                        </Pill>
                      ) : (
                        <span className="mono">{t.priority || "—"}</span>
                      )}
                    </td>
                    <td className="num">{ago(t.created)}</td>
                  </tr>
                ))}
                {current === "all" &&
                  counts.map(([l, n]) => (
                    <tr key={l}>
                      <td>
                        <Pill cls="ok" dot={false}>
                          {l}
                        </Pill>
                      </td>
                      <td colSpan={5} style={{ color: "var(--muted)" }}>
                        {n} {n === 1 ? "ticket" : "tickets"} wait for a triage session
                      </td>
                    </tr>
                  ))}
              </>
            ) : (
              <tr>
                <td colSpan={6} className="sub">
                  Nothing waits on you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AiCredits() {
  const { data } = useAi();
  const rows: any[] = data?.providers || [];
  const plans = rows.filter((a) => a.kind !== "usage");
  const usage = rows.filter((a) => a.kind === "usage");
  return (
    <section className="panel">
      <PanelHead icon="gauge" title="AI credits">
        <BlurToggle />
        <a className="more" href="#/subscriptions">
          All providers &rarr;
        </a>
      </PanelHead>
      <div id="ai-dash" className="plans">
        {!data ? (
          <SkelPlans />
        ) : rows.length ? (
          [...plans, ...usage].map((a) => <AiPlan a={a} key={a.provider} />)
        ) : (
          <div className="note sub">No Hermes profiles found.</div>
        )}
      </div>
    </section>
  );
}

function ServiceHealth() {
  const svc = useServices();
  const sorted = svc ? sortServices(svc) : null;
  const up = svc ? svc.filter((x) => x.status !== "down").length : 0;
  const avg = svc?.length ? Math.round(svc.reduce((n, x) => n + x.ms, 0) / svc.length) : 0;
  const slowest = svc?.length ? [...svc].sort((a, b) => b.ms - a.ms)[0] : null;
  return (
    <section className="panel">
      <PanelHead icon="server" title="Service health">
        <span className="count">{svc?.length ?? 0}</span>
        <a className="more" href="#/services">
          All services &rarr;
        </a>
      </PanelHead>
      <div className="spend-total" id="health-total">
        {svc ? (
          svc.length && slowest ? (
            <>
              <span className="value">
                {up} of {svc.length}
                <small>online</small>
              </span>
              <span className="sub">
                average {avg} ms · slowest {slowest.name} at {slowest.ms} ms
              </span>
            </>
          ) : (
            <span className="sub">No services in config.json yet.</span>
          )
        ) : null}
      </div>
      <ul className="health">{sorted ? <ServiceRows list={sorted.slice(0, 5)} /> : <SkelItems n={5} />}</ul>
    </section>
  );
}

export function Dashboard() {
  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <CurrentWork />
      <NeedsAttention />
      <WorkPanel />
      <Waiting />
      <div className="pair">
        <AiCredits />
        <ServiceHealth />
      </div>
    </div>
  );
}
