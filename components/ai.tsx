"use client";

import { useApi } from "./data";
import { BlurText, BlurToggle, PanelHead, SkelPlans, SkelRows } from "./ui";

const AI_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  nous: "Nous",
  minimax: "MiniMax",
  "kimi-coding": "Kimi",
  "xai-oauth": "Grok (xAI)",
};
const aiName = (slug: string) => AI_NAMES[slug] || slug;
const AI_ORDER = ["anthropic", "nous", "kimi-coding", "minimax", "xai-oauth"];
const aiRank = (slug: string) => {
  const i = AI_ORDER.indexOf(slug);
  return i < 0 ? AI_ORDER.length - 1 : i;
};
export const byAiOrder = (a: any, b: any) => aiRank(a.provider) - aiRank(b.provider);

export const useAi = () => useApi("/api/ai");

const Provider = ({ a }: { a: any }) =>
  a.link ? (
    <a className="plain" href={a.link} target="_blank" rel="noopener">
      {aiName(a.provider)}
    </a>
  ) : (
    aiName(a.provider)
  );

const Left = ({ a }: { a: any }) =>
  a.left ? (
    <span className={`mono${a.low ? " stuck" : ""}${a.left.startsWith("$") ? " money" : ""}`}>{a.left}</span>
  ) : (
    <span className="sub">—</span>
  );

function resets(iso: string) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const time = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const ahead = t.getTime() - Date.now();
  if (ahead < 864e5) return time;
  if (ahead > 6 * 864e5) return t.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${t.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** One provider: its usage windows as GitHub-limit style bars, a balance, or a note. */
export function AiPlan({ a }: { a: any }) {
  return (
    <div className="plan">
      <div className="plan-head">
        <span className="name">
          <Provider a={a} />
        </span>
        <span className="sub">
          {a.plan || ""}
          {a.plan ? " · " : ""}
          {a.profiles} {a.profiles === 1 ? "profile" : "profiles"}
        </span>
      </div>
      {a.windows?.length || a.kind === "usage" ? (
        <div className="stats">
          {(a.windows || []).map((w: any) => (
            <div className="stat" key={w.label}>
              <span className="label">{w.label}</span>
              <span className="value">
                {w.used}%{" "}
                <small>
                  used{w.resets ? ` · resets ${resets(w.resets)}` : ""}
                  {w.left ? ` · ${w.left}` : ""}
                </small>
              </span>
              {/* A bar keeps its provider's color at any usage (James, 2026-11-09): a low plan is the
                  notifications' job, not the panel's. */}
              <div className={`bar ${a.provider}`}>
                <span style={{ width: `${Math.min(100, w.used)}%` }} />
              </div>
            </div>
          ))}
          {a.kind === "usage" && !a.windows?.length ? (
            <div className="stat">
              <span className="label">Balance</span>
              <span className="value">
                <Left a={a} />
              </span>
              {a.detail ? (
                <span className="sub">
                  <BlurText text={a.detail} />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="note sub">{a.note || a.detail || ""}</div>
      )}
    </div>
  );
}

export function AiPanels() {
  const { data } = useAi();
  const rows: any[] = data?.providers || [];
  const plans = rows.filter((a) => a.kind !== "usage");
  const usage = rows.filter((a) => a.kind === "usage");
  return (
    <div className="pair">
      <section className="panel">
        <PanelHead icon="gauge" title="AI plans">
          <span className="count">{plans.length}</span>
          <span className="sub">subscriptions with usage limits</span>
        </PanelHead>
        <div className="plans">
          {!data ? (
            <SkelPlans />
          ) : plans.length ? (
            plans.map((a) => <AiPlan a={a} key={a.provider} />)
          ) : (
            <div className="note sub">No plan logins in the Hermes profiles.</div>
          )}
        </div>
      </section>
      <section className="panel">
        <PanelHead icon="gauge" title="AI usage">
          <span className="count">{usage.length}</span>
          <span className="sub">pay-as-you-go credits</span>
          <div className="tools">
            <BlurToggle />
          </div>
        </PanelHead>
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className="num">Profiles</th>
                <th className="num">Balance</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={1} cols={4} />
              ) : usage.length ? (
                usage.map((a) => (
                  <tr key={a.provider}>
                    <td>
                      <Provider a={a} />
                    </td>
                    <td className="num mono">{a.profiles}</td>
                    <td className="num">
                      <Left a={a} />
                    </td>
                    <td className="wide sub">
                      <BlurText text={a.detail || a.note || ""} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="sub">
                    No pay-as-you-go providers in the Hermes profiles.
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
