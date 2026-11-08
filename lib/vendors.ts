/** The APIs page's reading of a vendor's own status: which vendors count as hit, and the order the page draws them
 * in. Client-safe, the way `lib/statuses.ts` is: the page and the sidebar's count both read it, and no reader is
 * needed for it. The order leads with a vendor we can least do without and that is showing an incident
 * (collector#78). */

/** Worst first: an outage above no feed at all. */
export const VENDOR_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, ok: 3, "no feed": 4 };

/** How much we depend on a vendor, from config.json's `vendors[].criticality`: `high` and `critical` are the two
 * that matter when one of them is having a bad day. */
export const HEAVY_CRITICALITY = new Set(["high", "critical"]);

/** A vendor with a live incident. An "ok" vendor can still list a notice (impact "none", e.g. planned maintenance). */
export const vendorHit = (v: { state: string }) => VENDOR_RANK[v.state] <= VENDOR_RANK.minor;

/** The APIs page's order: a vendor we depend heavily on whose status page shows an incident first, then the vendors
 * with the worst state, then by name. */
export function vendorOrder<T extends { name: string; state: string; incidents?: unknown[]; criticality?: string }>(
  rows: T[],
): T[] {
  const heavy = (v: T) => Number(HEAVY_CRITICALITY.has(v.criticality || "") && (v.incidents || []).length > 0);
  return [...rows].sort(
    (a, b) => heavy(b) - heavy(a) || VENDOR_RANK[a.state] - VENDOR_RANK[b.state] || a.name.localeCompare(b.name),
  );
}
