import { snapshot } from "./machines";

/** Who can connect to a listening port (collector#65), the most exposed first: anyone on the internet; the internet
 * through a port the firewall opens on purpose (`firewalled`, no warning); the machines on the machine's local
 * network; the machines on its tailnet; the machine alone. */
export type Reach = "internet" | "firewalled" | "lan" | "tailnet" | "machine";

/** One listening port of a machine, as `collect.py` read it: its IPv4 and IPv6 sockets are one row, with every address
 * it is bound on. `tailnet` is true when the machine's tailnet can connect to it as well (a port on every address). */
/** What the tooltip on a process name says: its full name, what it is when it is a program we know, how long it has
 * run, what started it, its user and its path. Null for a socket with no process. */
export interface ProcessInfo {
  name: string | null;
  about: string | null;
  seconds: number | null;
  started_by: string | null;
  user: string | null;
  path: string | null;
}

export interface NetworkSocket {
  info?: ProcessInfo | null;
  proto: string;
  port: number;
  addresses: string[];
  process: string | null;
  pid: string | null;
  reach: Reach;
  tailnet: boolean;
  /** What the machine's firewall did with this port: "allows" the internet in, "blocks" it (the reach is what the
   * firewall lets through), or null when no firewall was read. */
  firewall?: "allows" | "blocks" | null;
}

/** The machine's firewall as collect.py read it (ufw), or null when none was read. */
export interface Firewall {
  tool: string;
  active: boolean;
  incoming: string;
}

/** The networks a machine is on, read from its own addresses: the private ones (a home Wi-Fi), its public addresses
 * (a VPS) and its Tailscale address. */
export interface MachineNetworks {
  lan: string[];
  internet: string[];
  tailnet: string | null;
}

/** The two sshd settings that should not be on, and where they were read (or null on a machine that was never asked
 * — a Mac, or one with no sshd). */
export interface NetworkSsh {
  source: string | null;
  passwordauthentication: boolean;
  permitrootlogin: boolean;
}

export interface NetworkRead {
  networks: MachineNetworks;
  firewall?: Firewall | null;
  sockets: NetworkSocket[];
  ssh: NetworkSsh | null;
}

/** One machine's Network section, with how its read went: a machine whose read failed keeps its last good one, marked
 * stale, the way every other read here does. */
export interface MachineNetwork {
  name: string;
  local: boolean;
  read_at: number | null;
  stale: boolean;
  error: string | null;
  network: NetworkRead | null;
}

/** The ports anyone on the internet can connect to: the ones the Dashboard warns about. */
export function exposedSockets(m: { network?: NetworkRead | null } | null | undefined): NetworkSocket[] {
  return (m?.network?.sockets || []).filter((s) => s?.reach === "internet");
}

/** The Network page's read, and what an agent asks: is anything open that should not be? One machine each, in the
 * order `machines` names them, from the same read the rest of the page uses (every 10 seconds, no extra ssh). */
export async function network(): Promise<{ at: number; machines: MachineNetwork[] }> {
  const snap = await snapshot.get();
  return {
    at: snap.at,
    machines: (snap.machines || []).map((m: any) => ({
      name: m.name,
      local: !!m.local,
      read_at: m.read_at ?? null,
      stale: !!m.stale,
      error: m.error ?? null,
      network: m.network ?? null,
    })),
  };
}
