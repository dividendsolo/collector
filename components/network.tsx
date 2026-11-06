"use client";

import { useEffect, useRef, useState } from "react";
import { bytes } from "@/lib/format";
import { MARK_LABELS, markText } from "@/lib/network";
import type {
  MachineNetwork,
  MachineNetworks,
  NetworkConnection,
  NetworkMark,
  NetworkSocket,
  NetworkSsh,
  ProcessInfo,
} from "@/lib/server/network";
import { useApi } from "./data";
import { Icon, PanelHead, Pill, SkelRows } from "./ui";

/** Who can connect to a port, one badge per group: red for the internet, green for the tailnet, grey for the local
 * network and the machine alone. A port on every address carries the tailnet as a badge of its own. */
function accessibleTo(s: NetworkSocket, machine: string): { cls: string; text: string }[] {
  const tailnet = { cls: "net-tailnet", text: "Tailnet" };
  if (s.reach === "internet") return [{ cls: "failed", text: "Internet" }, ...(s.tailnet ? [tailnet] : [])];
  if (s.reach === "lan") return [{ cls: "net-lan", text: "Local network" }, ...(s.tailnet ? [tailnet] : [])];
  if (s.reach === "tailnet") return [tailnet];
  return [{ cls: "", text: `Only ${machine}` }];
}

/** The networks a machine is on, in one line: what "local network" and "internet" mean for it. */
function networksNote(n: MachineNetworks | undefined): string {
  if (!n) return "";
  const parts: string[] = [];
  if (n.internet.length) parts.push(`public address ${n.internet.join(", ")}`);
  if (n.lan.length) parts.push(`local network ${n.lan.join(", ")}`);
  if (n.tailnet) parts.push(`tailnet address ${n.tailnet}`);
  return parts.join(" · ");
}

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
      <span className="net-mark-text">{markText(mark)}</span>
      <SeenButton machine={machine} mark={mark} />
    </div>
  );
}

/** The Sent or Received cell. `ss` counts each socket's own bytes; a Mac's nettop counts the process's, the same on
 * each of its connections, so that total shows once, on the process's first row, labelled as the process total. */
function BytesCell({ c, n, first }: { c: NetworkConnection; n: number | null; first: boolean }) {
  if (c.bytes_scope !== "process") return <td className="num mono">{bytes(n)}</td>;
  if (!first)
    return (
      <td className="num sub" title="A Mac counts bytes per process: this process's total is on its first row">
        —
      </td>
    );
  return (
    <td className="num mono" title="A Mac counts bytes per process: the total of every connection it has">
      {bytes(n)}
      <span className="sub net-total"> process total</span>
    </td>
  );
}

/** One connection going out: where it goes, what owns it, and how much has crossed it. */
function ConnectionRow({ c, first }: { c: NetworkConnection; first: boolean }) {
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
      <BytesCell c={c} n={c.bytes_sent} first={first} />
      <BytesCell c={c} n={c.bytes_received} first={first} />
      <td>{c.inbound ? <Pill cls="warning">From the network</Pill> : null}</td>
    </tr>
  );
}

/** For each connection, whether it is the first of its process in the list: the row a process total shows on. */
function firstOfProcess(connections: NetworkConnection[]): boolean[] {
  const seen = new Set<string>();
  return connections.map((c) => {
    const key = `${c.process ?? ""}/${c.pid ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One row of the page: the ports one process listens on with the same reach, so a process with five ports is one
 * row, not five. A row with no process name (another user's, which ss shows without one) groups with the others
 * that have none and the same reach. */
interface PortGroup {
  key: string;
  ports: number[];
  protos: string[];
  byPort: Map<number, string[]>;
  addresses: string[];
  process: string | null;
  pids: string[];
  first: NetworkSocket;
}

function groupPorts(sockets: NetworkSocket[]): PortGroup[] {
  const groups = new Map<string, PortGroup>();
  const add = <T,>(list: T[], v: T | null | undefined) => {
    if (v != null && !list.includes(v)) list.push(v);
  };
  for (const s of sockets) {
    const key = `${s.process ?? ""}|${s.reach}|${s.tailnet}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, ports: [], protos: [], byPort: new Map(), addresses: [], process: s.process, pids: [], first: s };
      groups.set(key, g);
    }
    add(g.ports, s.port);
    add(g.protos, s.proto);
    if (!g.byPort.has(s.port)) g.byPort.set(s.port, []);
    add(g.byPort.get(s.port) as string[], s.proto);
    for (const a of s.addresses) add(g.addresses, a);
    add(g.pids, s.pid);
  }
  for (const g of groups.values()) g.ports.sort((a, b) => a - b);
  return [...groups.values()];
}

/** The row's ports. When every port has the same protocols, the Protocol column says them once; when they differ (a
 * TCP port and a UDP one), each port carries its own, so no port is read with the wrong protocol. */
function portsText(g: PortGroup): { ports: string; protos: string } {
  const sets = [...g.byPort.values()].map((p) => [...p].sort().join("/"));
  if (sets.every((x) => x === sets[0])) return { ports: g.ports.join(", "), protos: sets[0] || "" };
  return {
    ports: g.ports.map((p) => `${p}/${[...(g.byPort.get(p) || [])].sort().join("/")}`).join(", "),
    protos: "mixed",
  };
}

/** How long a process has run, in the largest two units: "3 days 15 h", "2 h 5 min", "4 min". */
function runFor(s: number | null | undefined): string | null {
  if (s == null) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} ${d === 1 ? "day" : "days"} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

