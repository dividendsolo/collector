import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import type { NetworkConnection, NetworkMark } from "./network";
import { CONFIG_PATH } from "./paths";

/**
 * The seen-list (collector#66): what each machine has been seen doing on the network, so the read can say what is
 * new about it — a process never seen there before, a new destination for a process it knows, more than
 * `network.uploadWarnMB` sent since the last read, or a knock on a listening port from another device on the local
 * network. Collector has no database, so this is one small JSON file next to its other state (beside `config.json`,
 * or `COLLECTOR_CONFIG`'s folder when that points somewhere else — which is how the tests point it at a temp file);
 * `COLLECTOR_SEEN` names the file itself. It is gitignored and never committed, and it is the one thing this page
 * writes: a mark leaves it only when someone clicks Seen.
 */
export interface SeenMachine {
  /** The read this state was last folded from, or null: the machine has never been read, and its first read fills
   * the list and marks nothing. */
  at: number | null;
  /** Process name -> the sites seen for it (`example.com`, from the name reverse DNS gave; an older file may also hold
   * full names and addresses, which compare by site the same way). */
  processes: Record<string, string[]>;
  /** Process name -> the bytes it had sent at the last read, which is what a large upload is measured from. */
  bytes: Record<string, number>;
  /** `local port/peer address` pairs already seen knocking from the local network. */
  inbound: string[];
  /** Address -> its reverse DNS name; "" is an address that was asked and had none, so it is not asked again. */
  names: Record<string, string>;
  /** The marks nobody has clicked Seen on, newest last. */
  marks: NetworkMark[];
}

export interface SeenState {
  machines: Record<string, SeenMachine>;
}

/** A megabyte as the network counters mean it: 1,000,000 bytes, the decimal one nettop and ss counts in. */
export const MB = 1_000_000;
export const DEFAULT_UPLOAD_WARN_MB = 50;
/** Destination marks kept per machine, and names cached per machine: enough to be useful, never a file that grows
 * without end. Only destination marks are capped: a process, upload or knock mark leaves only through Seen. */
const MAX_DEST_MARKS = 50;
/** The most marks a machine keeps in all, a ceiling no ordinary day reaches: past it the oldest go, so a local device
 * that knocks from address after address cannot grow the seen-list without end. */
export const MAX_MARKS_CEILING = 500;
const MAX_NAMES = 200;
const MAX_DESTS = 200;
/** Reverse DNS is a nicety, never a reason to hold a read up: an answer that takes longer than this is no answer. */
export const DNS_TIMEOUT_MS = 700;

/**
 * The seen-list is read, changed and written whole, so its steps run one at a time. A Seen click that lands while a
 * read is folding must not be undone by that read writing back the state it read before the click — caught live on
 * 2026-11-06, when a mark came back one read after it was cleared — and two reads folding at once must not each
 * write the other's state away. Everything that touches the file goes through here.
 */
let tail: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T> | T): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function seenPath(): string {
  return process.env.COLLECTOR_SEEN || path.join(path.dirname(CONFIG_PATH), "network-seen.json");
}

/** The seen-list, or an empty one on a file that is missing, unreadable or not the shape we wrote. */
export function readSeen(): SeenState {
  try {
    const raw = JSON.parse(fs.readFileSync(seenPath(), "utf8"));
    const machines: Record<string, SeenMachine> = {};
    for (const [name, m] of Object.entries<any>(raw?.machines || {})) {
      if (!m || typeof m !== "object") continue;
      machines[name] = {
        at: typeof m.at === "number" ? m.at : null,
        processes: m.processes && typeof m.processes === "object" ? m.processes : {},
        bytes: m.bytes && typeof m.bytes === "object" ? m.bytes : {},
        inbound: Array.isArray(m.inbound) ? m.inbound : [],
        names: m.names && typeof m.names === "object" ? m.names : {},
        marks: Array.isArray(m.marks) ? m.marks : [],
      };
    }
    return { machines };
  } catch {
    return { machines: {} };
  }
}

/** Write the seen-list, unless the file already holds exactly this. Written whole, so a half-written file cannot be
 * read as a shorter seen-list than it is. */
