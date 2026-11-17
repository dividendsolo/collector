import dns from "node:dns";

export const DNS_TIMEOUT_MS = 700;

const MAX_NAMES = 200;

export async function reverseName(ip: string): Promise<string> {
  try {
    const names = await dns.promises.reverse(ip);
    return (names[0] || "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

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
      return [ip, name.replace(/\.$/, "")] as const;
    }),
  );
  for (const [ip, name] of found) names[ip] = name;
  return Object.fromEntries(Object.entries(names).slice(-MAX_NAMES));
}

let names: Record<string, string> = {};

export function resetNames() {
  names = {};
}

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
