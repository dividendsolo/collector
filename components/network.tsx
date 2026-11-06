"use client";

import { useState } from "react";
import { bytes } from "@/lib/format";
import { MARK_LABELS, markText } from "@/lib/network";
import type { MachineNetwork, NetworkConnection, NetworkMark, NetworkSocket, NetworkSsh } from "@/lib/server/network";
import { useApi } from "./data";
import { Icon, PanelHead, Pill, SkelRows } from "./ui";

/** What each mark wears: the one that matters is the page's red, the other two are the machine's own answer. */
const MARKS: Record<string, [string, string]> = {
  open: ["failed", "Open to everyone"],
  allowed: ["", "Expected public"],
  local: ["", "Local only"],
};

/** The two sshd settings in one line, bad only while something is on. Null where ssh was never read (a Mac). */
function sshNote(ssh: NetworkSsh | null | undefined): { text: string; bad: boolean } | null {
  if (!ssh?.source) return null;
  const on: string[] = [];
  if (ssh.passwordauthentication) on.push("password logins");
  if (ssh.permitrootlogin) on.push("root login");
  if (!on.length) return { text: "no password logins, and root cannot log in", bad: false };
  return { text: `${on.join(" and ")} ${on.length > 1 ? "are" : "is"} on`, bad: true };
}

/** One mark's Seen click (collector#66): it drops that mark from the seen-list, so the row leaves Needs attention
 * and does not come back. The mark's own id rides in the query, the same URL the Dashboard's row posts to. */
function SeenButton({ machine, mark }: { machine: string; mark: NetworkMark }) {
  const [state, setState] = useState("idle");
  const click = async () => {
    setState("busy");
    try {
      const r = await fetch(
        `/api/network/seen?machine=${encodeURIComponent(machine)}&id=${encodeURIComponent(mark.id)}`,
        { method: "POST" },
      );
      const body = await r.json().catch(() => ({}));
      if (r.ok) setState("done");
      else setState(body.why || `failed (${r.status})`);
    } catch (e) {
      setState((e as Error).message);
    }
  };
  if (state === "done") return <span className="sub">Seen</span>;
  return (
    <span className="act">
      {state !== "idle" && state !== "busy" ? <span className="why">{state}</span> : null}
      <button className="btn" type="button" onClick={click} disabled={state === "busy"}>
        {state === "busy" ? "Saving…" : "Seen"}
      </button>
    </span>
  );
}

/** What is new about this machine's network: a process never seen here, a new destination, a large upload, or a knock
 * from the local network — each with the Seen click that clears it. */
function MarkRow({ machine, mark }: { machine: string; mark: NetworkMark }) {
  return (
    <div className="net-mark">
      <Pill cls="warning">{MARK_LABELS[mark.kind] || mark.kind}</Pill>
      <span>{markText(mark)}</span>
      <SeenButton machine={machine} mark={mark} />
    </div>
  );
}

/** One established connection: where it goes, what owns it, and how much has crossed it. */
function ConnectionRow({ c }: { c: NetworkConnection }) {
  return (
    <tr className={c.inbound ? "net-in" : undefined}>
      <td className="mono">
        {c.address || "—"}
        {c.port != null ? `:${c.port}` : ""}
      </td>
      <td className="sub">{c.host || "no name"}</td>
      <td>
        {c.process ? (
          <>
            {c.process}
            {c.pid ? <span className="sub"> pid {c.pid}</span> : null}
          </>
        ) : (
          // `ss -p` shows the user's own processes without sudo, so another user's connection keeps no name.
          <span className="sub" title="Another user's process: ss shows yours without sudo">
            —
          </span>
        )}
      </td>
      <td className="num mono">{bytes(c.bytes_sent)}</td>
      <td className="num mono">{bytes(c.bytes_received)}</td>
      <td>{c.inbound ? <Pill cls="warning">From the network</Pill> : null}</td>
    </tr>
  );
}

function SocketRow({ s }: { s: NetworkSocket }) {
  const [cls, label] = MARKS[s.mark] || ["", s.mark];
  return (
    <tr className={s.mark === "open" ? "net-open" : undefined}>
      <td className="num port">{s.port}</td>
      <td>
        <Pill cls={cls}>{label}</Pill>
      </td>
      <td className="sub">{s.proto}</td>
      <td className="mono">{s.address}</td>
      <td>
        {s.process ? (
          <>
            {s.process}
            {s.pid ? <span className="sub"> pid {s.pid}</span> : null}
          </>
        ) : (
          // `ss -p` shows the user's own processes without sudo, so a root socket keeps its address and no name.
          <span className="sub" title="Another user's process: ss shows yours without sudo">
            —
          </span>
        )}
      </td>
    </tr>
  );
}

