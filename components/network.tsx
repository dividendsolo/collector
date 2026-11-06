"use client";

import { useEffect, useRef } from "react";
import type {
  Firewall,
  MachineNetwork,
  MachineNetworks,
  NetworkSocket,
  NetworkSsh,
  ProcessInfo,
} from "@/lib/server/network";
import { useApi } from "./data";
import { Icon, PanelHead, Pill, SkelRows } from "./ui";

/** One "Accessible to" badge: its colour, its word, and what it means on hover. */
interface Badge {
  cls: string;
  text: string;
  tip: string;
}

/** Who can connect to a port, one badge per group: red for the internet, blue for a port the firewall opens on
 * purpose (Firewalled), amber for the local network, green for the tailnet, grey for the machine alone. A port on
 * every address carries the tailnet as a badge of its own. Each badge says on hover what it means for this port
 * (James, 2026-11-06: "we can explain what firewall means and ... what this port is actually allowing in"). */
function accessibleTo(s: NetworkSocket, machine: string, fw: Firewall | null | undefined): Badge[] {
  const port = `${s.proto} ${s.port}`;
  const tailnet: Badge = {
    cls: "net-tailnet",
    text: "Tailnet",
    tip:
      "Your own devices on Tailscale can connect, from anywhere: they reach this machine over an encrypted network " +
      "only devices signed in to your Tailscale account are on. Nobody else can.",
  };
  const plus = s.tailnet ? [tailnet] : [];
  if (s.reach === "internet")
    return [
      {
        cls: "failed",
        text: "Internet",
        tip:
          `Anyone on the internet can try to connect to ${port}. ` +
          (fw
            ? `${fw.tool} is ${fw.active ? "on but lets everything in by default" : "off"}, so nothing stops them. `
            : "The firewall was not read, so it may still block this port. ") +
          "Close it, or bind the program to 127.0.0.1 or the tailnet address, unless the world is meant to reach it.",
      },
      ...plus,
    ];
  if (s.reach === "firewalled")
    return [
      {
        cls: "net-firewalled",
        text: "Firewalled",
        tip:
          `The firewall (${fw?.tool ?? "ufw"}) blocks every connection from the internet unless a rule lets it in, ` +
          `and one rule lets ${port} in. Anyone on the internet can reach this port, on purpose: someone opened it. ` +
          "Opened on purpose is not the same as safe: check the program behind it is meant to face the world.",
      },
      ...plus,
    ];
  if (s.reach === "lan")
    return [
      {
        cls: "warning",
        text: "Local network",
        tip:
          `Any device on ${machine}'s local network can connect to ${port}: phones, TVs, smart plugs and guests on ` +
          "the same Wi-Fi. The router keeps the internet out.",
      },
      ...plus,
    ];
  if (s.reach === "tailnet")
    return [
      {
        ...tailnet,
        tip:
          s.firewall === "blocks"
            ? `${tailnet.tip} The program listens on every address, but the firewall blocks ${port} from the ` +
              "internet and lets only the tailnet in."
            : tailnet.tip,
      },
    ];
  return [
    {
      cls: "",
      text: `Only ${machine}`,
      tip:
        s.firewall === "blocks"
          ? `Only programs on ${machine} can connect: the firewall blocks ${port} from every network.`
          : `Only programs on ${machine} itself can connect: ${port} is bound to a loopback address (127.0.0.1 or ` +
            "::1), which no other machine can reach.",
    },
  ];
}

/** What the page says about the machine's firewall, under its table. */
function firewallNote(fw: Firewall | null | undefined): string {
  if (!fw) return "firewall not read, so a port listed here may still be blocked";
  if (!fw.active) return `${fw.tool} is off: nothing is blocked`;
  return `${fw.tool} is on (incoming: ${fw.incoming}); each port shows who it lets in`;
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

function SocketRow({ g, machine, fw }: { g: PortGroup; machine: string; fw: Firewall | null | undefined }) {
  const badges = accessibleTo(g.first, machine, fw);
  const { ports, protos } = portsText(g);
  return (
    <tr data-reach={g.first.reach}>
      <td className="port">{ports}</td>
      <td className="net-badges">
        {badges.map((b) => (
          <span key={b.text} className="card-tip-plain" data-tip={b.tip} data-tip-title={b.text} tabIndex={0}>
            <Pill cls={b.cls}>{b.text}</Pill>
          </span>
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

/** One machine's block: every port it listens on, with who can connect to each, the most exposed first. */
function Machine({ m }: { m: MachineNetwork }) {
  const sockets = m.network?.sockets || [];
  const open = sockets.filter((s) => s.reach === "internet").length;
  const ssh = sshNote(m.network?.ssh);
  const nets = networksNote(m.network?.networks);
  return (
    <section className="panel">
      <PanelHead icon="shield" title={m.local ? `${m.name} (this machine)` : m.name}>
        <span className={`count${open ? " hot" : ""}`} title={open ? `${open} ports open to the internet` : undefined}>
          {open || sockets.length}
        </span>
        {m.stale ? <span className="sub">last good read; the newest one failed</span> : null}
      </PanelHead>
      {m.error ? <p className="sub net-note">Could not read this machine: {m.error}</p> : null}
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
                <SocketRow key={g.key} g={g} machine={m.name} fw={m.network?.firewall} />
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
        {" · "}
        {firewallNote(m.network?.firewall)}
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

/** The Network page (collector#65): what each machine listens on, and whether anyone can reach it. Read only —
 * nothing here blocks, opens or closes a port, and no port is scanned from outside: this is what each machine says
 * it listens on. A port open to the internet is also an error row in Needs attention. */
export function NetworkPage() {
  const { data } = useApi<{ at: number; machines: MachineNetwork[] }>("/api/network", 15_000);
  const machines = data?.machines || [];
  useFirstRow(Boolean(data));
  return (
    <div className="page">
      <div className="page-head">
        <h1>Network</h1>
        <p>Every port each machine listens on, and who can connect to it.</p>
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
