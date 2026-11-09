"use client";

import { useEffect, useRef, useState } from "react";
import { daysAgo, money, monthly, prio } from "@/lib/format";
import { PROPOSAL_STATUSES, type Proposal, type ProposalStatus } from "@/lib/proposals";
import { vendorOrder } from "@/lib/vendors";
import { AiPanels } from "./ai";
import { useApi, useLive } from "./data";
import { BlurToggle, Count, Icon, Money, PanelHead, SkelItems, SkelRows } from "./ui";

// ---- Domains: registrar and expiry from the public registry, soonest first. Amber at 30 days, red at 7.

function DaysCell({ days, warnAt, failAt }: { days: number | null; warnAt: number; failAt: number }) {
  if (days == null) return <span className="sub">—</span>;
  const cls = days <= failAt ? "failed" : days <= warnAt ? "warning" : "";
  return cls ? <span className={`pill ${cls}`}>{days}</span> : days;
}

export function DomainsPage() {
  const { data: d } = useApi("/api/domains");
  const list: any[] = d ? [...d.domains].sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)) : [];
  const cf = d?.cloudflare || {};
  const needs = list.some((x) => x.registered && x.renew_source === "Cloudflare");
  const showKeys = d && needs && !(cf.present && !cf.error);
  const [cls, word] = cf.error ? ["failed", "Refused"] : cf.present ? ["ok", "Added"] : ["warning", "Missing"];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Domains</h1>
        <p>Each domain, its registrar, and when it expires.</p>
      </div>
      <section className="panel">
        <PanelHead icon="globe" title="Domains">
          <span className="count">{list.length}</span>
          <span className="sub">from the public registry (RDAP or whois), checked every 12 hours</span>
        </PanelHead>
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Domain</th>
                <th>Registrar</th>
                <th>Registered</th>
                <th>Expires</th>
                <th className="num">Days left</th>
                <th>Auto-renew</th>
                <th>HTTPS certificate</th>
                <th className="num">Days left</th>
              </tr>
            </thead>
            <tbody>
              {!d ? (
                <SkelRows n={4} cols={8} />
              ) : list.length ? (
                list.map((x) =>
                  x.registered ? (
                    <tr key={x.name}>
                      <td>
                        <a className="plain mono" href={`https://${x.name}`} target="_blank" rel="noopener">
                          {x.name}
                        </a>
                      </td>
                      <td>{x.registrar || "—"}</td>
                      <td className="mono">{x.since || "—"}</td>
                      <td className="mono">{x.expires}</td>
                      <td className="num mono">
                        <DaysCell days={x.days} warnAt={30} failAt={7} />
                      </td>
                      <td>
                        {x.auto_renew === true ? (
                          "On"
                        ) : x.auto_renew === false ? (
                          <span className="pill warning">Off</span>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td className="mono">{x.ssl_expires || "—"}</td>
                      <td className="num mono">
                        <DaysCell days={x.ssl_days} warnAt={14} failAt={14} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={x.name}>
                      <td className="mono">{x.name}</td>
                      <td colSpan={7}>
                        {x.error ? (
                          <span className="pill warning">{x.error}</span>
                        ) : (
                          <>
                            <span className="pill failed">Not registered</span>{" "}
                            <span className="sub">anyone can buy it</span>
                          </>
                        )}
                      </td>
                    </tr>
                  ),
                )
              ) : (
                <tr>
                  <td colSpan={8} className="sub">
                    No domains yet. Add them to &quot;domains&quot; in config.json.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {showKeys ? (
        <section className="panel" id="dom-keys">
          <div className="panel-head">
            <Icon name="globe" />
            <h2>Cloudflare key for auto-renew</h2>
            <span className="sub mono">{cf.key || "CLOUDFLARE_REGISTRAR_TOKEN"}</span>
            <div className="tools">
              <span className={`pill ${cls}`}>
                <span className="dot" />
                {word}
              </span>
            </div>
          </div>
          {cf.error ? <div className="err">{cf.error}</div> : null}
          <ol className="steps">
            <li>
              Open{" "}
              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">
                Cloudflare API tokens
              </a>{" "}
              and click <b>Create Token</b>.
            </li>
            <li>
              At the bottom, next to <b>Create Custom Token</b>, click <b>Get started</b>.
            </li>
            <li>
              Token name: <code>Collector</code>.
            </li>
            <li>
              Permissions: choose <b>Account</b>, then <b>Registrar: Domains</b>, then <b>Read</b>. Click{" "}
              <b>+ Add more</b> and choose <b>Account</b>, then <b>Account Settings</b>, then <b>Read</b>.
            </li>
            <li>
              Account Resources: <b>Include</b>, then your account.
            </li>
            <li>
              Click <b>Continue to summary</b>, then <b>Create Token</b>, and copy the token.
            </li>
            <li>
              Open <code>{d.env_path || ".env"}</code>, paste the token after{" "}
              <code>{cf.key || "CLOUDFLARE_REGISTRAR_TOKEN"}=</code> on its own line, and save. Collector reads the file
              at once.
            </li>
          </ol>
        </section>
      ) : null}
    </div>
  );
}

// ---- APIs: vendor status, the GitHub limit, X usage.

const VENDOR_PILL: Record<string, [string, string]> = {
  critical: ["failed", "Critical outage"],
  major: ["failed", "Major outage"],
  minor: ["warning", "Minor incident"],
  ok: ["ok", "Operational"],
};

export const useVendors = () => {
  const { data } = useApi("/api/vendors");
  // A vendor we depend heavily on that is showing an incident first, then the worst state, then by name
  // (collector#78). `vendorOrder` and `vendorHit` live in lib/vendors so the order can be tested.
  return data ? (vendorOrder(data.vendors) as any[]) : null;
};

/** An incident's age and where it is, from the vendor's own feed: "opened Sep 3, 2026 · last update Sep 3, 2026 ·
 * no update in 59 days · me-central-1 · me-south-1". Only what the feed gave: no date, no claim (card #46). */
function incidentWhen(i: any): string {
  const day = (iso?: string) =>
    iso && !Number.isNaN(Date.parse(iso))
      ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
      : null;
  const parts: string[] = [];
  const opened = day(i.opened);
  if (opened) parts.push(`opened ${opened}`);
  const updated = day(i.updated);
  if (updated) parts.push(`last update ${updated}`);
  if (i.stale) {
    const days = Math.floor((Date.now() - Date.parse(i.updated || i.opened)) / 864e5);
    parts.push(`no update in ${days} ${days === 1 ? "day" : "days"}`);
  }
  if (i.where?.length) parts.push(i.where.join(" · "));
  return parts.join(" · ");
}

function GithubLimit() {
  const { state } = useLive();
  const g = state?.github;
  const jog = <JogMinutes j={state?.jog} />;
  if (!g) return <div className="stats">{jog}</div>;
  if (g.error)
    return (
      <div className="stats">
        <div className="alert error">
          <Icon name="alert" />
          <span>{g.error}</span>
        </div>
        {jog}
      </div>
    );
  return (
    <div className="stats">
      {(["graphql", "core"] as const).map((k) => {
        const x = g[k];
        const reset = new Date(x.reset * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const pct = Math.round((x.used / x.limit) * 100);
        return (
          <div className="stat" key={k}>
            <span className="label">{k === "graphql" ? "GraphQL (board reads)" : "REST"}</span>
            <span className="value">
              {x.used.toLocaleString()}{" "}
              <small>
                of {x.limit.toLocaleString()} used · resets {reset}
              </small>
            </span>
            <div className={`bar ${pct > 90 ? "low" : ""}`}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <ActionsMinutes a={g.actions} />
      {jog}
    </div>
  );
}

/** GitHub Actions minutes this month against the plan's included minutes; past them, GitHub bills each minute. */
function ActionsMinutes({ a }: { a?: any }) {
  if (!a) return null;
  if (a.error)
    return (
      <div className="stat">
        <span className="label">Actions minutes</span>
        <span className="sub">Could not read: {a.error}</span>
      </div>
    );
  const pct = Math.min(100, Math.round((a.used / a.limit) * 100));
  const reset = new Date(a.reset * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div className="stat">
      <span className="label">Actions minutes (this month)</span>
      <span className="value">
        {a.used.toLocaleString()}{" "}
        <small>
          of {a.limit.toLocaleString()} included · resets {reset}
        </small>
      </span>
      <div className={`bar ${pct >= 90 ? "low" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Jog runner minutes this month (usejog.com) against the free minutes the accounts include. A failed read says why,
 * like the Actions stat. No dollar figure: a token cannot read the account's credit balance, and the runs' own cost
 * is Jog's list price for them, which the free minutes cover. */
export function JogMinutes({ j }: { j?: any }) {
  if (!j) return null;
  if (j.error)
    return (
      <div className="stat">
        <span className="label">Jog minutes</span>
        <span className="sub">Could not read: {j.error}</span>
      </div>
    );
  const pct = Math.min(100, Math.round((j.used / j.limit) * 100));
  const reset = new Date(j.reset * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div className="stat">
      <span className="label">Jog minutes (this month)</span>
      <span className="value">
        {j.used.toLocaleString()}{" "}
        <small>
          of {j.limit.toLocaleString()} free · resets {reset}
        </small>
      </span>
      <div className={`bar ${pct >= 90 ? "low" : ""}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** X API: posts read this month against the project cap; the cap resets on the same day each month. */
function XUsage({ x }: { x: any }) {
  if (x.error)
    return (
      <div className="stats">
        <div className="alert error">
          <Icon name="alert" />
          <span>{x.error}</span>
        </div>
      </div>
    );
  const pct = x.limit ? Math.round((x.used / x.limit) * 100) : 0;
  const now = new Date();
  const reset = new Date(now.getFullYear(), now.getMonth() + (now.getDate() >= x.reset_day ? 1 : 0), x.reset_day);
  const c = x.credits || {};
  const usd = (n: number) => <Money>${(+n).toFixed(2)}</Money>;
  return (
    <div className="stats">
      {c.total == null ? null : (
        <div className="stat">
          <span className="label">Credits left</span>
          <span className={`value${c.total < 5 ? " stuck" : ""}`}>
            {usd(c.total)}{" "}
            <small>
              {usd(c.prepaid || 0)} prepaid + {usd(c.free || 0)} free
              {c.free_expires
                ? ` (expires ${new Date(c.free_expires).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })})`
                : ""}
            </small>
          </span>
        </div>
      )}
      <div className="stat">
        <span className="label">Posts read this month</span>
        <span className="value">
          <Money>{x.used.toLocaleString()}</Money>{" "}
          <small>
            of <Money>{x.limit.toLocaleString()}</Money> · resets{" "}
            {reset.toLocaleDateString([], { month: "short", day: "numeric" })}
          </small>
        </span>
        <div className={`bar ${pct > 90 ? "low" : ""}`}>
          <span style={{ width: `${Math.max(pct, x.used ? 1 : 0)}%` }} />
        </div>
      </div>
    </div>
  );
}

export function ApisPage() {
  const list = useVendors();
  const { state } = useLive();
  return (
    <div className="page">
      <div className="page-head">
        <h1>APIs</h1>
        <p>The outside services your jobs depend on: whether they are up, and how much of each is left.</p>
      </div>
      <section className="panel">
        <PanelHead icon="server" title="Vendor status">
          <span className="count">{list?.length ?? 0}</span>
          <span className="sub" style={{ marginLeft: 8 }}>
            from each vendor&apos;s status page, checked every 5 minutes
          </span>
        </PanelHead>
        <ul className="health">
          {!list ? (
            <SkelItems n={8} />
          ) : list.length ? (
            list.map((v) => {
              const pill = VENDOR_PILL[v.state];
              return (
                <li key={v.name}>
                  <div>
                    <div className="name">
                      {v.name}
                      {/* How much we depend on it, from config.json (collector#78): the page puts a high or critical
                          one with an incident first, and the pill is the reason why. */}
                      {v.criticality ? (
                        <>
                          {" "}
                          <span className="pill">{v.criticality}</span>
                        </>
                      ) : null}
                    </div>
                    <div className="sub">
                      <a href={v.url} target="_blank" rel="noopener">
                        {v.url.replace(/^https?:\/\//, "")}
                      </a>
                    </div>
                    {v.incidents.map((i: any, k: number) => {
                      // An incident with no update in a week is stale: still listed, with its age and where it is,
                      // but it is not what the vendor is doing today (card #46, the Atlas me-central-1 notice).
                      const when = incidentWhen(i);
                      return (
                        <div key={k}>
                          <div className="sub">
                            <a href={i.url} target="_blank" rel="noopener">
                              {i.name}
                            </a>{" "}
                            · {i.impact}
                          </div>
                          {when ? (
                            <div className="sub">
                              {i.stale ? <span className="pill warning">Stale</span> : null} {when}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="right">
                    {pill ? (
                      <span className={`pill ${pill[0]}`}>
                        <span className="dot" />
                        {pill[1]}
                      </span>
                    ) : (
                      <span className="sub">No status feed</span>
                    )}
                  </div>
                </li>
              );
            })
          ) : (
            <li>
              <div className="sub">No vendors in config.json yet.</div>
            </li>
          )}
        </ul>
      </section>
      <section className="panel" id="github-limit">
        <PanelHead icon="gauge" title="GitHub limits" />
        <GithubLimit />
      </section>
      {state?.x ? (
        <section className="panel" id="x-limit">
          <PanelHead icon="gauge" title="X API usage">
            <span className="sub">developer.x.com, Situation&apos;s X wire</span>
            <div className="tools">
              <BlurToggle />
            </div>
          </PanelHead>
          <XUsage x={state.x} />
        </section>
      ) : null}
    </div>
  );
}

// ---- Subscriptions: the AI panels, then what you pay for, largest first.

const M = ({ n, cur }: { n: number; cur?: string }) => <Money>{money(n, cur || "USD")}</Money>;

export function SubscriptionsPage() {
  const { state } = useLive();
  const subs: any[] = state?.subscriptions || [];
  const active = subs.filter((x) => (x.status || "active") === "active");
  const totals: Record<string, number> = {};
  for (const x of active) totals[x.currency || "USD"] = (totals[x.currency || "USD"] || 0) + monthly(x);
  const sorted = [...active].sort((a, b) => monthly(b) - monthly(a));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Subscriptions</h1>
        <p>What you pay for, largest first. Annual charges count as one twelfth a month.</p>
      </div>
      <AiPanels />
      <section className="panel">
        <PanelHead icon="receipt" title="Subscriptions">
          <span className="count">{active.length}</span>
          <span className="sub">from config.json</span>
          <div className="tools">
            <BlurToggle />
          </div>
        </PanelHead>
        <div className="wrap">
          <table className="subs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Billing</th>
                <th>Renews</th>
                <th className="num">Charge</th>
                <th className="num">Per month</th>
                <th className="num">Per year</th>
              </tr>
            </thead>
            <tbody>
              {!state ? (
                <SkelRows n={6} cols={6} />
              ) : sorted.length ? (
                sorted.map((x, i) => (
                  <tr key={`${x.name}-${i}`}>
                    <td>{x.name}</td>
                    <td>{x.billing === "annual" ? "Annual" : "Monthly"}</td>
                    {/* The day it renews, as config.json writes it (`subscriptions[].renews`, collector#78).
                        Collector warns in Needs attention inside the last week before it. */}
                    <td className="mono">{x.renews || <span className="sub">—</span>}</td>
                    <td className="num mono">
                      <M n={x.amount} cur={x.currency} />
                    </td>
                    <td className="num mono">
                      <M n={monthly(x)} cur={x.currency} />
                    </td>
                    <td className="num mono">
                      <M n={monthly(x) * 12} cur={x.currency} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="soon">
                      <b>No subscriptions yet.</b>
                      <span>Add them to config.json under &quot;subscriptions&quot;.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              {Object.entries(totals).map(([cur, n]) => (
                <tr className="total" key={cur}>
                  <td>Total{Object.keys(totals).length > 1 ? ` (${cur})` : ""}</td>
                  <td />
                  <td />
                  <td />
                  <td className="num mono">
                    <M n={n} cur={cur} />
                  </td>
                  <td className="num mono">
                    <M n={n * 12} cur={cur} />
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---- Work: the heat map, then every open card on the board (pushed live), in lane order, then priority, then oldest.

const LEVEL: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

/** The GitHub heat map: one square per day for the last year, a column per week, darker for more contributions. */
function HeatMap() {
  const { data: d } = useApi("/api/work-stats");
  const c = d?.contributions;
  if (d && !c) return null;
  const months: string[] = c
    ? c.weeks.map((w: any, k: number) => {
        const first = new Date(`${w[0][0]}T12:00`);
        const prev = k ? new Date(`${c.weeks[k - 1][0][0]}T12:00`) : null;
        return prev && first.getMonth() !== prev.getMonth() ? first.toLocaleDateString([], { month: "short" }) : "";
      })
    : [];
  return (
    <section className="panel">
      <PanelHead icon="activity" title="GitHub contributions">
        <span className="sub">{c ? `${c.total.toLocaleString()} in the last year` : ""}</span>
        <a className="more" href="https://github.com" target="_blank" rel="noopener">
          GitHub &rarr;
        </a>
      </PanelHead>
      <div className="heat" style={c ? ({ "--weeks": c.weeks.length } as React.CSSProperties) : undefined}>
        {c ? (
          <>
            <div className="months">
              {months.map((m, i) => (
                <span key={i}>{m}</span>
              ))}
            </div>
            <div className="grid">
              {c.weeks.map((w: any[], k: number) => (
                <WeekCells key={k} w={w} pad={k ? 0 : new Date(`${w[0][0]}T12:00`).getDay()} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

const WeekCells = ({ w, pad }: { w: any[]; pad: number }) => (
  <>
    {Array.from({ length: pad }, (_, i) => (
      <i key={`p${i}`} style={{ visibility: "hidden" }} />
    ))}
    {w.map(([day, n, l]: [string, number, string]) => (
      <i key={day} data-l={LEVEL[l] || 0} title={`${n} ${n === 1 ? "contribution" : "contributions"} on ${day}`} />
    ))}
  </>
);

export function WorkPage() {
  const { board } = useLive();
  const d = board?.work;
  // Priority first (P0, P1, P2, none), then lane order, then oldest.
  const rank = (t: any) => prio(t.priority) * 100 + d.lanes.indexOf(t.lane);
  const cards: any[] = d?.loaded
    ? [...d.cards].sort((a, b) => rank(a) - rank(b) || (a.created || "").localeCompare(b.created || ""))
    : [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Work</h1>
      </div>
      <HeatMap />
      <section className="panel">
        <PanelHead icon="list" title="Open cards">
          <span className="count">{cards.length}</span>
          <span className="sub">
            {d?.error ? `Some statuses did not load: ${d.error}` : "every open card, by status"}
          </span>
        </PanelHead>
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Repo</th>
                <th>Card</th>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Labels</th>
                <th className="num">Opened</th>
              </tr>
            </thead>
            <tbody>
              {!d?.loaded ? (
                <SkelRows n={8} cols={7} />
              ) : cards.length ? (
                cards.map((t) => (
                  <tr key={t.url}>
                    <td>{t.repo}</td>
                    <td className="mono">
                      <a
                        className="plain card-tip"
                        href={t.url}
                        target="_blank"
                        rel="noopener"
                        data-repo={t.repo}
                        data-card={t.number}
                      >
                        #{t.number}
                      </a>
                    </td>
                    <td className="wide">{t.title}</td>
                    <td>
                      <span className="pill">{t.lane}</span>
                    </td>
                    <td>
                      {t.priority === "P0" ? (
                        <span className="pill failed">P0</span>
                      ) : (
                        <span className="mono">{t.priority || "—"}</span>
                      )}
                    </td>
                    <td className="sub">{(t.labels || []).join(", ") || "—"}</td>
                    <td className="num">{daysAgo(t.created)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="sub">
                    No open cards.
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

// ---- Proposals: what is out with clients, and the open pipeline (collector#77). The rows live in proposals.json
// beside config.json, and the route parses every field, so this page only has to render text.

const STATUS_PILL: Record<ProposalStatus, [string, string]> = {
  draft: ["", "Draft"],
  pending: ["warning", "Pending"],
  approved: ["ok", "Approved"],
  rejected: ["failed", "Rejected"],
  signed: ["signed", "Signed"],
};

/** The form's own state: a date is the input's empty string until it has a day. */
interface Draft {
  id?: string;
  client: string;
  title: string;
  amount: string;
  currency: string;
  status: ProposalStatus;
  sent_at: string;
  decided_at: string;
  notes: string;
}

const BLANK: Draft = {
  client: "",
  title: "",
  amount: "",
  currency: "USD",
  status: "draft",
  sent_at: "",
  decided_at: "",
  notes: "",
};

const asDraft = (p: Proposal): Draft => ({
  id: p.id,
  client: p.client,
  title: p.title,
  amount: String(p.amount),
  currency: p.currency,
  status: p.status,
  sent_at: p.sent_at || "",
  decided_at: p.decided_at || "",
  notes: p.notes,
});

/** Add a proposal, or change the one being edited: the same form, and the route refuses what it will not store. */
function ProposalForm({ draft, onSaved, onCancel }: { draft: Draft; onSaved: (d: any) => void; onCancel: () => void }) {
  const [f, setF] = useState<Draft>(draft);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLElement>(null);
  // A block body on purpose: `scrollIntoView` returns an object in Chrome, and an arrow that returns it hands React a
  // cleanup it then calls as a function (the form is unmounted on save, so that is the crash a reader would see).
  useEffect(() => {
    box.current?.scrollIntoView({ block: "start" });
  }, []);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      client: f.client,
      title: f.title,
      amount: f.amount.trim() === "" ? Number.NaN : Number(f.amount),
      currency: f.currency,
      status: f.status,
      sent_at: f.sent_at || null,
      decided_at: f.decided_at || null,
      notes: f.notes,
    };
    try {
      const r = await fetch("/api/proposals", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft.id ? { ...body, id: draft.id } : body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.why || `HTTP ${r.status}`);
        return;
      }
      onSaved(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel" id="proposal-form" ref={box}>
      <PanelHead icon="brief" title={draft.id ? "Edit proposal" : "Add proposal"} />
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label>
          Client
          <input required maxLength={100} value={f.client} onChange={set("client")} />
        </label>
        <label>
          Title
          <input required maxLength={100} value={f.title} onChange={set("title")} />
        </label>
        <label>
          Amount
          <input required inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="5000" />
        </label>
        <label>
          Currency
          <input required maxLength={3} value={f.currency} onChange={set("currency")} />
        </label>
        <label>
          Status
          <select value={f.status} onChange={set("status")}>
            {PROPOSAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_PILL[s][1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sent
          <input type="date" value={f.sent_at} onChange={set("sent_at")} />
        </label>
        <label>
          Decided
          <input type="date" value={f.decided_at} onChange={set("decided_at")} />
        </label>
        <label className="wide">
          Notes
          <textarea maxLength={1000} rows={2} value={f.notes} onChange={set("notes")} />
        </label>
        {error ? (
          <p className="err wide" role="alert">
            {error}
          </p>
        ) : null}
        <div className="wide actions">
          <button className="btn ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save proposal"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ProposalsPage() {
  const { data, mutate } = useApi("/api/proposals");
  const [form, setForm] = useState<Draft | null>(null);
  const list: Proposal[] = data?.proposals || [];
  const open: { currency: string; total: number }[] = data?.pipeline || [];
  const saved = (d: any) => {
    mutate(d, { revalidate: false });
    setForm(null);
  };
  const remove = async (p: Proposal) => {
    if (!confirm(`Delete "${p.title}" for ${p.client}?`)) return;
    const r = await fetch(`/api/proposals?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    const d = await r.json();
    if (r.ok) mutate(d, { revalidate: false });
    else alert(d.why || `HTTP ${r.status}`);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Proposals</h1>
        <p>Open client proposals and their value. Kept on this machine, in proposals.json.</p>
      </div>
      <section className="panel">
        <PanelHead icon="brief" title="Proposals">
          <Count n={list.length} />
          <span className="sub">kept in proposals.json beside config.json</span>
          <div className="tools">
            <button className="btn" type="button" onClick={() => setForm(BLANK)}>
              Add proposal
            </button>
          </div>
        </PanelHead>
        {data?.why ? (
          <p className="err wide" role="alert">
            {data.why}
          </p>
        ) : null}
        <div className="spend-total">
          {!data ? null : open.length ? (
            open.map((c) => (
              <span className="value" key={c.currency}>
                <Money>{money(c.total, c.currency)}</Money>
                <small>open pipeline in {c.currency}</small>
              </span>
            ))
          ) : (
            <span className="sub">Nothing open with a client yet.</span>
          )}
        </div>
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Title</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Decided</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={4} cols={8} />
              ) : list.length ? (
                list.map((p) => (
                  <tr key={p.id}>
                    <td>{p.client}</td>
                    <td className="wide">{p.title}</td>
                    <td className="num mono">
                      <Money>{money(p.amount, p.currency)}</Money>
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[p.status][0]}`.trim()}>
                        <span className="dot" />
                        {STATUS_PILL[p.status][1]}
                      </span>
                    </td>
                    <td className="mono">{p.sent_at || "—"}</td>
                    <td className="mono">{p.decided_at || "—"}</td>
                    <td className="notes">
                      {p.notes ? (
                        <span className="clamp" title={p.notes}>
                          {p.notes}
                        </span>
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                    <td className="actions">
                      <button
                        className="btn ghost"
                        type="button"
                        aria-label={`Edit ${p.title}`}
                        onClick={() => setForm(asDraft(p))}
                      >
                        Edit
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => remove(p)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>
                    <div className="soon">
                      <b>No proposals yet.</b>
                      <span>Add the first one: its client, its title and what it is worth.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {/* A key per draft: the form copies its draft once, so Edit on another row (or Add) must mount a fresh one. */}
      {form ? (
        <ProposalForm key={form.id ?? "new"} draft={form} onSaved={saved} onCancel={() => setForm(null)} />
      ) : null}
    </div>
  );
}
