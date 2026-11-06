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

/** One "Accessible to" badge: its colour, its word, and the card it opens on hover: a one-line definition, then who
 * can connect, what keeps others out, how an attacker gets in, and this port (James, 2026-11-06). */
interface Badge {
  cls: string;
  text: string;
  tone: "red" | "blue" | "amber" | "green" | "grey";
  about: string;
  facts: [string, string][];
}

/** Who can connect to a port, one badge per group: red for the internet, blue for a port the firewall opens on
 * purpose (Firewalled), amber for the local network, green for the tailnet, grey for the machine alone. A port on
 * every address carries the tailnet as a badge of its own. */
function accessibleTo(
  s: NetworkSocket,
  machine: string,
  fw: Firewall | null | undefined,
  nets: MachineNetworks | undefined,
  ports: string = String(s.port),
): Badge[] {
  const port = `${s.proto} ${ports}${s.process ? ` (${s.process})` : ""}`;
  const fwName = fw?.tool ?? "the firewall";
  const tailnet: Badge = {
    cls: "net-tailnet",
    text: "Tailnet",
    tone: "green",
    about: `Your own private network on Tailscale${nets?.tailnet ? `: ${machine} is ${nets.tailnet} on it` : ""}.`,
    facts: [
      ["Who can connect", "only devices signed in to your Tailscale account, from anywhere"],
      ["What keeps others out", "Tailscale: every connection is encrypted and needs one of your devices' keys"],
      ["How an attacker gets in", "a stolen Tailscale login, or a lost laptop or phone that is still signed in"],
      [
        "This port",
        s.firewall === "blocks" ? `${port}: listens on every address, but ${fwName} lets only the tailnet in` : port,
      ],
    ],
  };
  const plus = s.tailnet ? [tailnet] : [];
  if (s.reach === "internet")
    return [
      {
        cls: "failed",
        text: "Internet",
        tone: "red",
        about: `Anyone in the world who can reach ${machine}'s public address${nets?.internet.length ? ` (${nets.internet[0]})` : ""}.`,
        facts: [
          ["Who can connect", "anyone on the internet"],
          [
            "What keeps others out",
            fw
              ? `nothing: ${fwName} is ${fw.active ? "on but lets everything in by default" : "off"}`
              : "unknown: the firewall was not read, so it may still block this port",
          ],
          ["How an attacker gets in", "scans the internet for open ports and connects straight to this one"],
          ["This port", port],
          ["What to do", "close it, or bind the program to 127.0.0.1 or the tailnet address"],
        ],
      },
      ...plus,
    ];
  if (s.reach === "firewalled")
    return [
      {
        cls: "net-firewalled",
        text: "Firewalled",
        tone: "blue",
        about: `${fwName} blocks every connection from the internet unless a rule lets it in, and a rule lets this port in.`,
        facts: [
          ["Who can connect", "anyone on the internet, on this port only"],
          ["What keeps others out", `${fwName}: every other port is closed to the internet`],
          ["How an attacker gets in", "through this open port, if the program behind it has a flaw"],
          ["This port", port],
          ["Note", "opened on purpose is not the same as safe: the program is meant to face the world"],
        ],
      },
      ...plus,
    ];
  if (s.reach === "lan")
    return [
      {
        cls: "warning",
        text: "Local network",
        tone: "amber",
        about: `Devices on the same Wi-Fi or wired network as ${machine}${nets?.lan.length ? ` (${nets.lan[0]})` : ""}.`,
        facts: [
          ["Who can connect", "phones, TVs, smart plugs and guests on your Wi-Fi"],
          [
            "What keeps others out",
            "your router, in two ways: its Wi-Fi password keeps out people nearby, and it drops every connection " +
              "that comes from the internet",
          ],
          [
            "How an attacker gets in",
            "a leaked or weak Wi-Fi password, a guest you gave the password to, or a hacked device already on " +
              "your network",
          ],
          ["This port", port],
        ],
      },
      ...plus,
    ];
  if (s.reach === "tailnet") return [tailnet];
  return [
    {
      cls: "",
      text: `Only ${machine}`,
      tone: "grey",
      about: `Programs running on ${machine} itself, and nothing else.`,
      facts: [
        ["Who can connect", `only programs on ${machine}`],
        [
          "What keeps others out",
          s.firewall === "blocks"
            ? `${fwName}: it blocks this port from every network`
            : "the loopback address (127.0.0.1 or ::1): no other machine can reach it",
        ],
        ["How an attacker gets in", `only with a program already running on ${machine}`],
        ["This port", port],
      ],
    },
  ];
}