/** One machine's block: what it is sending out and what is new about it, then every socket it listens on, with the
 * ones anyone can reach flagged first. */
function Machine({ m }: { m: MachineNetwork }) {
  const sockets = m.network?.sockets || [];
  const connections = m.network?.connections || [];
  const marks = m.network?.marks || [];
  const open = sockets.filter((s) => s.mark === "open").length;
  const ssh = sshNote(m.network?.ssh);
  const allow = m.network?.allow || [];
  return (
    <section className="panel">
      <PanelHead icon="shield" title={m.name}>
        <span className={`count${open ? " hot" : ""}`} title={open ? `${open} sockets open to everyone` : undefined}>
          {open || sockets.length}
        </span>
        {marks.length ? (
          <span className="count hot" title={`${marks.length} new since the last read`}>
            {marks.length} new
          </span>
        ) : null}
        {m.stale ? <span className="sub">last good read; the newest one failed</span> : null}
      </PanelHead>
      {m.error ? <p className="sub net-note">Could not read this machine: {m.error}</p> : null}
      {marks.map((mark) => (
        <MarkRow key={mark.id} machine={m.name} mark={mark} />
      ))}
      <p className="sub net-note">
        Going out:{" "}
        {connections.length
          ? `${connections.length} established ${connections.length === 1 ? "connection" : "connections"}`
          : "nothing is connected out"}
        {m.network?.upload_warn_mb
          ? ` · an upload over ${m.network.upload_warn_mb} MB between two reads is marked`
          : ""}
      </p>
      {connections.length ? (
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th>Remote</th>
                <th>Host</th>
                <th>Process</th>
                <th className="num">Sent</th>
                <th className="num">Received</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <ConnectionRow
                  key={`${c.proto}-${c.local_address ?? ""}-${c.local_port ?? ""}-${c.address}-${c.port}-${c.pid ?? ""}`}
                  c={c}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <Icon name="activity" />
          Nothing is connected out from here, or this machine has no ss, lsof or nettop to read: it reads empty rather
          than failed.
        </div>
      )}
      <p className="sub net-note">Listening:</p>
      {sockets.length ? (
        <div className="wrap">
          <table>
            <thead>
              <tr>
                <th className="num">Port</th>
                <th>Mark</th>
                <th>Protocol</th>
                <th>Address</th>
                <th>Process</th>
              </tr>
            </thead>
            <tbody>
              {sockets.map((s) => (
                <SocketRow key={`${s.proto}-${s.address}-${s.port}-${s.pid ?? ""}`} s={s} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <Icon name="shield" />
          Nothing listens here, or this machine has no ss or lsof to read: it reads empty rather than failed.
        </div>
      )}
      <p className="sub net-note">
        Allowed to be public: {allow.length ? allow.join(", ") : "nothing"}
        {ssh ? (
          <>
            {" · "}
            <span className={ssh.bad ? "stuck" : undefined}>SSH: {ssh.text}</span>
            <span className="sub"> (read from {m.network?.ssh?.source})</span>
          </>
        ) : null}
      </p>
    </section>
  );
}

/** The Network page (collector#65, collector#66): what each machine listens on and whether anyone can reach it, what
 * it is connected out to, and what is new about that — a process never seen there, a new destination, a large
 * upload, or a knock on a listening port from another device on the local network. Read only: nothing here blocks,
 * opens or closes a port, and no port is scanned from outside. A red flag is also an error row, and a mark a warning
 * row, in Needs attention on the Dashboard. */
export function NetworkPage() {
  const { data } = useApi<{ at: number; machines: MachineNetwork[] }>("/api/network", 15_000);
  const machines = data?.machines || [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Network</h1>
        <p>
          What each machine listens on and what it sends out, with the ports anyone can reach and the connections that
          are new flagged.
        </p>
      </div>
      {!data ? (
        <section className="panel">
          <PanelHead icon="shield" title="Ports" />
          <div className="wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Port</th>
                  <th>Mark</th>
                  <th>Protocol</th>
                  <th>Address</th>
                  <th>Process</th>
                </tr>
              </thead>
              <tbody>
                <SkelRows n={3} cols={5} />
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        machines.map((m) => <Machine key={m.name} m={m} />)
      )}
    </div>
  );
}