export function writeSeen(state: SeenState) {
  const p = seenPath();
  const text = `${JSON.stringify(state, null, 2)}\n`;
  try {
    if (fs.readFileSync(p, "utf8") === text) return;
  } catch {
    // No file yet: write one.
  }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  } catch {
    // Read only where Collector runs cannot write (a stranger's first run): the marks still show for this read.
  }
}

/** This machine itself: 127.0.0.0/8, ::1, and the IPv4-mapped form of a loopback address. */
export function isLoopback(address: string | null | undefined): boolean {
  const a = (address || "").replace(/^\[|\]$/g, "").toLowerCase();
  return a === "::1" || /^(::ffff:)?127\./.test(a);
}

/** Second-level labels a registry sells names under (`example.co.uk`), so the site is the last three labels. */
const SHARED_SUFFIXES = new Set(["co", "com", "net", "org", "ac", "gov", "edu", "ne", "or"]);

/**
 * The site a host name belongs to: its last two labels (`github.com` for `lb-140-82-112-3-iad.github.com`), or three
 * under a two-letter country code sold by second level (`example.co.uk`). An address is its own site. A new
 * load-balancer or CDN name of a site a process already reaches is not somewhere new (collector#66: one quiet minute
 * marked `lb-140-82-112-3-iad.github.com` after `lb-140-82-114-3-iad.github.com`).
 */
