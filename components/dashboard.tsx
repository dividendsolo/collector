"use client";

import { Fragment, useEffect, useState } from "react";
import { ago, fetchedText } from "@/lib/format";
import { jumpHref } from "@/lib/jump";
import { briefsRow, fullRepo, p0Rows, priorityOrder, TRIAGE_LANE, transitionNames, triageRow } from "@/lib/priority";
import { waitingList } from "@/lib/statuses";
import { transitionName, transitionOut } from "@/lib/view-transition";
import { acked, setAck, useAcks } from "./acks";
import { AiPlan, byAiOrder, useAi } from "./ai";
import { useBriefs } from "./briefs";
import { CardRef } from "./card-link";
import { useApi, useLive } from "./data";
import { GraphqlLimit, JogMinutes } from "./pages";
import { CurrentWork } from "./running";
import { ServiceHealthPanel, useServices } from "./services";
import { BlurText, BlurToggle, Icon, PanelHead, Pill, SkelPlans, SkelRows, SkelStat } from "./ui";
import { withViewTransition } from "./view-transition";

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

interface OpenFix {
  pane: string;
  step: string;
  state: "working" | "done" | "stuck";
  card?: { repo: string; number: number };
}
const useFixes = () => useApi<{ fixes: Record<string, OpenFix> }>("/api/debug-fix", 3_000);

