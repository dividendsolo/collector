"use client";

import { useEffect, useMemo, useRef } from "react";
import { networkToasts, newAlarms, serviceToasts, sortToasts } from "@/lib/toasts";
import { useLive } from "./data";
import { SCROLL_EVENT } from "./network";
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

/** The toasts, bottom right on every page: a service that is Slow or Down, and a machine with ports open to the
 * internet. No Dismiss: each stays until its problem is resolved. */
export function Toasts() {
  const services = useServices();
  const { state } = useLive();
  // Until both reads are in, a thing that is fine cannot be told from one not read yet: no alarm before then.
  const ready = services !== null && state !== null;
  const all = useMemo(
    () => [...serviceToasts(services), ...networkToasts(state?.machines)],
    [services, state?.machines],
  );
  const shown = useMemo(() => sortToasts(all), [all]);
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
        <div key={t.key} className={`toast ${t.level}`} role={t.level === "error" ? "alert" : "status"}>
          <span className="toast-dot" />
          <div className="toast-body">
            <a
              className="toast-title plain"
              href={t.href}
              onClick={(e) => {
                // Already on the page the link opens: the address would not change, so tell the page to scroll.
                const [page, query] = t.href.split("?");
                if (location.hash.split("?")[0] !== page || !query) return;
                e.preventDefault();
                dispatchEvent(
                  new CustomEvent(SCROLL_EVENT, { detail: new URLSearchParams(query).get("first") || "internet" }),
                );
              }}
            >
              {t.title}
            </a>
            <div className="toast-text">{t.text}</div>
          </div>
        </div>
      ))}
    </section>
  );
}