/** What the page says about the machine's firewall, under its table. */
function firewallNote(fw: Firewall | null | undefined): string {
  if (!fw) return "firewall not read, so a port listed here may still be blocked";
  if (!fw.active) return `${fw.tool} is off: nothing is blocked`;
  return `${fw.tool} is on (incoming: ${fw.incoming}); each port shows who it lets in`;
}

/** The networks a machine is on, as the facts of the tooltip on its name: kept off the page itself, so a screenshot
 * or a screen share does not carry the machine's addresses (James, 2026-11-06). */
function networkFacts(n: MachineNetworks | undefined): string | undefined {
  if (!n) return undefined;
  const facts: [string, string][] = [];
  if (n.internet.length) facts.push(["Public address", n.internet.join(", ")]);
  if (n.lan.length) facts.push(["Local network", n.lan.join(", ")]);
  if (n.tailnet) facts.push(["Tailnet address", n.tailnet]);
  return facts.length ? JSON.stringify(facts) : undefined;
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

function SocketRow({
  g,
  machine,
  fw,
  nets,
}: {
  g: PortGroup;
  machine: string;
  fw: Firewall | null | undefined;
  nets: MachineNetworks | undefined;
}) {
  // The badge card names this row's ports, all of them: the row may hold several (ControlCenter's 5000 and 7000).
  const badges = accessibleTo(
    { ...g.first, port: g.ports.length > 1 ? (g.ports.join(", ") as never) : g.first.port },
    machine,
    fw,
    nets,
  );
  const { ports, protos } = portsText(g);
  return (
    <tr data-reach={g.first.reach}>
      <td className="port">{ports}</td>
      <td className="net-badges">
        {badges.map((b) => (
          <span
            key={b.text}
            className="card-tip-plain"
            data-tip={b.about}
            data-tip-title={b.text}
            data-tip-facts={JSON.stringify(b.facts)}
            data-tip-tone={b.tone}
            tabIndex={0}
          >
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

/** The five columns at the same widths in every machine's table, so "Accessible to" lines up from one panel to the
 * next whatever a machine's longest port list is (James, 2026-11-06). The port list wraps inside its own column. */
const NetCols = () => (
  <colgroup>
    <col style={{ width: "26%" }} />
    <col style={{ width: "22%" }} />
    <col style={{ width: "8%" }} />
    <col style={{ width: "18%" }} />
    <col style={{ width: "26%" }} />
  </colgroup>
);

/** One machine's block: every port it listens on, with who can connect to each, the most exposed first. */
function Machine({ m }: { m: MachineNetwork }) {
  const sockets = m.network?.sockets || [];
  const open = sockets.filter((s) => s.reach === "internet").length;
  const ssh = sshNote(m.network?.ssh);
  const facts = networkFacts(m.network?.networks);
  const title = m.local ? `${m.name} (this machine)` : m.name;
  return (
    <section className="panel">
      <PanelHead icon="shield" title={title}>
        {facts ? (
          <span
            className="card-tip net-addresses"
            data-tip="The networks this machine is on. Hidden from the page so a screenshot does not carry them."
            data-tip-title={`${m.name}'s addresses`}
            data-tip-facts={facts}
            tabIndex={0}
          >
            addresses
          </span>
        ) : null}
        <span className={`count${open ? " hot" : ""}`} title={open ? `${open} ports open to the internet` : undefined}>
          {open || sockets.length}
        </span>
        {m.stale ? <span className="sub">last good read; the newest one failed</span> : null}
      </PanelHead>
      {m.error ? <p className="sub net-note">Could not read this machine: {m.error}</p> : null}
      {sockets.length ? (
        <div className="wrap">
          <table className="net-table">
            <NetCols />
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
                <SocketRow key={g.key} g={g} machine={m.name} fw={m.network?.firewall} nets={m.network?.networks} />
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
