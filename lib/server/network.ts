import { snapshot } from "./machines";

export type Reach = "internet" | "firewalled" | "lan" | "tailnet" | "machine";

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
  firewall?: "allows" | "blocks" | null;
  tailnet_from?: string[] | null;
}

export interface Firewall {
  tool: string;
  active: boolean;
  incoming: string;
}

export interface MachineNetworks {
  lan: string[];
  internet: string[];
  tailnet: string | null;
}

export interface NetworkConnection {
  proto: string;
  address: string | null;
  port: number | null;
  local_address?: string | null;
  local_port?: number | null;
  process: string | null;
  pid: string | null;
  bytes_sent: number | null;
  bytes_received: number | null;
  bytes_scope?: "socket" | "process" | null;
  inbound?: boolean;
  host?: string | null;
}

export interface NetworkSsh {
  source: string | null;
  passwordauthentication: boolean;
  permitrootlogin: boolean;
}

export interface NetworkRead {
  networks: MachineNetworks;
  os?: string | null;
  tailnet_peers?: Record<string, string>;
  firewall?: Firewall | null;
  sockets: NetworkSocket[];
  ssh: NetworkSsh | null;
  connections?: NetworkConnection[];
}

export interface MachineNetwork {
  name: string;
  local: boolean;
  read_at: number | null;
  stale: boolean;
  error: string | null;
  network: NetworkRead | null;
}

export function exposedSockets(m: { network?: NetworkRead | null } | null | undefined): NetworkSocket[] {
  return (m?.network?.sockets || []).filter((s) => s?.reach === "internet");
}

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
