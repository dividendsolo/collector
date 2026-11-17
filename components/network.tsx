"use client";

import { type Check, securityChecks, WHY_OPEN, worst } from "@/lib/checks";
import { bytes } from "@/lib/format";
import type {
  Firewall,
  MachineNetwork,
  MachineNetworks,
  NetworkConnection,
  NetworkSocket,
  ProcessInfo,
} from "@/lib/server/network";
import { useApi } from "./data";
import { Icon, PanelHead, Pill, SkelRows } from "./ui";

interface Badge {
  cls: string;
  text: string;
  tone: "red" | "blue" | "amber" | "green" | "grey";
  about: string;
  facts: [string, string][];
}

function accessibleTo(
  s: NetworkSocket,
  machine: string,
  fw: Firewall | null | undefined,
  nets: MachineNetworks | undefined,
  ports: string = String(s.port),
  peers?: Record<string, string>,
): Badge[] {
  const port = `${s.proto} ${ports}${s.process ? ` (${s.process})` : ""}`;
  const fwName = fw?.tool ?? "the firewall";
  const tailnet: Badge = {
    cls: "net-tailnet",
    text: "Tailnet",
    tone: "green",
    about: `Your own private network on Tailscale${nets?.tailnet ? `: ${machine} is ${nets.tailnet} on it` : ""}.`,
    facts: [
      [
        "Who can connect",
        s.tailnet_from?.length
          ? `${s.tailnet_from.map((ip) => peers?.[ip.split("/")[0]] ?? ip.split("/")[0]).join(", ")}, from anywhere: the only devices Tailscale's access rules let reach this machine`
          : "only devices signed in to your Tailscale account, from anywhere",
      ],
      [
        "What keeps others out",
        "Tailscale: every connection is encrypted, needs one of your devices' keys, and passes its access rules",
      ],
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
          s.process && WHY_OPEN[s.process]
            ? ["Why it is open", WHY_OPEN[s.process]]
            : ["Note", "opened on purpose is not the same as safe: check the program is meant to face the world"],
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

function networkFacts(n: MachineNetworks | undefined): string | undefined {
  if (!n) return undefined;
  const facts: [string, string][] = [];
  if (n.internet.length) facts.push(["Public address", n.internet.join(", ")]);
  if (n.lan.length) facts.push(["Local network", n.lan.join(", ")]);
  if (n.tailnet) facts.push(["Tailnet address", n.tailnet]);
  return facts.length ? JSON.stringify(facts) : undefined;
}

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

function firstOfProcess(connections: NetworkConnection[]): boolean[] {
  const seen = new Set<string>();
  return connections.map((c) => {
    const key = `${c.process ?? ""}/${c.pid ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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

function portsText(g: PortGroup): { ports: string; protos: string } {
  const sets = [...g.byPort.values()].map((p) => [...p].sort().join("/"));
  if (sets.every((x) => x === sets[0])) return { ports: g.ports.join(", "), protos: sets[0] || "" };
  return {
    ports: g.ports.map((p) => `${p}/${[...(g.byPort.get(p) || [])].sort().join("/")}`).join(", "),
    protos: "mixed",
  };
}

function runFor(s: number | null | undefined): string | null {
  if (s == null) return null;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} ${d === 1 ? "day" : "days"} ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

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
  peers,
  anchor,
}: {
  anchor?: string;
  g: PortGroup;
  machine: string;
  fw: Firewall | null | undefined;
  nets: MachineNetworks | undefined;
  peers?: Record<string, string>;
}) {
  const badges = accessibleTo(g.first, machine, fw, nets, g.ports.join(", "), peers);
  const { ports, protos } = portsText(g);
  return (
    <tr id={anchor} data-reach={g.first.reach}>
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
          <span className="sub" title="Another user's process: ss shows yours without sudo">
            —
          </span>
        )}
      </td>
    </tr>
  );
}

const NetCols = () => (
  <colgroup>
    <col style={{ width: "26%" }} />
    <col style={{ width: "22%" }} />
    <col style={{ width: "8%" }} />
    <col style={{ width: "18%" }} />
    <col style={{ width: "26%" }} />
  </colgroup>
);

const DOT: Record<string, string> = { green: "ok", amber: "warn", red: "bad", grey: "unread" };

function Checks({ checks }: { checks: Check[] }) {
  return (
    <ul className="net-checks">
      {checks.map((c) => (
        <li
          key={c.id}
          id={c.id}
          className="card-tip-plain"
          data-tip={c.about}
          data-tip-title={c.label}
          data-tip-facts={c.facts.length ? JSON.stringify(c.facts) : undefined}
          data-tip-tone={c.level}
          tabIndex={0}
        >
          <span className={`check-dot ${DOT[c.level]}`} aria-hidden="true" />
          <span className="check-label">{c.label}</span>
          <span className="check-value">{c.value}</span>
        </li>
      ))}
    </ul>
  );
}

const VERDICT: Record<string, string> = {
  green: "Every check passes.",
  red: "A check needs a fix.",
  amber: "Some settings are weak: worth fixing, your call.",
  grey: "Some checks could not be read.",
};

function MachineSummary({ m }: { m: MachineNetwork }) {
  const checks = securityChecks(m.name, m.network, m.network?.firewall?.tool === "macOS firewall");
  const verdict = worst(checks);
  return (
    <section className="panel">
      <PanelHead
        icon="shield"
        iconClass={`net-shield ${DOT[verdict]}`}
        title={m.local ? `${m.name} (this machine)` : m.name}
      >
        {m.network?.os ? <span className="net-os">{m.network.os}</span> : null}
      </PanelHead>
      {m.network ? (
        <div className="net-checks-wrap">
          <div className={`net-verdict ${DOT[verdict]}`}>{VERDICT[verdict]}</div>
          <Checks checks={checks} />
        </div>
      ) : (
        <p className="sub net-note">{m.error ? `Could not read this machine: ${m.error}` : "Not read yet."}</p>
      )}
    </section>
  );
}

function Machine({ m }: { m: MachineNetwork }) {
  const sockets = m.network?.sockets || [];
  const connections = m.network?.connections || [];
  const firsts = firstOfProcess(connections);
  const open = sockets.filter((s) => s.reach === "internet").length;
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
      <p className="sub net-note">
        Going out:{" "}
        {connections.length
          ? `${connections.length} ${connections.length === 1 ? "connection" : "connections"}`
          : "nothing is connected out"}
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
              {groupPorts(sockets).map((g, i, all) => (
                <SocketRow
                  key={g.key}
                  anchor={
                    all.findIndex((x) => x.first.reach === "internet") === i ? `ports:${m.name}:internet` : undefined
                  }
                  g={g}
                  machine={m.name}
                  fw={m.network?.firewall}
                  nets={m.network?.networks}
                  peers={m.network?.tailnet_peers}
                />
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
    </section>
  );
}

export function NetworkPage() {
  const { data } = useApi<{ at: number; machines: MachineNetwork[] }>("/api/network", 15_000);
  const machines = data?.machines || [];
  return (
    <div className="page">
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
        <>
          <div className="pair">
            {machines.map((m) => (
              <MachineSummary key={m.name} m={m} />
            ))}
          </div>
          {machines.map((m) => (
            <Machine key={m.name} m={m} />
          ))}
        </>
      )}
    </div>
  );
}
