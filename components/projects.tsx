"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { ago, money, monthly, plural, runLabel } from "@/lib/format";
import { reposToSave } from "@/lib/repos";
import { useApi, useLive } from "./data";
import { SVC_LABEL, type Svc, useServices } from "./services";
import { BlurToggle, Icon, Money, PanelHead, SkelRows } from "./ui";

export const useProjects = () => useApi("/api/projects");

/** A project's live site comes from the server (p.live); its status pill comes from the last service check. */
function liveSite(p: any, services: Svc[]) {
  // Collector itself has no public site: it runs on this machine, at this page's own address.
  if (!p.live && !p.homepage && p.name === "collector")
    return { url: `http://localhost:${location.port}`, svc: undefined, local: true };
  const url: string = p.live || p.homepage || "";
  const svc = services.find((x) => x.url.replace(/\/$/, "") === url.replace(/\/$/, ""));
  return { url, svc, local: false };
}

const ciLabel = (c: any): [string, string] =>
  !c
    ? ["", "—"]
    : c.status !== "completed"
      ? ["agent", "Running"]
      : c.conclusion === "success"
        ? ["ok", "Passing"]
        : c.conclusion === "failure"
          ? ["failed", "Failing"]
          : ["warning", c.conclusion || "—"];

/** Production: the project has a live site on its own domain. Preview: the live site is only a *.vercel.app URL.
 * Development: no live site yet (Collector itself, on localhost, too). Archived: the repo is archived. Text only: the dot belongs to Health, which is live. */
function ProjectStatus({ p, live }: { p: any; live: { url: string; local: boolean } }) {
  if (p.archived) return <>Archived</>;
  if (/\.vercel\.app\/?$/.test(live.url)) return <span className="pill warning">Preview</span>;
  if (live.url && !live.local) return <>Production</>;
  return <span className="pill warning">Development</span>;
}

/** Lets a long name break after each separator (owner/<wbr>repo) instead of widening the table. */
const WrapAt = ({ text, sep }: { text: string; sep: string }) => (
  <>
    {text.split(sep).map((part, i, all) => (
      <Fragment key={i}>
        {part}
        {i < all.length - 1 ? (
          <>
            {sep}
            <wbr />
          </>
        ) : null}
      </Fragment>
    ))}
  </>
);

const Health = ({ svc }: { svc?: Svc }) =>
  svc ? (
    <span className={`pill ${SVC_LABEL[svc.status][0]}`}>
      <span className="dot" />
      {SVC_LABEL[svc.status][1]}
    </span>
  ) : (
    <span className="sub">—</span>
  );

function Picker({ onClose }: { onClose: () => void }) {
  const [repos, setRepos] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "start" });
    fetch("/api/repos?fresh=1")
      .then((r) => r.json())
      .then((d) => {
        // A to Z by repo name, so a repo is easy to find.
        setRepos(
          d.repos.sort((a: any, b: any) =>
            a.nameWithOwner
              .split("/")[1]
              .localeCompare(b.nameWithOwner.split("/")[1], undefined, { sensitivity: "base" }),
          ),
        );
        setChosen(new Set(d.chosen));
        requestAnimationFrame(() => search.current?.focus());
      })
      .catch((e) => setError(e.message));
  }, []);
  const query = q.trim().toLowerCase();
  const shown = (repos || []).filter(
    (r) =>
      !query || r.nameWithOwner.toLowerCase().includes(query) || (r.description || "").toLowerCase().includes(query),
  );
  const save = async () => {
    setSaving(true);
    try {
      // A to Z by repo name. Every chosen repo is saved, even one the list no longer shows.
      const list = reposToSave(chosen);
      const d = await (
        await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repos: list }),
        })
      ).json();
      mutate("/api/projects", d, { revalidate: false });
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel" id="picker" ref={box}>
      <PanelHead icon="layers" title="Choose repos">
        <span className="count">{chosen.size} chosen</span>
        <div className="tools">
          <input
            className="search"
            type="search"
            placeholder="Find a repo"
            aria-label="Find a repo"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            ref={search}
          />
          <button className="btn ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </PanelHead>
      <ul className="picks">
        {error ? (
          <li className="err">Could not read repos: {error}</li>
        ) : !repos ? (
          <li className="sub">Loading repos from GitHub…</li>
        ) : shown.length ? (
          shown.map((r) => (
            <li key={r.nameWithOwner}>
              <label>
                <input
                  type="checkbox"
                  value={r.nameWithOwner}
                  checked={chosen.has(r.nameWithOwner)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(r.nameWithOwner);
                    else next.delete(r.nameWithOwner);
                    setChosen(next);
                  }}
                />
                <span>
                  <span className="mono">{r.nameWithOwner}</span>
                  {r.isPrivate ? (
                    <>
                      {" "}
                      <span className="sub">private</span>
                    </>
                  ) : null}{" "}
                  {r.description ? <span className="desc">{r.description}</span> : null}
                </span>
              </label>
            </li>
          ))
        ) : (
          <li className="sub">No repo matches.</li>
        )}
      </ul>
    </section>
  );
}