/** The tooltip's labelled facts for a process, one per line. What it is goes above them as the tooltip's text. */
function processFacts(info: ProcessInfo | null | undefined): string | undefined {
  if (!info) return undefined;
  const facts: [string, string | null][] = [
    ["Running for", runFor(info.seconds)],
    ["Started by", info.started_by],
    ["User", info.user],
    ["Command", info.path],
  ];
  return JSON.stringify(facts.filter((f): f is [string, string] => !!f[1]));
}

function SocketRow({ g, machine }: { g: PortGroup; machine: string }) {
  const badges = accessibleTo(g.first, machine);
  const { ports, protos } = portsText(g);
  return (
    <tr data-reach={g.first.reach}>
      <td className="port">{ports}</td>
      <td className="net-badges">
        {badges.map((b) => (
          <Pill key={b.text} cls={b.cls}>
            {b.text}
          </Pill>
        ))}
      </td>
      <td className="sub">{protos}</td>
      <td className="mono">{g.addresses.join(", ")}</td>
      <td>
        {g.process ? (
          <>
            <span
              className={g.first.info ? "card-tip" : undefined}
              data-tip={g.first.info?.about || undefined}
              data-tip-facts={processFacts(g.first.info)}
              data-tip-title={g.first.info?.name || g.process}
              tabIndex={g.first.info ? 0 : undefined}
            >
              {g.process}
            </span>
            {g.pids.length ? <span className="sub"> pid {g.pids.join(", ")}</span> : null}
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
  const firsts = firstOfProcess(connections);
  const open = sockets.filter((s) => s.reach === "internet").length;
  const ssh = sshNote(m.network?.ssh);
  const nets = networksNote(m.network?.networks);
  return (
    <section className="panel">
      <PanelHead icon="shield" title={m.local ? `${m.name} (this machine)` : m.name}>
        <span className={`count${open ? " hot" : ""}`} title={open ? `${open} ports open to the internet` : undefined}>
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
          ? `${connections.length} ${connections.length === 1 ? "connection" : "connections"}`
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
              {connections.map((c, i) => (
                <ConnectionRow
                  key={`${c.proto}-${c.local_address ?? ""}-${c.local_port ?? ""}-${c.address}-${c.port}-${c.pid ?? ""}`}
                  c={c}
                  first={firsts[i]}
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
          <table className="net-table">
            <thead>
              <tr>
                <th>Port</th>
                <th>Accessible to</th>
                <th>Protocol</th>
                <th>Address</th>
                <th>Process</th>
              </tr>
            </thead>
            <tbody>
              {groupPorts(sockets).map((g) => (
                <SocketRow key={g.key} g={g} machine={m.name} />
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
        {nets || "No network address read"}
        {" · the firewall is not read, so it may still block a port listed here"}
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

/** The event a toast's link sends (collector#67) when the Network page is already open: the address does not change
 * then, so the page is told to scroll instead. */
export const SCROLL_EVENT = "collector-network-first";

/** Scroll smoothly to the first row with this reach, and flash it once so the eye lands there. False when the rows
 * are not drawn yet. */
function scrollToFirst(reach: string): boolean {
  const row = document.querySelector<HTMLElement>(`tr[data-reach="${CSS.escape(reach)}"]`);
  if (!row) return false;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  row.classList.remove("net-flash");
  void row.offsetWidth; // restart the flash when the same row is picked twice
  row.classList.add("net-flash");
  return true;
}

/** A toast's link scrolls to the first port open to the internet: `#/network?first=internet` when it opens the page
 * (the query is taken off once the rows are drawn, so a refresh does not scroll again), and SCROLL_EVENT on every
 * click while the page is already open. */
function useFirstRow(ready: boolean) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const reach = new URLSearchParams(location.hash.split("?")[1] || "").get("first");
    if (reach) {
      pending.current = reach;
      history.replaceState(null, "", "#/network");
    }
    const go = (e: Event) => {
      const r = (e as CustomEvent<string>).detail || "internet";
      if (!scrollToFirst(r)) pending.current = r;
    };
    addEventListener(SCROLL_EVENT, go);
    return () => removeEventListener(SCROLL_EVENT, go);
  }, []);
  useEffect(() => {
    if (!ready || !pending.current) return;
    const reach = pending.current;
    // One frame later: React runs this page's effect before the Shell's, and the Shell scrolls a new page to the top.
    // Scrolling now would be undone at once (collector#67, the toast's link landed back at the top).
    const id = requestAnimationFrame(() => {
      if (scrollToFirst(reach)) pending.current = null;
    });
    return () => cancelAnimationFrame(id);
  });
}

/** The Network page (collector#65, collector#66): what each machine listens on and who can reach it, what it is
 * connected out to, and what is new about that — a process never seen there, a new destination, a large upload, or a
 * knock on a listening port from another device on the local network. Read only: nothing here blocks, opens or
 * closes a port, and no port is scanned from outside. A port open to the internet is also an error row, and a mark a
 * warning row, in Needs attention on the Dashboard. */
export function NetworkPage() {
  const { data } = useApi<{ at: number; machines: MachineNetwork[] }>("/api/network", 15_000);
  const machines = data?.machines || [];
  useFirstRow(Boolean(data));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Network</h1>
        <p>
          Every port each machine listens on and who can connect to it, and what each machine sends out, with what is
          new flagged.
        </p>
      </div>
      {!data ? (
        <section className="panel">
          <PanelHead icon="shield" title="Ports" />
          <div className="wrap">
            <table className="net-table">
              <thead>
                <tr>
                  <th>Port</th>
                  <th>Accessible to</th>
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
