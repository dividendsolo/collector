export const VENDOR_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, ok: 3, "no feed": 4 };

export const HEAVY_CRITICALITY = new Set(["high", "critical"]);

export const vendorHit = (v: { state: string }) => VENDOR_RANK[v.state] <= VENDOR_RANK.minor;

export function vendorOrder<T extends { name: string; state: string; criticality?: string }>(rows: T[]): T[] {
  const heavy = (v: T) => Number(HEAVY_CRITICALITY.has(v.criticality || "") && vendorHit(v));
  return [...rows].sort(
    (a, b) => heavy(b) - heavy(a) || VENDOR_RANK[a.state] - VENDOR_RANK[b.state] || a.name.localeCompare(b.name),
  );
}
