"use client";

import { useState } from "react";
import { mutate } from "swr";
import { type InboxMessage, inboxTime } from "@/lib/inbox";
import { webUrl } from "@/lib/links";
import { useApi } from "./data";
import { Count, Icon, PanelHead, SkelRows } from "./ui";

interface InboxData {
  at: number;
  rows: InboxMessage[];
  unhandled: number;
  why?: string;
}

export const useInbox = () => useApi<InboxData>("/api/inbox");

export async function postHandled(machine: string, id: string, handled: boolean) {
  const r = await fetch("/api/inbox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machine, id, handled }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false as const, why: (d.why as string) || `HTTP ${r.status}` };
  mutate("/api/inbox", d, { revalidate: false });
  return { ok: true as const };
}

export const InboxRow = ({ m }: { m: InboxMessage }) => {
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState("");
  const toggle = async () => {
    setBusy(true);
    const r = await postHandled(m.machine, m.id, !m.handled);
    setBusy(false);
    if (!r.ok) setWhy(r.why);
  };
  const href = webUrl(m.href);
  return (
    <tr className={`row ${m.handled ? "handled" : "unread"}`}>
      <td className="from">{m.source || m.machine}</td>
      <td className="wide">
        {href ? (
          <a className="plain" href={href}>
            {m.text}
          </a>
        ) : (
          m.text
        )}
        {why ? (
          <span className="err" role="alert">
            {" "}
            {why}
          </span>
        ) : null}
      </td>
      <td className="mono">{inboxTime(m.at)}</td>
      <td className="actions">
        <button className="btn ghost" type="button" disabled={busy} onClick={toggle}>
          {m.handled ? "Undo" : "Handled"}
        </button>
      </td>
    </tr>
  );
};

const HandledSection = ({
  handled,
  open,
  onToggle,
}: {
  handled: InboxMessage[];
  open: boolean;
  onToggle: () => void;
}) => (
  <>
    <tr>
      <td colSpan={4} className="section-head">
        <button type="button" className="archived-toggle" aria-expanded={open} onClick={onToggle}>
          <Icon name="chev" className="i arch-chev" />
          Handled
          <Count n={handled.length} title={`${handled.length} handled`} />
        </button>
      </td>
    </tr>
    {open ? handled.map((m) => <InboxRow m={m} key={`${m.machine}/${m.id}`} />) : null}
  </>
);

export function InboxPage() {
  const { data } = useApi<InboxData>("/api/inbox");
  const rows: InboxMessage[] = data?.rows || [];
  const unread = rows.filter((m) => !m.handled);
  const handled = rows.filter((m) => m.handled);
  const [open, setOpen] = useState(false);
  return (
    <div className="page">
      <section className="panel briefs-panel inbox-panel">
        <PanelHead icon="inbox">
          <Count n={data?.unhandled ?? 0} title={`${data?.unhandled ?? 0} unhandled`} />
          <span className="sub">unhandled</span>
        </PanelHead>
        {data?.why ? (
          <p className="err wide" role="alert">
            {data.why}
          </p>
        ) : null}
        <div className="wrap">
          <table className="briefs inbox">
            <thead>
              <tr>
                <th>From</th>
                <th>Message</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <SkelRows n={3} cols={4} />
              ) : unread.length ? (
                unread.map((m) => <InboxRow m={m} key={`${m.machine}/${m.id}`} />)
              ) : (
                <tr>
                  <td colSpan={4}>
                    <div className="soon">
                      <b>Nothing unhandled.</b>
                      <span>Every message that came through has been handled.</span>
                    </div>
                  </td>
                </tr>
              )}
              {data ? <HandledSection handled={handled} open={open} onToggle={() => setOpen((was) => !was)} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
