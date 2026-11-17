"use client";

import { useMemo, useState } from "react";
import { type Journey, journeyVisits, journeyWalk, moveTime, nowLine, stayText } from "@/lib/journey";
import { useApi } from "./data";
import { Drawing, useReducedMotion } from "./flow";
import { Ext, PanelHead } from "./ui";

export function JourneyPage({ repo, number }: { repo: string; number: number }) {
  const { data, error, isLoading } = useApi<Journey>(
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
