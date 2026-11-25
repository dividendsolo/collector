"use client";

import { Fragment, useState } from "react";
import { resetText } from "@/lib/format";
import { addQuestion, emptyNote, removalQuestion, removalRefusal } from "@/lib/providers";
import { useApi } from "./data";
import { useSide } from "./side";
import { BlurText, BlurToggle, Icon, PanelHead, SkelPlans, SkelRows } from "./ui";

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

const post = async (body: unknown) => {
  const r = await fetch("/api/ai-providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; why?: string; machines?: any[] };
};

const useCatalog = () => useApi<{ providers: any[]; machines: string[] }>("/api/ai-providers", 0);

export const written = (d: { machines?: any[] }) => {
  const machines = d.machines || [];
  const n = (key: string) => machines.reduce((t, m) => t + (m[key]?.length || 0), 0);
  const parts = [`${n("changed")} ${n("changed") === 1 ? "profile" : "profiles"} changed`];
  if (n("skipped")) parts.push(`${n("skipped")} skipped`);
  if (n("errors")) parts.push(`${n("errors")} failed`);
  return `${parts.join(", ")}.`;
};

export function RemoveX({ a, open, onToggle }: { a: any; open: boolean; onToggle: () => void }) {
  const mac = useSide() === "mac";
  if (!mac || !a.removal) return null;
  const name = aiName(a.provider);
  return (
    <button
      className="provider-x"
      type="button"
      aria-expanded={open}
      aria-label={`Remove ${name}`}
      title={`Remove ${name} from the profiles' fallbacks`}
      onClick={onToggle}
    >
      <Icon name="x" />
    </button>
  );
}

export function RemoveConfirm({ a, onClose }: { a: any; onClose: () => void }) {
  const { mutate } = useAi();
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [told, setTold] = useState("");
  const plan = a.removal;
  const name = aiName(a.provider);
  const refusal = removalRefusal(plan, name);
  const note = refusal || emptyNote(plan);
  const go = async () => {
    setBusy(true);
    setWhy("");
    const d = await post({ action: "remove", provider: a.provider });
    setBusy(false);
    if (d.ok) {
      setTold(`Removed ${name}: ${written(d)}`);
      await mutate();
      return;
    }
    setWhy(d.why || `Could not remove ${name}.`);
  };
  return (
    <div className="provider-confirm">
      <p className="ask">{removalQuestion(plan, name)}</p>
      {note ? <p className="sub">{note}</p> : null}
      {why ? (
        <p className="err" role="alert">
          {why}
        </p>
      ) : null}
      {told ? <p className="sub">{told}</p> : null}
      <div className="actions">
        <button className="btn ghost" type="button" onClick={onClose}>
          {told ? "Close" : "Cancel"}
        </button>
        <button className="btn danger" type="button" disabled={busy || !!refusal} onClick={go}>
          {busy ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}

export function AddProviderButton({ onClick }: { onClick: () => void }) {
  if (useSide() !== "mac") return null;
  return (
    <button className="btn ghost" type="button" onClick={onClick}>
      Add provider
    </button>
  );
}

export function AddProviderForm({ onClose }: { onClose: () => void }) {
  const { mutate } = useAi();
  const { data } = useCatalog();
  const list: any[] = data?.providers || [];
  const machines: string[] = data?.machines || [];
  const [pick, setPick] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const [told, setTold] = useState("");
  const models: string[] = list.find((p) => p.provider === pick)?.models || [];
  const go = async () => {
    setBusy(true);
    setWhy("");
    const d = await post({ action: "add", provider: pick, model });
    setBusy(false);
    if (d.ok) {
      setTold(`Added ${pick} / ${model}: ${written(d)}`);
      await mutate();
      return;
    }
    setWhy(d.why || `Could not add ${pick}.`);
  };
  return (
    <form
      className="fields provider-add"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label>
        Provider
        <select
          required
          value={pick}
          onChange={(e) => {
            setPick(e.target.value);
            setModel("");
            setTold("");
          }}
        >
          <option value="" disabled>
            {data ? "Choose a provider" : "Reading the list…"}
          </option>
          {list.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select required value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.length}>
          <option value="" disabled>
            {pick ? "Choose a model" : "Choose a provider first"}
          </option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {pick && model ? <p className="sub wide">{addQuestion(pick, model, machines)}</p> : null}
      {why ? (
        <p className="err wide" role="alert">
          {why}
        </p>
      ) : null}
      {told ? <p className="sub wide">{told}</p> : null}
      <div className="wide actions">
        <button className="btn ghost" type="button" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" type="submit" disabled={busy || !pick || !model}>
          {busy ? "Adding…" : "Add provider"}
        </button>
      </div>
    </form>
  );
}

export function AiPlan({ a }: { a: any }) {
  const [open, setOpen] = useState(false);
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
        <RemoveX a={a} open={open} onToggle={() => setOpen((v) => !v)} />
      </div>
      {a.windows?.length || (a.kind === "usage" && !a.note) ? (
        <>
          <div className={`stats${a.provider === "nous" ? " four" : ""}`}>
            {(a.windows || []).map((w: any) => (
              <div className="stat" key={w.label}>
                <span className="label">
                  <BlurText text={w.label} />
                </span>
                <span className="value">
                  {w.used}%{" "}
                  <small>
                    used{w.resets ? ` · resets ${resetText(w.resets)}` : ""}
                    {w.left ? (
                      <>
                        {" · "}
                        <BlurText text={w.left} />
                      </>
                    ) : null}
                  </small>
                </span>
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
          {a.kind === "usage" && a.windows?.length && a.detail ? (
            <div className="note sub">
              <BlurText text={a.detail} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="note sub">
          <BlurText text={a.note || a.detail || ""} />
        </div>
      )}
      {open ? <RemoveConfirm a={a} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

export function AiPanels() {
  const { data } = useAi();
  const rows: any[] = data?.providers || [];
  const plans = rows.filter((a) => a.kind !== "usage");
  const usage = rows.filter((a) => a.kind === "usage");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState("");
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
            <AddProviderButton onClick={() => setAdding(true)} />
            <BlurToggle />
          </div>
        </PanelHead>
        {adding ? <AddProviderForm onClose={() => setAdding(false)} /> : null}
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th className="num">Profiles</th>
                <th className="num">Balance</th>
                <th>Detail</th>
                <th aria-label="Fallbacks" />
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={1} cols={5} />
              ) : usage.length ? (
                usage.map((a) => (
                  <Fragment key={a.provider}>
                    <tr>
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
                      <td className="actions">
                        <RemoveX
                          a={a}
                          open={confirming === a.provider}
                          onToggle={() => setConfirming((c) => (c === a.provider ? "" : a.provider))}
                        />
                      </td>
                    </tr>
                    {confirming === a.provider ? (
                      <tr className="confirm-row">
                        <td colSpan={5}>
                          <RemoveConfirm a={a} onClose={() => setConfirming("")} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="sub">
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
