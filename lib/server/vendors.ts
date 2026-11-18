import fs from "node:fs";
import path from "node:path";
import { webUrl } from "../links";
import { swr } from "./cache";
import { config, type Vendor } from "./config";
import { getJson } from "./http";
import { ROOT } from "./paths";
import { check } from "./services";

export const IMPACT: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };
const DATADOG_IMPACT: Record<string, string> = {
  degraded_performance: "minor",
  partial_outage: "major",
  major_outage: "critical",
};

export const STALE_DAYS = 7;

export interface Incident {
  name: string;
  impact: string;
  url: string;
  opened?: string;
  updated?: string;
  stale?: boolean;
  where?: string[];
}

const REGION =
  /\b[a-z]{2,}(?:-[a-z0-9]+){1,2}-\d{1,2}\b|\b(?:us|europe|asia|australia|northamerica|southamerica|me|africa)-[a-z]+\d{1,2}\b/gi;

export function regionsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text || "").matchAll(REGION)) seen.add(m[0].toLowerCase());
  return [...seen];
}

function places(regions: string[], components: (string | undefined)[]): string[] | undefined {
  const named = regions.length ? regions : components.filter((c): c is string => !!c);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of named) {
    const name = String(n || "").trim();
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (!out.length) return undefined;
  return out.length > 4 ? [...out.slice(0, 4), `+${out.length - 4} more`] : out;
}

function iso(t: unknown): string | undefined {
  if (typeof t === "number") return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  const s = typeof t === "string" ? t : "";
  return Number.isNaN(Date.parse(s)) ? undefined : s;
}

const plain = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ");

export function readFeed(d: any, url: string, now = Date.now()): Incident[] | null {
  const found = readShape(d, url);
  if (found === null) return null;
  return found.map((i) => stamp(i, now)).sort((a, b) => Number(!!a.stale) - Number(!!b.stale));
}

function stamp(i: Incident, now: number): Incident {
  const t = Date.parse(i.updated || i.opened || "");
  return Number.isNaN(t) ? i : { ...i, stale: (now - t) / 86_400_000 >= STALE_DAYS };
}

function readShape(d: any, url: string): Incident[] | null {
  if (Array.isArray(d)) {
    return d
      .filter((i) => i && typeof i === "object" && "begin" in i && !i.end)
      .map((i) => {
        const where = places(
          (i.currently_affected_locations?.length
            ? i.currently_affected_locations
            : i.previously_affected_locations || []
          )
            .map((l: any) => l?.title)
            .filter(Boolean),
          (i.affected_products || []).map((p: any) => p?.title),
        );
        return {
          name: i.external_desc || "Incident",
          url: i.uri ? `${url}/${i.uri}` : url,
          impact: i.severity === "high" ? "major" : "minor",
          opened: iso(i.begin),
          updated: iso(i.modified || i.most_recent_update),
          where,
        };
      });
  }
  if (!d || typeof d !== "object") return null;
  if ("page" in d) {
    let found: Incident[] = (d.incidents || [])
      .filter((i: any) => i.status !== "resolved")
      .map((i: any) => {
        const text = [i.name, ...(i.incident_updates || []).map((u: any) => plain(u?.body))].join(" ");
        return {
          name: i.name,
          impact: i.impact || "none",
          url: webUrl(i.shortlink) || url,
          opened: iso(i.created_at),
          updated: iso(i.updated_at),
          where: places(
            regionsIn(text),
            (i.components || []).map((c: any) => c?.name),
          ),
        };
      });
    const indicator = d.status?.indicator || "none";
    if (!found.length && indicator in IMPACT && indicator !== "none")
      found = [{ name: d.status.description || "Degraded", impact: indicator, url }];
    return found;
  }
  if ("pageType" in d && "components" in d) {
    return (d.incidents || [])
      .filter((i: any) => !i.resolved)
      .map((i: any) => {
        const text = [i.title, ...(i.timeline || []).map((u: any) => plain(u?.description))].join(" ");
        return {
          name: i.title || "Incident",
          url,
          impact: (i.componentsAffected || [])
            .map((c: any) => DATADOG_IMPACT[c.status] || "minor")
            .reduce((a: string, b: string) => (IMPACT[b] > IMPACT[a] ? b : a), "minor"),
          opened: iso(i.publishedDate || i.created),
          updated: iso(i.lastModifiedAt || i.modified),
          where: places(
            regionsIn(text),
            (i.componentsAffected || []).map((c: any) => c?.name),
          ),
        };
      });
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
      where: places(regionsIn(`${r.public_name} ${r.status}`), []),
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
  criticality?: string;
}

async function vendor(v: Vendor): Promise<VendorRow> {
  const url = v.url.replace(/\/+$/, "");
  const row: VendorRow = { name: v.name, url, state: "no feed", incidents: [], criticality: v.criticality };
  if (v.probe) {
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
      const fresh = found.filter((i) => !i.stale);
      row.state = ["ok", "minor", "major", "critical"][Math.max(0, ...fresh.map((i) => IMPACT[i.impact] ?? 0))];
      break;
    }
  }
  return row;
}

const VENDORS_SEEN = () => process.env.COLLECTOR_VENDORS_SEEN || path.join(ROOT, ".vendors-seen.json");

type VendorRead = { at: number; vendors: VendorRow[] };

export function saveVendors(read: VendorRead) {
  try {
    fs.writeFileSync(VENDORS_SEEN(), `${JSON.stringify(read)}\n`);
  } catch {}
}

function savedVendors(): VendorRead | undefined {
  try {
    const read = JSON.parse(fs.readFileSync(VENDORS_SEEN(), "utf8"));
    return Array.isArray(read?.vendors) ? read : undefined;
  } catch {
    return undefined;
  }
}

const cache = swr<VendorRead>(
  "vendors",
  300_000,
  async () => {
    const read = { at: Date.now() / 1000, vendors: await Promise.all((config().vendors || []).map(vendor)) };
    saveVendors(read);
    return read;
  },
  savedVendors,
);

export const lastVendors = () => {
  vendors().catch(() => {});
  return cache.peek()?.vendors ?? [];
};

export const vendors = () =>
  cache.get({ key: (config().vendors || []).map((v) => `${v.name}:${v.criticality || ""}`).join(",") });
