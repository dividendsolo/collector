"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import type { Brief } from "@/lib/briefs";
import { useApi } from "./data";
import { Markdown } from "./markdown";
import { Count, PanelHead, SkelRows } from "./ui";

/**
 * The Briefs page (collector#64): the reports the cron jobs wrote for James, the way his email inbox works. The
 * files live on the machines (`collect.py` reads the folder on each one); which of them he has read and archived
 * lives on this machine, so both survive a browser reset. The terms are in GLOSSARY.md: the Inbox is every brief
 * that is not Archived, oldest first; a Read one stays in the Inbox, dimmed, until he archives it.
 */

interface BriefsData {
  at: number;
  inbox: Brief[];
  archived: Brief[];
  /** One plain line when a machine (or the state file) could not be read. */
  why?: string;
}

/** A brief's own page: the whole file, its front matter as the row above it. */
interface BriefData {
  brief?: Brief & { body: string };
  why?: string;
}

/** `/api/briefs` once a minute: the same snapshot every other page reads, split into the two lists. */
export const useBriefs = () => useApi<BriefsData>("/api/briefs");

/** The date a brief reads by: the UTC day it went out, which is the day its own subject names. */
const day = (sent_at: string | null | undefined) => {
  const at = sent_at ? new Date(sent_at) : null;
  return at && !Number.isNaN(at.getTime())
    ? at.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    : "—";
};

/** One click's write (Read on open, or Archive). Its answer is the whole view, handed to the shared `/api/briefs`
 * read so the sidebar count and the Inbox change on the click rather than at the next minute's refresh. */
export async function postBrief(machine: string, file: string, change: { read?: boolean; archived?: boolean }) {
  const r = await fetch("/api/briefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machine, file, ...change }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false as const, why: (d.why as string) || `HTTP ${r.status}` };
  mutate("/api/briefs", d, { revalidate: false });
  return { ok: true as const };
}

const href = (b: Brief) => `#/briefs/${encodeURIComponent(b.machine)}/${encodeURIComponent(b.file)}`;

/** One row: the dot says Unread, the name opens the brief, and how far down the Inbox it sits is the order itself. */
const BriefRow = ({ b }: { b: Brief }) => (
  <tr className={b.read ? "read" : "unread"}>
    <td className="unread-dot">{b.read ? null : <span className="dot" title="Unread" />}</td>
    <td className="name">
      <a className="plain" href={href(b)}>
        {b.brief || b.subject || b.file}
      </a>
    </td>
    <td className="wide">{b.subject || b.file}</td>
    <td className="mono">{day(b.sent_at)}</td>
  </tr>
);

export function BriefsPage() {
  const { data } = useApi<BriefsData>("/api/briefs");
  const inbox: Brief[] = data?.inbox || [];
  const archived: Brief[] = data?.archived || [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Briefs</h1>
        <p>What your cron jobs wrote for you, oldest first. Open one to read it, then archive it when you are done.</p>
      </div>
      <section className="panel">
        <PanelHead icon="inbox" title="Briefs">
          <Count n={inbox.length} title={`${inbox.length} in the inbox`} />
          <span className="sub">in the inbox</span>
        </PanelHead>
        {data?.why ? (
          <p className="err wide" role="alert">
            {data.why}
          </p>
        ) : null}
        <div className="wrap">
          <table className="briefs">
            <thead>
              <tr>
                <th />
                <th>Brief</th>
                <th>Subject</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={3} cols={4} />
              ) : inbox.length ? (
                inbox.map((b) => <BriefRow b={b} key={`${b.machine}/${b.file}`} />)
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="soon">
                      <b>No briefs.</b>
                      <span>Nothing has been written for you yet.</span>
                    </div>
                  </td>
                </tr>
              )}
              {data ? (
                <tr>
                  <td colSpan={4} className="section-head">
                    Archived
                  </td>
                </tr>
              ) : null}
              {data && !archived.length ? (
                <tr>
                  <td colSpan={4} className="sub">
                    Nothing archived yet.
                  </td>
                </tr>
              ) : null}
              {archived.map((b) => (
                <BriefRow b={b} key={`${b.machine}/${b.file}`} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** One brief, read whole: opening it is what makes it Read, and the Archive button sits at its top (the Acknowledge
 * toggle's own button on Needs attention). There is no unarchive in this pass. */
export function BriefPage({ machine, file }: { machine: string; file: string }) {
  const query = `/api/brief?machine=${encodeURIComponent(machine)}&file=${encodeURIComponent(file)}`;
  const { data } = useApi<BriefData>(query);
  const brief = data?.brief;
  const [archived, setArchived] = useState(false);
  // Opening a brief makes it Read (GLOSSARY.md). Once: the read state lands on this machine, and the next read of the
  // brief carries it.
  useEffect(() => {
    if (!brief || brief.read) return;
    void postBrief(machine, file, { read: true });
  }, [brief, machine, file]);
  const isArchived = archived || Boolean(brief?.archived);
  const archive = async () => {
    const r = await postBrief(machine, file, { archived: true });
    if (r.ok) setArchived(true);
    else alert(r.why);
  };
  return (
    <div className="page">
      <section className="panel">
        <PanelHead icon="inbox" title={brief?.brief || "Brief"}>
          <span className="sub">{brief ? `${brief.machine} · ${day(brief.sent_at)}` : ""}</span>
          <div className="tools">
            <a className="btn ghost" href="#/briefs">
              Inbox
            </a>
            <button className="btn" type="button" disabled={isArchived} onClick={archive}>
              {isArchived ? "Archived" : "Archive"}
            </button>
          </div>
        </PanelHead>
        {data?.why ? (
          <p className="err wide" role="alert">
            {data.why}
          </p>
        ) : null}
        {brief?.body ? <Markdown text={brief.body} /> : null}
      </section>
    </div>
  );
}
