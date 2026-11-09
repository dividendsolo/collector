"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { securityChecks } from "@/lib/checks";
import {
  aiToasts,
  checkToasts,
  forgetFixed,
  githubToasts,
  newAlarms,
  noticeToasts,
  serviceToasts,
  sortToasts,
  visibleToasts,
} from "@/lib/toasts";
import { useAcks } from "./acks";
import { useAi } from "./ai";
import { useLive } from "./data";
import { useServices } from "./services";

/** The alarm for a red toast: two short falling tones, made in the browser (no sound file). A browser plays no sound
 * before the first click or key on the page, so the alarm waits for that: an alarm asked for before it plays on the
 * first click or key (James, 2026-11-06), and every one after plays at once. */
let audio: AudioContext | null = null;
let unlocked = false;
let owed = false;

/** Ask for the alarm: now when the page has had its first click or key, else on that first click or key. */
function ring() {
  if (unlocked) alarm();
  else owed = true;
}

if (typeof window !== "undefined") {
  const unlock = () => {
    unlocked = true;
    removeEventListener("pointerdown", unlock, true);
    removeEventListener("keydown", unlock, true);
    if (owed) {
      owed = false;
      alarm();
    }
  };
  addEventListener("pointerdown", unlock, true);
  addEventListener("keydown", unlock, true);
}

function alarm() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const at = audio.currentTime;
    for (const [i, hz] of [880, 660].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "triangle";
      o.frequency.value = hz;
      const t = at + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.17);
    }
  } catch {
    // No Web Audio here: the toast is the alert.
  }
}

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
  // Until both reads are in, a thing that is fine cannot be told from one not read yet: no alarm before then.
  const ready = services !== null && state !== null;
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
  // One alarm per red toast this page has not sounded for yet, the ones showing at load included: those sound on the
  // first click or key, since the browser holds every sound until then.
  const heard = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!ready) return;
    if (newAlarms(shown, heard.current).length) ring();
    for (const t of shown) heard.current.add(`${t.key}|${t.state}`);
  }, [ready, shown]);
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
            <div className="toast-text">{t.text}</div>
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
