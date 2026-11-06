import { snapshot } from "./machines";

/** One listening socket of a machine, as `collect.py` read it (collector#65): `open` is the one that matters — bound
 * beyond this machine and not on the machine's allow list, so anyone who can reach the machine can reach it. */
export interface NetworkSocket {
  proto: string;
  address: string;
  port: number;
  process: string | null;
  pid: string | null;
  mark: "open" | "allowed" | "local";
}

/** One established connection of a machine (collector#66), as `collect.py` read it: the remote end, the local end,
 * the process that owns it, and the bytes the OS counted on that socket (`ss -i` on Linux, `nettop` on a Mac;
 * `null` where the tool counts none). `inbound` marks a connection that reached a port this machine listens on from
 * another device on the local network — the one the page flags. `host` is not `collect.py`'s: the server fills it
 * from reverse DNS. */
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
  inbound?: boolean;
  host?: string | null;
}

/** One thing that is new about a machine's network (collector#66): a process never seen there, a new destination
 * for a process it knows, an upload over the threshold, or a knock from the local network. It stays until someone
 * clicks Seen (`GET /api/network` carries the marks; `POST /api/network/seen` drops one). */
export interface NetworkMark {
  id: string;
  kind: "process" | "destination" | "upload" | "inbound";
  process: string | null;
  pid: string | null;
  host: string | null;
  address: string | null;
  port: number | null;
  /** The bytes it sent since the last read (an upload), else null. */
  bytes: number | null;
  at: number;
}

/** The two sshd settings that should not be on, and where they were read (or null on a machine that was never asked
 * — a Mac, or one with no sshd). */
export interface NetworkSsh {
  source: string | null;
  passwordauthentication: boolean;
  permitrootlogin: boolean;
}

export interface NetworkRead {
  allow: number[];
  sockets: NetworkSocket[];
  ssh: NetworkSsh | null;
  /** Every established connection this machine has, with its remote end and its bytes (collector#66). */
  connections?: NetworkConnection[];
  /** The megabytes a process may send between two reads before it is marked; `network.uploadWarnMB`. */
  upload_warn_mb?: number;
  /** What is new about this machine's network, from the seen-list the server keeps (collector#66). */
  marks?: NetworkMark[];
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

/** The sockets open to everyone on one machine: the mark `collect.py` worked out against the machine's own allow
 * list, one row per port — `ss` and `lsof` each print the same socket twice when it is bound on both an IPv4 and an
 * IPv6 address, which is one thing to fix, not two. */
export function openSockets(m: { network?: NetworkRead | null } | null | undefined): NetworkSocket[] {
  const seen = new Set<string>();
  const out: NetworkSocket[] = [];
  for (const s of m?.network?.sockets || []) {
    if (s?.mark !== "open") continue;
    const key = `${s.proto}:${s.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
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
