"use client";

import { useMemo, useState } from "react";
import { MOVE_PRIORITIES } from "@/lib/card-move";
import { type Journey, journeyVisits, journeyWalk, moveTime, nowLine, stayText } from "@/lib/journey";
import { AGENT_STACK_ALL, AGENT_STACK_STATUSES } from "@/lib/statuses";
import { useApi } from "./data";
import { Drawing, useReducedMotion } from "./flow";
import { useSide } from "./side";
import { Ext, PanelHead } from "./ui";

function Move({
  repo,
  number,
  lane,
  onMoved,
}: {
  repo: string;
  number: number;
  lane: string;
  onMoved: () => Promise<unknown>;
}) {
  const mac = useSide() === "mac";
  const statuses = mac ? AGENT_STACK_ALL : AGENT_STACK_ALL.filter((s) => !AGENT_STACK_STATUSES.done.includes(s));
  const [status, setStatus] = useState(lane || "ready-for-human");
  const [priority, setPriority] = useState("none");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const move = async () => {
    setBusy(true);
    setWhy("");
    try {
      const r = await fetch("/api/card-move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, number, status, priority }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) await onMoved();
      else setWhy(d.step ? `${d.step}: ${d.why}` : d.why || `failed (${r.status})`);
    } catch (e) {
      setWhy((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <form
      className="fields move-card"
      onSubmit={(e) => {
        e.preventDefault();
        move();
      }}
    >
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {MOVE_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Moving…" : "Move"}
        </button>
      </div>
      {why ? (
        <p className="err wide" role="alert">
          {why}
        </p>
      ) : null}
    </form>
  );
}

export function JourneyPage({ repo, number }: { repo: string; number: number }) {
  const { data, error, isLoading, mutate } = useApi<Journey>(
    `/api/journey?repo=${encodeURIComponent(repo)}&n=${number}`,
    60_000,
  );
  const moves = data?.moves ?? [];
  const still = useReducedMotion();
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [drawKey, setDrawKey] = useState(0);
  const trail = useMemo(
    () => (data ? { walk: journeyWalk(data.moves), visits: journeyVisits(data.moves) } : null),
    [data],
  );
  const card = data?.card ?? null;

  return (
    <div className="page journey-page">
      <section className="panel">
        <PanelHead icon="gauge" title="Card journey">
          <span className="sub">
            {card ? `${card.repo}#${card.number} · ${card.title}` : "one card's whole history, on the flow"}
          </span>
          <div className="tools">
            {card ? (
              <Ext href={card.url} className="btn" title="Open the card on GitHub">
                GitHub
              </Ext>
            ) : null}
            {moves.length && !still ? (
              <button type="button" className="btn" onClick={() => setDrawKey((k) => k + 1)}>
                Replay
              </button>
            ) : null}
          </div>
        </PanelHead>

        {isLoading ? (
          <p className="sub journey-now">Reading the card's timeline…</p>
        ) : error ? (
          <p className="sub journey-now">Could not read this card's timeline: {String((error as Error).message)}</p>
        ) : !card ? (
          <p className="sub journey-now">
            No chosen project holds {repo}#{number}.
          </p>
        ) : (
          <>
            <p className="journey-now">{nowLine(moves) || "This card's timeline holds no status change yet."}</p>
            <Drawing journey={trail} drawKey={drawKey} hoverNode={hoverNode} onHover={setHoverNode} />
          </>
        )}
      </section>

      {card ? (
        <section className="panel" id="move-panel">
          <PanelHead icon="list" title="Move the card">
            <span className="sub">a status, a priority, or both</span>
          </PanelHead>
          <Move
            repo={card.repo}
            number={card.number}
            lane={moves.length ? moves[moves.length - 1].status : ""}
            onMoved={() => mutate()}
          />
        </section>
      ) : null}

      {card ? (
        <section className="panel">
          <PanelHead icon="list" title="Every step">
            <span className="count">{moves.length}</span>
            <span className="sub">oldest first, each linked to the comment that says why</span>
          </PanelHead>
          <div className="wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Status</th>
                  <th>Who</th>
                  <th className="num">Stayed</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m, i) => (
                  <tr
                    key={`${m.at}-${i}`}
                    className={`journey-row${hoverNode === m.status ? " hot" : ""}`}
                    onPointerEnter={() => setHoverNode(m.status)}
                    onPointerLeave={() => setHoverNode(null)}
                  >
                    <td className="mono">{moveTime(m.at)}</td>
                    <td className="journey-status">
                      {m.from ? <span className="sub">{m.from} → </span> : null}
                      <span className="pill">{m.status}</span>
                    </td>
                    <td>{m.who ?? <span className="sub">—</span>}</td>
                    <td className="num">{stayText(m.seconds)}</td>
                    <td className="wide">
                      {m.why ? (
                        m.url ? (
                          <a className="plain" href={m.url} target="_blank" rel="noopener">
                            {m.why}
                          </a>
                        ) : (
                          m.why
                        )
                      ) : (
                        <span className="sub">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!moves.length ? (
                  <tr>
                    <td colSpan={5} className="sub">
                      This card's timeline holds no move at all.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
