import { swr } from "./cache";
import { config, type Vendor } from "./config";
import { getJson } from "./http";
import { check } from "./services";

export const IMPACT: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };
const DATADOG_IMPACT: Record<string, string> = {
  degraded_performance: "minor",
  partial_outage: "major",
  major_outage: "critical",
};

export interface Incident {
  name: string;
  impact: string;
  url: string;
}

/** Open incidents from one status feed, by its shape, or null for a shape this does not know. Statuspage, Datadog
 * status pages, Better Stack, Stripe's /current, X's developer status API, Google Cloud's incidents.json. */
export function readFeed(d: any, url: string): Incident[] | null {
  if (Array.isArray(d)) {
    // Google Cloud's incidents.json: every recent incident; open ones have no end
    return d
      .filter((i) => i && typeof i === "object" && "begin" in i && !i.end)
      .map((i) => ({
        name: i.external_desc || "Incident",
        url: i.uri ? `${url}/${i.uri}` : url,
        impact: i.severity === "high" ? "major" : "minor",
      }));
  }
  if (!d || typeof d !== "object") return null;
  if ("page" in d) {
    let found: Incident[] = (d.incidents || [])
      .filter((i: any) => i.status !== "resolved")
      .map((i: any) => ({ name: i.name, impact: i.impact || "none", url: i.shortlink || url }));
    const indicator = d.status?.indicator || "none";
    if (!found.length && indicator in IMPACT && indicator !== "none")
      found = [{ name: d.status.description || "Degraded", impact: indicator, url }];
    return found;
  }
  if ("pageType" in d && "components" in d) {
    return (d.incidents || [])
      .filter((i: any) => !i.resolved)
      .map((i: any) => ({
        name: i.title || "Incident",
        url,
        impact: (i.componentsAffected || [])
          .map((c: any) => DATADOG_IMPACT[c.status] || "minor")
          .reduce((a: string, b: string) => (IMPACT[b] > IMPACT[a] ? b : a), "minor"),
      }));
  }
  if (d.data?.type === "status_page") {
    const state = d.data.attributes?.aggregate_state;
    if (state === "operational" || state === "maintenance") return [];
    const down = (d.included || [])
      .filter(
        (r: any) =>
          r.type === "status_page_resource" &&
          !["operational", "maintenance", null, undefined].includes(r.attributes?.status),
      )
      .map((r: any) => r.attributes);
    const rows = down.map((r: any) => ({
      name: `${r.public_name}: ${r.status}`,
      url,
      impact: r.status === "downtime" ? "major" : "minor",
    }));
    return rows.length ? rows : [{ name: state, url, impact: "minor" }];
  }
  if ("largestatus" in d) {
    return d.largestatus === "up"
      ? []
      : [
          {
            name: d.message || "Stripe is not fully up",
            url,
            impact: d.largestatus === "degraded" ? "minor" : "major",
          },
        ];
  }
  if ("overall" in d) {
    return d.overall === "operational"
      ? []
      : [{ name: `X API: ${d.overall}`, url, impact: d.overall === "degraded" ? "minor" : "major" }];
  }
  return null;
}

export interface VendorRow {
  name: string;
  url: string;
  state: string;
  incidents: Incident[];
}

/** One vendor's status page: "feed" when set, else the first known feed path that reads. No feed: a link only. */
async function vendor(v: Vendor): Promise<VendorRow> {
  const url = v.url.replace(/\/+$/, "");
  const row: VendorRow = { name: v.name, url, state: "no feed", incidents: [] };
  if (v.probe) {
    // no status page: one GET of an API that answers without a key
    const c = await check({ name: v.name, url: v.probe });
    row.state = c.status === "online" ? "ok" : c.status === "slow" ? "minor" : "major";
    if (c.status !== "online")
      row.incidents = [
        {
          name: `API ${c.status === "slow" ? "slow" : "not answering"}: ${c.error || `${c.ms} ms`}`,
          impact: row.state,
          url: v.probe,
        },
      ];
    return row;
  }
  const feeds = v.feed
    ? [v.feed]
    : [`${url}/api/v2/summary.json`, `${url}/config.json`, `${url}/index.json`, `${url}/current`];
  for (const feed of feeds) {
    let found: Incident[] | null;
    try {
      found = readFeed(await getJson(feed), url);
    } catch {
      continue;
    }
    if (found !== null) {
      row.incidents = found;
      row.state = ["ok", "minor", "major", "critical"][Math.max(0, ...found.map((i) => IMPACT[i.impact] ?? 0))];
      break;
    }
  }
  return row;
}

const cache = swr<{ at: number; vendors: VendorRow[] }>("vendors", 300_000, async () => ({
  at: Date.now() / 1000,
  vendors: await Promise.all((config().vendors || []).map(vendor)),
}));

/** Every vendor in config.json "vendors", checked every five minutes. */
export const lastVendors = () => cache.peek()?.vendors ?? [];

export const vendors = () => cache.get({ key: (config().vendors || []).map((v) => v.name).join(",") });