export function domainOf(dest: string): string {
  const d = dest.toLowerCase().replace(/\.$/, "");
  if (/^[0-9.]+$/.test(d) || d.includes(":")) return d;
  const labels = d.split(".");
  if (labels.length <= 2) return d;
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const keep = tld.length === 2 && SHARED_SUFFIXES.has(second) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** True when a process has been seen reaching this destination, or another name of the same site. */
function knownDest(seen: string[], dest: string): boolean {
  if (seen.includes(dest)) return true;
  const site = domainOf(dest);
  return seen.some((s) => domainOf(s) === site);
}

/** "host:port" or "address:port", the way a mark names where a connection went. */
export function destText(m: { host?: string | null; address?: string | null; port?: number | null }): string {
  const where = m.host || m.address || "";
  const port = m.port == null ? "" : `:${m.port}`;
  if (!where) return port ? `port ${port.slice(1)}` : "somewhere";
  return `${where}${port}`;
}

/**
 * Fold one machine's read into its seen-list, and hand back the state to keep plus the marks it earned. Pure: the
 * tests drive it with fixture connections and no clock of its own.
 *
 * The first read (nothing seen for this machine yet) fills the list and marks nothing — otherwise a fresh install
 * would report every process on the machine as new. After that:
 *
 * - a process whose name is not in the list: one mark for the process (its destinations are recorded with it, since
 *   "a new destination for a known process" says nothing about a process nobody has seen);
 * - a destination (host name, or the address) a known process has not been seen going to: one mark;
 * - a process that sent more than the threshold over what it had sent at the last read: one mark;
 * - a connection that reached a port this machine listens on from another device on the local network: one mark.
 *
 * Every mark stays in the state until Seen drops it, and the fact behind it stays in the list, so clearing a mark
 * clears it for good: a known process does not become new again, and a large upload is measured from the read
 * before. An upload that keeps going does earn a new mark, which is what "since the last read" means.
 */
export function foldRead(
  prev: SeenMachine | undefined,
  rows: NetworkConnection[],
  opts: { now: number; uploadWarnMB?: number | null },
): SeenMachine {
  const limit =
    (typeof opts.uploadWarnMB === "number" && opts.uploadWarnMB > 0 ? opts.uploadWarnMB : DEFAULT_UPLOAD_WARN_MB) * MB;
  // Nothing read yet for this machine: this read is what fills the list, and it marks nothing.
  const first = !prev || prev.at == null;
  const processes: Record<string, string[]> = { ...(prev?.processes || {}) };
  const bytes: Record<string, number> = {};
  const inbound = new Set(prev?.inbound || []);
  const marks: NetworkMark[] = [...(prev?.marks || [])];
  const have = new Set(marks.map((m) => m.id));
  const add = (mark: NetworkMark) => {
    if (have.has(mark.id)) return;
    have.add(mark.id);
    marks.push(mark);
  };

  // A Mac counts bytes per process, not per socket (`bytes_scope` "process"): every connection of the process carries
  // the same total, so it is counted once per pid, however many connections that process has open. A socket's own
  // bytes (`ss` on Linux) add up across the process's sockets.
  const counted = new Set<string>();
  for (const c of rows || []) {
    if (c.inbound) {
      const key = `${c.local_port ?? ""}/${c.address ?? ""}`;
      if (!first && c.address && !inbound.has(key))
        add({
          id: `inbound:${key}`,
          kind: "inbound",
          process: c.process ?? null,
          pid: c.pid ?? null,
          host: c.host ?? null,
          address: c.address,
          port: c.local_port ?? null,
          bytes: null,
          at: opts.now,
        });
      inbound.add(key);
      continue;
    }
    // This machine talking to itself is never a destination (collect.py leaves those out; a read from before it did
    // must not mark them either).
    if (isLoopback(c.address)) continue;
    const name = c.process;
    if (!name) continue; // A socket of another user's process: no name to say a process is new by.
    const seen = processes[name];
    if (!first) {
      if (!seen)
        add({
          id: `process:${name}`,
          kind: "process",
          process: name,
          pid: c.pid ?? null,
          host: c.host ?? null,
          address: c.address ?? null,
          port: c.port ?? null,
          bytes: null,
          at: opts.now,
        });
      // Only a named host is a destination worth a mark: most CDN and cloud addresses have no reverse name, and a
      // bare address is not a place a person recognises (collector#66's second review: three minutes on a Mac made
      // 29 marks of one dev server reaching Cloudflare's unnamed 104.x and 172.67.x). A new process and an upload
      // still mark whatever the address.
      else if (c.host && !knownDest(seen, c.host))
        add({
          id: `destination:${name}:${domainOf(c.host)}`,
          kind: "destination",
          process: name,
          pid: c.pid ?? null,
          host: c.host ?? null,
          address: c.address ?? null,
          port: c.port ?? null,
          bytes: null,
          at: opts.now,
        });
    }
    // Kept by site, the only thing a destination is compared by, so a browser's stream of addresses cannot push
    // the sites it is known to reach out of the list.
    processes[name] = [...new Set([...(seen || []), ...(c.host ? [domainOf(c.host)] : [])])].slice(-MAX_DESTS);
    if (typeof c.bytes_sent === "number") {
      if (c.bytes_scope === "process") {
        const key = `${name}/${c.pid ?? ""}`;
        if (counted.has(key)) continue;
        counted.add(key);
      }
      bytes[name] = (bytes[name] || 0) + c.bytes_sent;
    }
  }

  // What each process sent since the last read: an upload is the jump over the threshold, not the total. A process
  // the read has seen before but counted nothing for (a socket that had carried no bytes, or one that has closed
  // since) is measured from nothing, since what it sent before was not counted either.
  for (const [name, total] of Object.entries(bytes)) {
    const counted = prev?.bytes?.[name];
    const last = typeof counted === "number" ? counted : 0;
    if (first || total - last <= limit) continue;
    const row = (rows || []).find((r) => !r.inbound && r.process === name);
    add({
      id: `upload:${name}`,
      kind: "upload",
      process: name,
      pid: row?.pid ?? null,
      host: row?.host ?? null,
      address: row?.address ?? null,
      port: row?.port ?? null,
      bytes: total - last,
      at: opts.now,
    });
  }

  return {
    at: opts.now,
    processes,
    bytes,
    inbound: [...inbound].slice(-MAX_NAMES),
    names: prev?.names || {},
    marks: capDestinations(marks),
  };
}

/**
 * The marks to keep: every one but the oldest destination marks past `MAX_DEST_MARKS`. The card says a mark shows
 * until Seen, so a process or upload mark is never dropped (collector#66's second review: a burst of
 * destination marks pushed them out within minutes); the destination marks are the many and the least telling. The
 * other cap is `MAX_MARKS_CEILING` on the knock marks, which only a flood reaches (a device knocking from address after
 * address). Process and upload marks are one per process name, so they are bounded already and never dropped.
 */
export function capDestinations(marks: NetworkMark[]): NetworkMark[] {
  return dropOldest(dropOldest(marks, "destination", MAX_DEST_MARKS), "inbound", MAX_MARKS_CEILING);
}

/** The marks with the oldest of one kind dropped until at most `max` of that kind are left; the rest keep their order. */
function dropOldest(marks: NetworkMark[], kind: NetworkMark["kind"], max: number): NetworkMark[] {
  let extra = marks.filter((m) => m.kind === kind).length - max;
  if (extra <= 0) return marks;
  return marks.filter((m) => {
    if (m.kind !== kind || extra <= 0) return true;
    extra--;
    return false;
  });
}

/** Reverse DNS for one address: its first name, without the trailing dot, or "" (asked, and there is none). */
export async function reverseName(ip: string): Promise<string> {
  try {
    const names = await dns.promises.reverse(ip);
    return (names[0] || "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

/**
 * The names of the addresses this read found, from the cache where it has one: each address is looked up once ever,
 * with `DNS_TIMEOUT_MS` on it (a name that takes longer is no name), and a name once learned is kept. `lookup` is
 * the resolver, so a test can hand in its own instead of asking the network.
 */
export async function resolveNames(
  addresses: (string | null | undefined)[],
  cache: Record<string, string>,
  lookup: (ip: string) => Promise<string> = reverseName,
): Promise<Record<string, string>> {
  const names: Record<string, string> = { ...cache };
  const fresh = [...new Set(addresses.filter((a): a is string => !!a))].filter(
    (a) => !(a in names) && !a.startsWith("127.") && a !== "::1",
  );
  const found = await Promise.all(
    fresh.map(async (ip) => {
      const timer = new Promise<string>((r) => setTimeout(() => r(""), DNS_TIMEOUT_MS));
      const name = (await Promise.race([lookup(ip).catch(() => ""), timer])) || "";
      // A name is kept without the root dot PTR records end with, so two answers for one address read the same.
      return [ip, name.replace(/\.$/, "")] as const;
    }),
  );
  for (const [ip, name] of found) names[ip] = name;
  const kept = Object.entries(names).slice(-MAX_NAMES);
  return Object.fromEntries(kept);
}

/** One machine's read folded into its seen-list: its connections carry the names reverse DNS gave them, then the
 * marks the fold worked out. */
export async function observe(
  prev: SeenMachine | undefined,
  machine: { name: string; network?: any },
  now: number,
  lookup: (ip: string) => Promise<string> = reverseName,
): Promise<{ state: SeenMachine; connections: NetworkConnection[] }> {
  const connections: NetworkConnection[] = machine.network?.connections || [];
  const names = await resolveNames(
    connections.map((c) => c.address),
    prev?.names || {},
    lookup,
  );
  const rows = connections.map((c) => ({ ...c, host: c.address ? names[c.address] || null : null }));
  const state = foldRead(prev, rows, { now, uploadWarnMB: machine.network?.upload_warn_mb ?? null });
  state.names = names;
  return { state, connections: rows };
}

/**
 * Fold every machine's read into the seen-list, once per read, and write it back: the marks ride on that machine's
 * Network section, and so do its connections with the host names that were resolved for them, so the Network page
 * and Needs attention read the same ones. A machine whose read failed keeps its last good read (and the marks it
 * had) rather than folding an empty one.
 */
export async function observeAll(
  machines: any[],
  now: number,
  lookup: (ip: string) => Promise<string> = reverseName,
): Promise<any[]> {
  return oneAtATime(async () => {
    const state = readSeen();
    const out = await Promise.all(
      machines.map(async (m) => {
        if (!m?.name || m.error || !m.network) return m;
        const next = await observe(state.machines[m.name], m, now, lookup);
        state.machines[m.name] = next.state;
        return { ...m, network: { ...m.network, connections: next.connections, marks: next.state.marks } };
      }),
    );
    writeSeen(state);
    return out;
  });
}

/** Drop one mark a machine carries, because someone clicked Seen. Hands back what is left, so the click's answer is
 * the list it now has. The fact behind the mark stays in the seen-list, which is what keeps it from coming back. */
export async function clearMark(machine: string, id: string): Promise<{ cleared: boolean; marks: NetworkMark[] }> {
  return oneAtATime(() => {
    const state = readSeen();
    const seen = state.machines[machine];
    if (!seen) return { cleared: false, marks: [] };
    const before = seen.marks.length;
    seen.marks = seen.marks.filter((m) => m?.id !== id);
    writeSeen(state);
    return { cleared: seen.marks.length < before, marks: seen.marks };
  });
}