export function ProjectsPage() {
  const { data } = useProjects();
  const services = useServices() || [];
  const [picking, setPicking] = useState(false);
  const list: any[] = data?.projects || [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <p>Each repo you chose and its live site. Open a project for its own page.</p>
      </div>
      <section className="panel">
        <PanelHead icon="layers" title="Projects">
          <span className="count">{list.length}</span>
          <span className="sub">{data?.at ? `read ${ago(new Date(data.at * 1000))}` : ""}</span>
          <div className="tools">
            <button className="btn" type="button" onClick={() => setPicking(true)}>
              Choose repos
            </button>
          </div>
        </PanelHead>
        <div className="wrap">
          <table className="fit">
            <thead>
              <tr>
                <th>Project</th>
                <th>Repo</th>
                <th>Type</th>
                <th>Status</th>
                <th>Hosting</th>
                <th>URL</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={6} cols={7} />
              ) : list.length ? (
                list.map((p) => {
                  if (p.error)
                    return (
                      <tr key={p.repo}>
                        <td className="mono">{p.repo}</td>
                        <td colSpan={6} className="err">
                          {p.error}
                        </td>
                      </tr>
                    );
                  const live = liveSite(p, services);
                  const hosting = live.svc?.hosting || p.hosting;
                  return (
                    <tr
                      className="row"
                      key={p.repo}
                      data-tip={p.description || undefined}
                      data-tip-title={p.title || p.name}
                      onClick={(e) => {
                        if (!(e.target as HTMLElement).closest("a")) location.hash = `#/projects/${p.repo}`;
                      }}
                    >
                      <td>
                        <a className="plain name" href={`#/projects/${p.repo}`}>
                          <b>{p.title || p.name}</b>
                        </a>
                        <Icon name="chev" className="i chev" />
                      </td>
                      <td>
                        <a className="plain mono" href={p.url} target="_blank" rel="noopener">
                          <WrapAt text={p.repo} sep="/" />
                        </a>
                      </td>
                      <td>{p.private ? "Private" : "Public"}</td>
                      <td>
                        <ProjectStatus p={p} live={live} />
                      </td>
                      <td>
                        {hosting ? hosting : live.url && !live.local ? "Self-hosted" : <span className="sub">—</span>}
                      </td>
                      <td>
                        {live.url ? (
                          <a className="plain" href={live.url} target="_blank" rel="noopener">
                            <WrapAt text={live.url.replace(/^https?:\/\//, "").replace(/\/$/, "")} sep="." />
                          </a>
                        ) : (
                          <span className="sub">—</span>
                        )}
                      </td>
                      <td>
                        <Health svc={live.svc} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>
                    <div className="soon">
                      <b>No projects chosen yet.</b>
                      <span>Choose the repos to show. Collector reads them through your gh login.</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {picking ? <Picker onClose={() => setPicking(false)} /> : null}
    </div>
  );
}

/** The stack in two columns: short rows pair up, and rows with 3 or more chips go last across both columns. */
function StackRows({ stack }: { stack: { category: string; items: string[] }[] }) {
  const rows = stack.filter((g) => g.category !== "Hosting"); // the strip at the top already shows hosting
  const short = rows.filter((g) => g.items.length < 3);
  const long = rows.filter((g) => g.items.length >= 3);
  const cell = (g: { category: string; items: string[] }, cls: string) => (
    <div className={cls} key={g.category}>
      <dt>{g.category}</dt>
      <dd>
        {g.items.map((x) => (
          <span className="chip" key={x}>
            {x}
          </span>
        ))}
      </dd>
    </div>
  );
  return (
    <>
      {short.map((g, i) => cell(g, i % 2 ? "" : i === short.length - 1 ? "wide" : "left"))}
      {long.map((g) => cell(g, "wide"))}
    </>
  );
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>
);

const Row = ({ label, v }: { label: string; v: [React.ReactNode, React.ReactNode] }) => (
  <div>
    <dt>{label}</dt>
    <dd>
      {v[0]}
      {v[1] ? (
        <>
          {" "}
          <span className="sub">{v[1]}</span>
        </>
      ) : null}
    </dd>
  </div>
);

const Cash = ({ n }: { n: number }) => <Money>{money(n)}</Money>;

export function ProjectPage({ repo }: { repo: string }) {
  const { data } = useProjects();
  const services = useServices() || [];
  const { state } = useLive();
  const p = (data?.projects || []).find((x: any) => x.repo === repo);
  const head = (
    <div className="page-head">
      <div className="crumbs">
        <a href="#/projects">&larr; All projects</a>
      </div>
      <h1>{p ? p.title || p.name : repo}</h1>
      <p>{p ? p.description || "" : "Loading…"}</p>
    </div>
  );
  if (!p || p.error)
    return (
      <div className="page">
        {head}
        <section className="panel">
          <dl className="facts">{p?.error ? <div className="err">{p.error}</div> : null}</dl>
        </section>
      </div>
    );
  const live = liveSite(p, services);
  const [cls, word] = ciLabel(p.ci);
  const agents = (state?.machines || []).flatMap((m: any) => m.running || []).filter((r: any) => r.repo === p.name);
  const subs: any[] = p.subscriptions || [];
  const spend = subs.filter((x) => (x.status || "active") === "active").reduce((t, x) => t + monthly(x), 0);
  const t = p.traffic || {};
  const b = p.billing || {};
  const why =
    t.error === "no token"
      ? "connect DataFast"
      : t.error === "not on DataFast"
        ? "site not on DataFast"
        : t.error || "";
  const df = (value: React.ReactNode, hint: React.ReactNode): [React.ReactNode, React.ReactNode] =>
    t.error ? ["—", why] : [value, hint];
  const keysNeedWork = b.mrr != null ? (b.missing?.length || 0) + (b.rejected?.length || 0) : 0;
  return (
    <div className="page">
      {head}
      <section className="panel">
        <dl className="facts">
          <Fact label="Repo">
            <a className="plain mono" href={p.url} target="_blank" rel="noopener">
              {p.repo}
            </a>
          </Fact>
          <Fact label="Type">{p.private ? "Private" : "Public"}</Fact>
          <Fact label="Status">
            <ProjectStatus p={p} live={live} />
          </Fact>
          <Fact label="Hosting">{live.svc?.hosting || p.hosting || (live.url ? "Self-hosted" : "—")}</Fact>
          <Fact label="URL">
            {live.url ? (
              <a className="plain" href={live.url} target="_blank" rel="noopener">
                {live.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Last push">
            <a
              className="plain"
              href={`${p.url}/commits`}
              target="_blank"
              rel="noopener"
              title={new Date(p.pushed_at).toLocaleString()}
            >
              {ago(p.pushed_at)}
            </a>
          </Fact>
          <Fact label="Open issues">
            <a className="plain" href={`${p.url}/issues`} target="_blank" rel="noopener">
              {p.issues}
            </a>
          </Fact>
          <Fact label="Open PRs">
            <a className="plain" href={`${p.url}/pulls`} target="_blank" rel="noopener">
              {p.prs}
            </a>
          </Fact>
          <Fact label="CI on main">
            {p.ci ? (
              <a className="plain" href={p.ci.url} target="_blank" rel="noopener">
                <span className={`pill ${cls}`}>
                  <span className="dot" />
                  {word}
                </span>
              </a>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Agent now">{agents.length ? agents.map((r: any) => runLabel(r)).join(", ") : "—"}</Fact>
          <Fact label="Health">
            {live.svc ? (
              <>
                <Health svc={live.svc} /> <span className="sub">{live.svc.ms} ms</span>
              </>
            ) : (
              "—"
            )}
          </Fact>
        </dl>
      </section>
      <div className="proj-grid">
        <section className="panel">
          <PanelHead icon="activity" title="Stats">
            <span className="sub">from Stripe, Polar, and DataFast</span>
            <div className="tools">
              <BlurToggle />
            </div>
          </PanelHead>
          <dl className="kv">
            <Row
              label="Monthly spend"
              v={[
                <Cash key="s" n={spend} />,
                subs.length ? subs.map((x) => x.name).join(", ") : "no subscription tagged",
              ]}
            />
            <Row
              label="MRR"
              v={[
                b.mrr != null ? <Cash n={b.mrr} /> : "—",
                b.mrr != null ? (
                  <>
                    {plural(b.subscribers, "active subscription")} · {b.providers.join(" + ")}
                    {keysNeedWork ? (
                      <>
                        {" · "}
                        <a href="#/keys">
                          {keysNeedWork} {keysNeedWork === 1 ? "key needs" : "keys need"} work
                        </a>
                      </>
                    ) : null}
                  </>
                ) : b.error ? (
                  <a href="#/keys">{b.error}</a>
                ) : (
                  "no payment provider in config.json"
                ),
              ]}
            />
            <Row
              label="ARR"
              v={[b.mrr != null ? <Cash n={b.mrr * 12} /> : "—", b.mrr != null ? "MRR × 12" : "needs MRR"]}
            />
            {b.revenue != null ? (
              <Row
                label="Total revenue"
                v={[<Cash key="r" n={b.revenue} />, `${plural(b.payments, "payment")} · ${b.providers.join(" + ")}`]}
              />
            ) : (
              <Row
                label="Total revenue"
                v={df(
                  <Cash n={t.revenue_total || 0} />,
                  `${plural(t.payments_total || 0, "payment")} · DataFast only, not complete`,
                )}
              />
            )}
            <Row label="Revenue, 30 days" v={df(<Cash n={t.revenue || 0} />, plural(t.payments || 0, "payment"))} />
            <Row label="Visitors, 30 days" v={df((t.visitors || 0).toLocaleString(), "")} />
            <Row label="Net, 30 days" v={df(<Cash n={(t.revenue || 0) - spend} />, "revenue minus spend")} />
          </dl>
        </section>
        <section className="panel">
          <PanelHead icon="layers" title="Tech stack">
            <span className="sub">read from the GitHub repo</span>
          </PanelHead>
          <dl className="stack-list two">
            {(p.stack || []).length ? (
              <StackRows stack={p.stack} />
            ) : (
              <div className="soon">
                <b>No stack found.</b>
                <span>Collector found no package.json or Gemfile it knows.</span>
              </div>
            )}
          </dl>
        </section>
      </div>
    </div>
  );
}

/** Stripe opens its restricted-key form with these fields filled in. */
const STRIPE_NEW_KEY =
  "https://dashboard.stripe.com/apikeys/create?name=Collector&permissions%5B%5D=rak_charge_read&permissions%5B%5D=rak_subscription_read";

function keySteps(k: any): React.ReactNode[] {
  if (k.provider === "stripe")
    return [
      k.note ? <>In Stripe, switch to {k.note}.</> : <>In Stripe, switch to the {k.project} account, in live mode.</>,
      <>
        Click{" "}
        <a href={STRIPE_NEW_KEY} target="_blank" rel="noopener">
          <b>Create the Collector key</b>
        </a>
        . The form opens with the name <b>Collector</b> and read access to <b>Charges</b> and <b>Subscriptions</b>. If a
        field is empty, set it like that.
      </>,
      <>
        Click <b>Create key</b>, then copy the key. It starts with <code>rk_live_</code>.
      </>,
      <>
        Paste it after <code>{k.key}=</code> in the file above, and save.
      </>,
    ];
  if (k.provider === "polar")
    return [
      <>
        Click{" "}
        <a href="https://polar.sh/to/dashboard/settings" target="_blank" rel="noopener">
          <b>Open Polar settings</b>
        </a>
        . It opens the settings of your {k.project} organization.
      </>,
      <>
        Under <b>Developers</b>, click <b>New token</b>. Name it <b>Collector</b>, with no expiration.
      </>,
      <>
        Choose the scopes <code>orders:read</code> and then <code>subscriptions:read</code>, in the order Polar lists
        them. Polar cannot fill these in from a link.
      </>,
      <>
        Create the token, then copy it. It starts with <code>polar_oat_</code>.
      </>,
      <>
        Paste it after <code>{k.key}=</code> in the file above, and save.
      </>,
    ];
  return [];
}

/** Payment keys: how to make each read-only key, and whether .env has it yet. Never the key itself. */
export function KeysPage() {
  const { data } = useProjects();
  const [copied, setCopied] = useState(false);
  const d = data || {};
  return (
    <div className="page">
      <div className="page-head">
        <div className="crumbs">
          <a href="#/projects">&larr; All projects</a>
        </div>
        <h1>Payment keys</h1>
        <p>
          MRR and total revenue come from each project&apos;s payment provider. Each provider needs one read-only key.
        </p>
      </div>
      <section className="panel">
        <PanelHead icon="receipt" title="Where the keys go" />
        <div className="steps-intro">
          Paste each key after its name in this file, then save it. Collector reads the file at once. The file stays out
          of git, and Collector never shows a key on this page.
          <div className="path">
            <code>{d.env_path || ".env"}</code>
            <button
              className="btn"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(d.env_path || ".env");
                  setCopied(true);
                } catch {}
              }}
            >
              {copied ? "Copied" : "Copy path"}
            </button>
          </div>
        </div>
      </section>
      <div id="key-cards">
        {(d.keys || []).length ? (
          d.keys.map((k: any) => (
            <section className="panel" key={`${k.repo}/${k.key}`}>
              <PanelHead icon="receipt" title={`${k.project} · ${k.provider === "stripe" ? "Stripe" : "Polar"}`}>
                <span className="sub mono">{k.key}</span>
                <div className="tools">
                  <span className={`pill ${k.refused ? "failed" : k.present ? "ok" : "warning"}`}>
                    <span className="dot" />
                    {k.refused ? "Refused" : k.present ? "Added" : "Missing"}
                  </span>
                </div>
              </PanelHead>
              <ol className="steps">
                {keySteps(k).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </section>
          ))
        ) : data ? (
          <section className="panel">
            <div className="soon">
              <b>No payment providers yet.</b>
              <span>Add a &quot;billing&quot; entry to config.json.</span>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
