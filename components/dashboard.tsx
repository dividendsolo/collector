"use client";

import { Fragment, useState } from "react";
import { ago } from "@/lib/format";
import { waitingList } from "@/lib/statuses";
import { acked, setAck, useAcks } from "./acks";
import { AiPlan, byAiOrder, useAi } from "./ai";
import { useApi, useLive } from "./data";
import { JogMinutes } from "./pages";
import { CurrentWork } from "./running";
import { ServiceHealthPanel, useServices } from "./services";
import { BlurText, BlurToggle, Icon, PanelHead, Pill, SkelPlans, SkelRows, SkelStat } from "./ui";

/** A row's one-click fix (Start Tailscale). A failure shows its reason beside the button; a fix that took calls
 * `done`, which hides the rows it fixed at once. */
function AlertAction({ action, done }: { action: { label: string; post: string }; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const click = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch(action.post, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (r.ok) done();
      else setWhy(body.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <span className="act">
      {why ? <span className="why">{why}</span> : null}
      <button className="btn" type="button" onClick={click} disabled={busy}>
        {busy ? "Starting…" : action.label}
      </button>
    </span>
  );
}

/** "Mon 9 Nov, 8:30 AM" in the browser's own time zone. */
function nextRun(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** How long ago a Needs attention row first showed up, the last column on the row (James, 2026-11-06). */
function Since({ at }: { at?: number }) {
  return at ? (
    <span className="since" title={new Date(at * 1000).toLocaleString()}>
      {ago(at * 1000)}
    </span>
  ) : null;
}

function NeedsAttention() {
  const { state } = useLive();
  // A one-click fix the server confirmed (Tailscale is running again): its rows hide at once and stay hidden until
  // a machine read newer than the click; if that read still fails, the rows come back (James, 2026-11-02).
  const [fixed, setFixed] = useState<{ post: string; at: number } | null>(null);
  const shown = fixed && state && state.at > fixed.at ? null : fixed;
  const acks = useAcks();
  const all: any[] = (state?.warnings || []).filter((x: any) => !(shown && x.action?.post === shown.post));
  // An acknowledged row leaves the count and moves under the open ones, dimmed, until its job runs again.
  const w = all.filter((x) => !acked(x, acks));
  const done = all.filter((x) => acked(x, acks));
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
              {x.action ? (
                <AlertAction action={x.action} done={() => setFixed({ post: x.action.post, at: Date.now() / 1000 })} />
              ) : x.ack ? (
                <span className="act">
                  <button className="btn" type="button" onClick={() => setAck(x.ack.key, true)}>
                    Acknowledge
                  </button>
                </span>
              ) : null}
              <Since at={x.since} />
            </div>
          ))
        ) : (
          <div className="empty">
            <Icon name="check" />
            Nothing needs attention.
          </div>
        )}
        {state
          ? done.map((x) => (
              <div className="alert acked" key={x.ack.key}>
                <span className="n" />
                <Icon name="check" />
                <span>
                  {x.text}
                  <span className="note">
                    Acknowledged{x.ack.next ? `. Waiting for the next run, ${nextRun(x.ack.next)}` : ""}.
                  </span>
                </span>
                <span className="act">
                  <button className="btn" type="button" onClick={() => setAck(x.ack.key, false)}>
                    Undo
                  </button>
                </span>
                <Since at={x.since} />
              </div>
            ))
          : null}
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
  // The waiting set is a setting (collector#53): `each` is it, in its own order, resolved by the server.
  const list = waitingList(d.tickets, d.each);
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
              <th>Status</th>
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
          [...plans, ...usage].sort(byAiOrder).map((a) => <AiPlan a={a} key={a.provider} />)
        ) : (
          <div className="note sub">No Hermes profiles found.</div>
        )}
      </div>
    </section>
  );
}

/** Jog runner minutes this month on the Dashboard, the same stat as on the APIs page, so the minutes that carry most
 * of our CI are in view before they run out. */
function JogPanel() {
  const { state } = useLive();
  return (
    <section className="panel">
      <PanelHead icon="activity" title="Jog minutes">
        <a className="more" href="#/apis">
          All APIs &rarr;
        </a>
      </PanelHead>
      <div className="stats">
        {state ? <JogMinutes j={state.jog} /> : <div className="note sub">Reading Jog&hellip;</div>}
      </div>
    </section>
  );
}

function ServiceHealth() {
  return <ServiceHealthPanel svc={useServices()} />;
}

export function Dashboard() {
  return (
    <div className="page">
      <CurrentWork />
      <NeedsAttention />
      <WorkPanel />
      <Waiting />
      <JogPanel />
      <div className="pair">
        <AiCredits />
        <ServiceHealth />
      </div>
    </div>
  );
}
