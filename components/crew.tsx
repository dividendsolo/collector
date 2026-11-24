"use client";

import { crewRows } from "@/lib/crew";
import { CardRef } from "./card-link";
import { useLive } from "./data";
import { PanelHead, SkelRows } from "./ui";

export function CrewPanel() {
  const { state } = useLive();
  const rows = state ? crewRows(state.machines || []) : null;
  return (
    <section className="panel" id="crew">
      <PanelHead icon="bot" title="Crew" />
      <div className="wrap">
        <table className="crew">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Position</th>
              <th>Filled by</th>
              <th>Doing now</th>
            </tr>
          </thead>
          <tbody>
            {!rows ? (
              <SkelRows n={3} cols={4} />
            ) : rows.length ? (
              rows.map((r) => (
                <tr key={`${r.machine}-${r.position}`}>
                  <td>{r.machine}</td>
                  <td>
                    <span data-tip={r.tip} data-tip-title={r.position} tabIndex={0}>
                      {r.position}
                    </span>
                  </td>
                  <td className="mono">{r.filledBy}</td>
                  <td className={r.now === "unreachable" || r.now === "paused" ? "sub" : undefined}>
                    {r.card ? (
                      <>
                        <CardRef repo={r.card.repo} number={r.card.number} label={`${r.card.repo}#${r.card.number}`} />
                        {`, ${r.elapsed}`}
                      </>
                    ) : (
                      r.now
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="sub">
                  No foreman on any machine.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
