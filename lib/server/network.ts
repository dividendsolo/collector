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