function DebugFix({
  debug,
  label = "Debug and fix",
}: {
  debug:
    | { machine: string; id: string }
    | { triage: { repo: string; number: number } }
    | { unblock: { repo: string; number: number } }
    | { fixMain: { machine: string; repo: string } };
  label?: string;
}) {
  const { data, mutate } = useFixes();
  const key =
    "triage" in debug
      ? "triage"
      : "unblock" in debug
        ? `unblock/${debug.unblock.repo}#${debug.unblock.number}`
        : "fixMain" in debug
          ? `main/${debug.fixMain.machine}/${debug.fixMain.repo}`
          : `${debug.machine}/${debug.id}`;
  const open = data?.fixes?.[key];
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const click = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch("/api/debug-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(debug),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) await mutate();
      else setWhy(body.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  const close = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch("/api/debug-fix", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) await mutate();
      else setWhy(body.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  if (open) {
    const working = open.state === "working";
    const text = open.state === "stuck" ? "Stuck: needs you" : open.state === "done" ? "Done" : open.step;
    const title =
      open.state === "stuck"
        ? `The session needs you: read it in tmux pane ${open.pane}`
        : open.state === "done"
          ? `The session finished: read it in tmux pane ${open.pane}`
          : `Debug and fix is open in tmux pane ${open.pane}`;
    return (
      <>
        {why ? <span className="why">{why}</span> : null}
        <button className={`btn fixing ${open.state}`} type="button" disabled title={title}>
          {working ? <span className="spinner" aria-hidden="true" /> : null}
          <span className="step">{text}</span>
        </button>
        {working ? null : (
          <button className="btn" type="button" onClick={close} disabled={busy}>
            {busy ? "Closing…" : "Close"}
          </button>
        )}
      </>
    );
  }
  return (
    <>
      {why ? <span className="why">{why}</span> : null}
      <button className="btn" type="button" onClick={click} disabled={busy}>
        {busy ? "Opening…" : label}
      </button>
    </>
  );
}

const WAITING_FILTER = "lane";

export function PriorityRowText({ x }: { x: any }) {
  if (x.jump)
    return (
      <a className="plain row-link" href={`${jumpHref("dashboard", x.jump)}&${WAITING_FILTER}=${x.filter}`}>
        {x.text}
      </a>
    );
  if (x.href)
    return (
      <a className="plain row-link" href={x.href}>
        {x.text}
      </a>
    );
  if (x.url)
    return (
      <a className="plain" href={x.url} target="_blank" rel="noopener">
        {x.text}
      </a>
    );
  return <span>{x.text}</span>;
}

function nextRun(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function Since({ at }: { at?: number }) {
  return at ? (
    <span className="since" title={new Date(at * 1000).toLocaleString()}>
      {ago(at * 1000)}
    </span>
  ) : null;
}

function PriorityTasks() {
  const { state } = useLive();
  const [fixed, setFixed] = useState<{ post: string; at: number } | null>(null);
  const shown = fixed && state && state.at > fixed.at ? null : fixed;
  const acks = useAcks();
  const waiting = useWaiting();
  const triage = waiting ? triageRow(waiting.list) : null;
  const { data: briefs } = useBriefs();
  const unread = briefsRow(briefs?.inbox || []);
  const all: any[] = priorityOrder([
    ...(state?.warnings || []).filter((x: any) => !(shown && x.action?.post === shown.post)),
    ...(triage ? [triage] : []),
    ...p0Rows(waiting?.list || []),
    ...(unread ? [unread] : []),
  ]);
  const w = all.filter((x) => !acked(x, acks));
  const done = all.filter((x) => acked(x, acks));
  const names = new Map(transitionNames(all).map((n, i) => [all[i], n]));
  const hot = w.some((x) => x.level === "error");
  return (
    <section className="panel" id="attention">
      <PanelHead icon="alert" title="Priority tasks">
        <span className={`count${w.length && hot ? " hot" : ""}`}>{w.length}</span>
      </PanelHead>
      <div className="alerts">
        {!state ? (
          <div className="alert skel-row">
            <span className="skel w2" />
          </div>
        ) : w.length ? (
          w.map((x, i) => (
            <div className={`alert ${x.level}`} key={i} style={{ viewTransitionName: names.get(x) }}>
              <span className="n">{i + 1}</span>
              <Icon name="alert" />
              <PriorityRowText x={x} />
              {x.aside ? (
                <span className="aside">
                  <BlurText text={x.aside} />
                </span>
              ) : null}
              {x.action ? (
                <AlertAction action={x.action} done={() => setFixed({ post: x.action.post, at: Date.now() / 1000 })} />
              ) : x.unblock ? (
                <span className="act">
                  <DebugFix debug={{ unblock: x.unblock }} label="Unblock" />
                </span>
              ) : x.triage ? (
                <span className="act">
                  <DebugFix debug={{ triage: x.triage }} label="Triage" />
                </span>
              ) : x.fixMain ? (
                <span className="act">
                  <DebugFix debug={{ fixMain: x.fixMain }} />
                </span>
              ) : x.debug ? (
                <span className="act">
                  <DebugFix debug={x.debug} />
                </span>
              ) : x.ack ? (
                <span className="act">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => withViewTransition(() => setAck(x.ack.key, true))}
                  >
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
            Nothing in priority tasks.
            <a className="plain empty-next" href={jumpHref("dashboard", "waiting-panel")}>
              Waiting on you
            </a>
          </div>
        )}
        {state && done.length ? <hr className="acked-rule" /> : null}
        {state
          ? done.map((x) => (
              <div className="alert acked" key={x.ack.key} style={{ viewTransitionName: names.get(x) }}>
                <span className="n" />
                <Icon name="check" />
                <span>
                  {x.text}
                  <span className="note">
                    Acknowledged{x.ack.next ? `. Waiting for the next run, ${nextRun(x.ack.next)}` : ""}.
                  </span>
                </span>
                <span className="act">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => withViewTransition(() => setAck(x.ack.key, false))}
                  >
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
          [0, 1, 2, 3, 4].map((i) => <SkelStat key={i} />)
        ) : (
          <>
            <Stat label="Open cards" value={num(open)} />
            <Stat label="Closed today" value={num(d.closed_today)} href="#/closed" />
            <Stat label="Closed in 30 days" value={num(d.closed_30d)} />
            <Stat label="PRs merged today" value={num(d.merged_today)} sub={`${num(d.merged_30d)} in 30 days`} />
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

const Stat = ({ label, value, sub, href }: { label: string; value: string; sub?: React.ReactNode; href?: string }) => {
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </>
  );
  return href ? (
    <a className="stat" href={href}>
      {inner}
    </a>
  ) : (
    <div className="stat">{inner}</div>
  );
};

export function useWaiting() {
  const { board } = useLive();
  const d = board?.tickets;
  if (!d?.loaded) return null;
  const list = waitingList(d.tickets, d.each);
  const p0 = list.filter((t: any) => t.priority === "P0").length;
  return { d, list, p0 };
}

function ReleasePill({ t, done }: { t: any; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const release = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch("/api/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo: t.repo, number: t.number, from: t.lane }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) done();
      else setWhy(body.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <span className="release">
      <Pill cls={t.lane === "ready-for-human" ? "human" : "warning"} dot={false}>
        {t.lane}
        <button
          type="button"
          className="release-btn"
          onClick={release}
          disabled={busy}
          title="Ready for agent"
          aria-label={`Move ${t.repo}#${t.number} to ready-for-agent`}
        >
          <Icon name="check" />
        </button>
      </Pill>
      {why ? <span className="why">{why}</span> : null}
    </span>
  );
}

function TriagePill({ t }: { t: any }) {
  const card = { repo: fullRepo(t), number: Number(t.number) };
  const { data, mutate } = useFixes();
  const open = data?.fixes?.triage;
  const mine = open?.card?.repo === card.repo && open?.card?.number === card.number;
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const click = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch("/api/debug-fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ triage: card }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) await mutate();
      else setWhy(body.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  const title = !open
    ? "Interactive triage"
    : mine
      ? `Triaging ${card.repo}#${card.number} in tmux pane ${open.pane}`
      : "A triage session is open";
  return (
    <span className="release">
      <Pill cls="warning" dot={false}>
        {mine ? "triaging" : t.lane}
        <button
          type="button"
          className="release-btn"
          onClick={click}
          disabled={busy || Boolean(open)}
          title={title}
          aria-label={`Triage ${card.repo}#${card.number} with James`}
        >
          <Icon name="split" />
        </button>
      </Pill>
      {why ? <span className="why">{why}</span> : null}
    </span>
  );
}

export function Waiting() {
  const w = useWaiting();
  const [lane, setLane] = useState("all");
  useEffect(() => {
    const read = () => {
      const [page, query] = location.hash.split("?");
      if (!query) return;
      const params = new URLSearchParams(query);
      const want = params.get(WAITING_FILTER);
      if (!want) return;
      setLane(want);
      params.delete(WAITING_FILTER);
      const rest = params.toString();
      history.replaceState(null, "", rest ? `${page}?${rest}` : page);
    };
    read();
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const list = (w?.list || []).filter((t: any) => !gone.has(t.url));
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
      <div className="wrap scroll">
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
                  <tr key={t.url} style={{ viewTransitionName: transitionName("wait", fullRepo(t), t.number) }}>
                    <td>
                      {t.lane === TRIAGE_LANE ? (
                        <TriagePill t={t} />
                      ) : (
                        <ReleasePill t={t} done={() => transitionOut(() => setGone((g) => new Set(g).add(t.url)))} />
                      )}
                    </td>
                    <td>
                      <CardRef repo={t.repo} number={t.number} label={`${t.repo}#${t.number}`} />
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

function AiUsage() {
  const { data } = useAi();
  const rows: any[] = data?.providers || [];
  const plans = rows.filter((a) => a.kind !== "usage");
  const usage = rows.filter((a) => a.kind === "usage");
  return (
    <section className="panel">
      <PanelHead icon="gauge" title="AI usage">
        <span className="sub fetched" title={data?.at ? new Date(data.at * 1000).toLocaleString() : undefined}>
          {fetchedText(data?.at)}
        </span>
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

export function LimitsPanel() {
  const { state } = useLive();
  const g = state?.github;
  return (
    <section className="panel">
      <PanelHead icon="activity" title="Jog and GitHub limits">
        <a className="more" href="#/apis">
          All APIs &rarr;
        </a>
      </PanelHead>
      <div className="stats">
        {state ? <JogMinutes j={state.jog} /> : <div className="note sub">Reading Jog&hellip;</div>}
        <GraphqlLimit g={g} />
        {g?.error && !g.refused ? (
          <div className="stat">
            <span className="label">GraphQL (board reads)</span>
            <span className="sub">Could not read: {g.error}</span>
          </div>
        ) : null}
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
      <PriorityTasks />
      <CurrentWork />
      <WorkPanel />
      <Waiting />
      <LimitsPanel />
      <div className="pair">
        <AiUsage />
        <ServiceHealth />
      </div>
    </div>
  );
}
