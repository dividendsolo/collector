"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { securityChecks } from "@/lib/checks";
import {
  aiToasts,
  checkToasts,
  forgetFixed,
  githubToasts,
  noticeToasts,
  serviceToasts,
  sortToasts,
  visibleToasts,
} from "@/lib/toasts";
import { useAcks } from "./acks";
import { useAi } from "./ai";
import { useLive } from "./data";
import { useServices } from "./services";

/** The amber toasts dismissed in this browser: key -> the state it was dismissed in (localStorage, like the Needs
 * attention acknowledgements; Collector has no database). */
const KEY = "collector.toasts";
const EVENT = "collector-toasts";
let cache = "";
let held: Record<string, string> = {};
function dismissed(): Record<string, string> {
  const raw = typeof localStorage === "undefined" ? "{}" : localStorage.getItem(KEY) || "{}";
  if (raw !== cache) {
    cache = raw;
    try {
      const v = JSON.parse(raw);
      held = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      held = {};
    }
  }
  return held;
}
function onDismiss(cb: () => void) {
  addEventListener(EVENT, cb);
  addEventListener("storage", cb);
  return () => {
    removeEventListener(EVENT, cb);
    removeEventListener("storage", cb);
  };
}
const NONE: Record<string, string> = {};
function dismiss(key: string, state: string) {
  localStorage.setItem(KEY, JSON.stringify({ ...dismissed(), [key]: state }));
  dispatchEvent(new Event(EVENT));
}

/** The toasts, bottom right on every page: a service that is Slow or Down, and each machine's Security checks that
 * are not green. Red stays until fixed; amber has Dismiss, and comes back when its value changes. */
export function Toasts() {
  const services = useServices();
  const { state } = useLive();
  const gone = useSyncExternalStore(onDismiss, dismissed, () => NONE);
  const acks = useAcks();
  const { data: ai } = useAi();
  const machines = useMemo(
    () =>
      (state?.machines || []).map((m: any) => ({
        name: m.name,
        checks: securityChecks(m.name, m.network, m.network?.firewall?.tool === "macOS firewall"),
        notices: m.notices,
      })),
    [state?.machines],
  );
  const all = useMemo(
    () => [
      ...githubToasts(state?.github),
      ...noticeToasts(machines, acks),
      ...serviceToasts(services),
      ...checkToasts(machines),
      ...aiToasts(ai?.providers),
    ],
    [state?.github, services, machines, acks, ai],
  );
  // A fixed check forgets its dismissal, so the next time it breaks the toast shows again.
  useEffect(() => {
    if (!state) return;
    const kept = forgetFixed(gone, machines);
    if (Object.keys(kept).length !== Object.keys(gone).length) {
      localStorage.setItem(KEY, JSON.stringify(kept));
      dispatchEvent(new Event(EVENT));
    }
  }, [state, machines, gone]);
  const shown = useMemo(() => sortToasts(visibleToasts(all, gone)), [all, gone]);
  if (!shown.length) return null;
  return (
    <section className="toasts" aria-live="polite" aria-label="Alerts">
      {shown.map((t) => (
        <div
          key={t.key}
          className={`toast ${t.level}${t.noDot ? " no-dot" : ""}`}
          role={t.level === "error" ? "alert" : "status"}
        >
          {t.noDot ? null : <span className="toast-dot" />}
          <div className="toast-body">
            <a className="toast-title plain" href={t.href}>
              {t.title}
            </a>
            {t.text ? <div className="toast-text">{t.text}</div> : null}
          </div>
          {t.action ? (
            <a className="btn danger" href={t.action.url} target="_blank" rel="noopener">
              {t.action.label}
            </a>
          ) : null}
          {t.dismissible ? (
            <button className="btn ghost" type="button" onClick={() => dismiss(t.key, t.state)}>
              Dismiss
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
