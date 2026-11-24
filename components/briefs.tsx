"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import type { Brief } from "@/lib/briefs";
import { useApi } from "./data";
import { Markdown } from "./markdown";
import { Count, Icon, PanelHead, SkelRows } from "./ui";

interface BriefsData {
  at: number;
  inbox: Brief[];
  archived: Brief[];
  why?: string;
}

interface BriefData {
  brief?: Brief & { body: string };
  why?: string;
}

export const useBriefs = () => useApi<BriefsData>("/api/briefs");

export const briefDay = (sent_at: string | null | undefined, timeZone?: string) => {
  const at = sent_at ? new Date(sent_at) : null;
  return at && !Number.isNaN(at.getTime())
    ? at.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) })
    : "—";
};
const day = (sent_at: string | null | undefined) => briefDay(sent_at);

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

type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; target?: unknown };

export function briefKey(e: KeyLike): "archive" | "inbox" | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const tag = (e.target as { tagName?: string } | undefined)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return null;
  if (e.key === "e" || e.key === "E") return "archive";
  if (e.key === "Escape") return "inbox";
  return null;
}

export async function archiveBrief(machine: string, file: string) {
  const r = await postBrief(machine, file, { archived: true });
  if (r.ok) location.hash = "#/briefs";
  return r;
}

const href = (b: Brief) => `#/briefs/${encodeURIComponent(b.machine)}/${encodeURIComponent(b.file)}`;

export const BriefRow = ({ b }: { b: Brief }) => (
  <tr
    className={`row ${b.read ? "read" : "unread"}`}
    onClick={(e) => {
      if (!(e.target as HTMLElement).closest("a")) location.hash = href(b);
    }}
  >
    <td className="name">
      <a className="plain" href={href(b)}>
        {b.brief || b.subject || b.file}
      </a>
    </td>
    <td className="wide">{b.subject || b.file}</td>
    <td className="mono">{day(b.sent_at)}</td>
  </tr>
);

export const ArchivedSection = ({
  archived,
  open,
  onToggle,
}: {
  archived: Brief[];
  open: boolean;
  onToggle: () => void;
}) => (
  <>
    <tr>
      <td colSpan={3} className="section-head">
        <button type="button" className="archived-toggle" aria-expanded={open} onClick={onToggle}>
          <Icon name="chev" className="i arch-chev" />
          Archived
          <Count n={archived.length} title={`${archived.length} archived`} />
        </button>
      </td>
    </tr>
    {!archived.length ? (
      <tr>
        <td colSpan={3} className="sub">
          Nothing archived yet.
        </td>
      </tr>
    ) : null}
    {open ? archived.map((b) => <BriefRow b={b} key={`${b.machine}/${b.file}`} />) : null}
  </>
);

export function BriefsPage() {
  const { data } = useApi<BriefsData>("/api/briefs");
  const inbox: Brief[] = data?.inbox || [];
  const archived: Brief[] = data?.archived || [];
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <section className="panel briefs-panel">
        <PanelHead icon="inbox">
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
                <th>From</th>
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
                  <td colSpan={3}>
                    <div className="soon">
                      <b>No briefs.</b>
                      <span>Nothing has been written for you yet.</span>
                    </div>
                  </td>
                </tr>
              )}
              {data ? (
                <ArchivedSection archived={archived} open={open} onToggle={() => setOpen((was) => !was)} />
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const SKEL_LINES = ["h", "l", "l", "m", "", "l", "l", "s", "", "m", "l", "l", "m"];
const BriefSkel = () => (
  <div className="brief-skel" role="status" aria-busy="true" aria-label="Loading the brief">
    {SKEL_LINES.map((w, i) => (w ? <span className={`skel ${w}`} key={i} /> : <span className="gap" key={i} />))}
  </div>
);

export function BriefPage({ machine, file }: { machine: string; file: string }) {
  const query = `/api/brief?machine=${encodeURIComponent(machine)}&file=${encodeURIComponent(file)}`;
  const { data } = useApi<BriefData>(query);
  const list = useBriefs().data;
  const listed = [...(list?.inbox || []), ...(list?.archived || [])].find(
    (b) => b.machine === machine && b.file === file,
  );
  const brief = data?.brief;
  const head = brief || listed;
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    if (!brief || brief.read) return;
    void postBrief(machine, file, { read: true });
  }, [brief, machine, file]);
  const isArchived = archived || Boolean(brief?.archived);
  const archive = async () => {
    const r = await archiveBrief(machine, file);
    if (r.ok) setArchived(true);
    else alert(r.why);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = briefKey(e);
      if (k === "inbox") location.hash = "#/briefs";
      else if (k === "archive" && !isArchived) void archive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="page">
      <section className="panel briefs-panel brief-panel">
        <PanelHead icon="inbox" title={head?.brief || "Brief"}>
          <span className="sub">{head ? `${head.machine} · ${day(head.sent_at)}` : ""}</span>
          <div className="tools">
            <a className="btn ghost back" href="#/briefs" title="Back to the inbox (Esc)">
              <Icon name="back" />
              Inbox
            </a>
            <button className="btn" type="button" disabled={isArchived} onClick={archive} title="Archive (E)">
              {isArchived ? "Archived" : "Archive"}
            </button>
          </div>
        </PanelHead>
        {data?.why ? (
          <p className="err wide" role="alert">
            {data.why}
          </p>
        ) : null}
        {brief?.body ? <Markdown text={brief.body} /> : data ? null : <BriefSkel />}
      </section>
    </div>
  );
}
