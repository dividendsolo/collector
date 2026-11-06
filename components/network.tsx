"use client";

import type { MachineNetwork, NetworkSocket, NetworkSsh } from "@/lib/server/network";
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

/** One machine's block: every socket it listens on, with the ones anyone can reach flagged first. */
function Machine({ m }: { m: MachineNetwork }) {
  const sockets = m.network?.sockets || [];
  const open = sockets.filter((s) => s.mark === "open").length;
  const ssh = sshNote(m.network?.ssh);
  const allow = m.network?.allow || [];
  return (
    <section className="panel">
      <PanelHead icon="shield" title={m.name}>
        <span className={`count${open ? " hot" : ""}`} title={open ? `${open} sockets open to everyone` : undefined}>
          {open || sockets.length}
        </span>
        {m.stale ? <span className="sub">last good read; the newest one failed</span> : null}
      </PanelHead>
      {m.error ? <p className="sub net-note">Could not read this machine: {m.error}</p> : null}
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

/** The Network page (collector#65): what each machine listens on, and whether anyone can reach it. Read only —
 * nothing here blocks, opens or closes a port, and no port is scanned from outside: this is what each machine says
 * it listens on. A red flag is also an error row in Needs attention on the Dashboard. */
export function NetworkPage() {
  const { data } = useApi<{ at: number; machines: MachineNetwork[] }>("/api/network", 15_000);
  const machines = data?.machines || [];
  return (
    <div className="page">
      <div className="page-head">
        <h1>Network</h1>
        <p>Every open port on each machine, with the ones anyone can reach flagged.</p>
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
