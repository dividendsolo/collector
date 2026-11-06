"use client";

import { useCallback, useEffect, useState } from "react";
import type { Update } from "@/lib/update";
import { clearUpdating, downText, markUpdating } from "@/lib/updating";

/** The server's answer to `GET /api/update`, or null when it did not answer. */
const askServer = async (): Promise<Update | null> => {
  try {
    const r = await fetch("/api/update", { cache: "no-store" });
    return r.ok ? ((await r.json()) as Update) : null;
  } catch {
    return null;
  }
};

/**
 * The Update button (card #41): the rebuild job builds a newer main into `.next-rebuild` and stops there, so the page
 * stays up until someone clicks. One click puts the new build in service: the server hands the swap and the restart
 * to `scripts/apply-update.ts`, and this page reloads itself when `/api/version` moves — once the server is back on
 * the new build, never while the served build is away for the restart.
 */
export function UpdateButton() {
  const [state, setState] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  // Every half minute, like the rest of the page's reads: a build that lands on main shows here within one rebuild
  // interval (five minutes) plus this wait.
  useEffect(() => {
    let stop = false;
    const ask = async () => {
      const next = await askServer();
      if (next && !stop) setState(next);
    };
    ask();
    const t = setInterval(ask, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // The note for a server that stays away: the version poll reloads the page when it is back on the new build.
  const giveUpLater = useCallback(() => {
    window.setTimeout(async () => {
      setState(await askServer());
      setSaid("The Collector server has not come back on the new build. Reload this page.");
      setBusy(false);
    }, 60_000);
  }, []);

  const click = useCallback(async () => {
    setBusy(true);
    setSaid("");
    // Before the POST: the server can restart before it answers, and that failed answer is the update working.
    markUpdating();
    try {
      const r = await fetch("/api/update", { method: "POST" });
      const answer = (await r.json()) as { ok: boolean; why?: string };
      if (!answer.ok) {
        clearUpdating(); // the server refused the update: a failed read now is a real outage again
        setSaid(answer.why || `The Collector server answered ${r.status}.`);
        setBusy(false);
        return;
      }
      // The button stays, with its spinner, until the page reloads on the new build: hiding it here left the page
      // looking idle for the seconds the server takes to restart (James, 2026-11-06).
      // The restart is coming, so the page reloads from the version poll and not from here: a reload landing in the
      // second the server is away would show the browser's own error page. This is the note for when it stays away.
      giveUpLater();
    } catch (e) {
      // The POST lost its answer to the restart: the version poll reloads the page on the new build, and the
      // 60-second note above still covers a server that never comes back.
      const text = downText(e);
      if (text.startsWith("Could not reach")) {
        setSaid(text);
        setBusy(false);
      } else giveUpLater();
    }
  }, [giveUpLater]);

  if (!state?.ready) return null;
  return (
    <span className="update">
      <button
        className="btn primary"
        type="button"
        onClick={click}
        disabled={busy}
        aria-busy={busy}
        title={`The server is serving ${state.running.commit ?? state.running.id ?? "an unknown build"}; ${
          state.staged?.commit ?? state.staged?.id ?? "a newer build"
        } is built and waits for this click`}
      >
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Updating…
          </>
        ) : (
          "Update"
        )}
      </button>
      {said ? <span className="said">{said}</span> : null}
    </span>
  );
}
