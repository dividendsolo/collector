import dns from "node:dns";

/**
 * The host name of the addresses a machine is connected out to (collector#66): the Going out table on the Network
 * page shows it, so a person reads `downloads.example.com` rather than `198.51.100.1`. Reverse DNS is a nicety and
 * never a reason to hold a read up: an answer that takes longer than `DNS_TIMEOUT_MS` is no answer, and an address
 * that has none is remembered as having none, so it is never asked again.
 *
 * The cache is this server process's memory, not a file: a read runs every ten seconds, and an address is looked up
 * once per address, not once per read. A restart costs one lookup per address. Nothing else about a connection is
 * remembered anywhere (collector#75).
 */
export const DNS_TIMEOUT_MS = 700;

/** Names kept in the cache: enough for a busy machine's week, never a map that grows without end. */
const MAX_NAMES = 200;

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
 * The names of the addresses a read found, from the cache where it has one: each address is looked up once ever,
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
  return Object.fromEntries(Object.entries(names).slice(-MAX_NAMES));
}

/** The names one server process keeps, so an address is asked about once rather than once per read. */
let names: Record<string, string> = {};

/** Test hook: forget the in-memory cache, so the next read asks again. */
export function resetNames() {
  names = {};
}

/**
 * Fill in the host name of every connection each machine has going out, and hand the machines back: the same read
 * the rest of the page uses, so it costs no extra ssh, and a machine whose read failed is left as it is. Nothing is
 * kept of it but the names: no other state, no file, no mark (collector#75).
 */
export async function withHostNames(
  machines: any[],
  lookup: (ip: string) => Promise<string> = reverseName,
): Promise<any[]> {
  names = await resolveNames(
    machines.flatMap((m) => (m?.network?.connections || []).map((c: any) => c.address)),
    names,
    lookup,
  );
  return machines.map((m) => {
    const connections = m?.network?.connections;
    if (!connections) return m;
    return {
      ...m,
      network: {
        ...m.network,
        connections: connections.map((c: any) => ({ ...c, host: c.address ? names[c.address] || null : null })),
      },
    };
  });
}
