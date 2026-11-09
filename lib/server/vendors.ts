import { webUrl } from "../links";
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

/** An incident the vendor has not updated in this many days is stale: still open, but no longer news. MongoDB
 * Atlas left a me-central-1 notice open from 2026-09-03 and never touched it again, and the row read "major" for
 * a week on an incident in regions we do not use (card #46). */
export const STALE_DAYS = 7;

export interface Incident {
  name: string;
  impact: string;
  url: string;
  /** The day the vendor opened it and the day it last said anything about it, when its feed says. */
  opened?: string;
  updated?: string;
  /** No update in STALE_DAYS days. A stale incident is named in the row but never sets the vendor's state. */
  stale?: boolean;
  /** The regions the incident names (`us-east-1`), else the components it names ("Issues"). */
  where?: string[];
}

/** Cloud regions named in a status page's own text: AWS/Azure style (`us-east-1`, `me-central-1`, `us-gov-west-1`)
 * and Google style (`europe-west1`, `us-central1`). A status page writes a few of these; prose that only looks
 * like one is rare. */
const REGION =
  /\b[a-z]{2,}(?:-[a-z0-9]+){1,2}-\d{1,2}\b|\b(?:us|europe|asia|australia|northamerica|southamerica|me|africa)-[a-z]+\d{1,2}\b/gi;

/** The cloud regions a status page names in free text, lowercased and deduped. */
export function regionsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text || "").matchAll(REGION)) seen.add(m[0].toLowerCase());
  return [...seen];
}

/** What an incident names: the regions in its own text when it names any, else its components. Four at most, so a
 * vendor row stays readable; the rest are counted. */
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

/** A time the feed gave, or undefined: a date the feed wrote badly never becomes the row's date. */
function iso(t: unknown): string | undefined {
  if (typeof t === "number") return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  const s = typeof t === "string" ? t : "";
  return Number.isNaN(Date.parse(s)) ? undefined : s;
}

/** An update's text without the HTML a status page writes in it. */
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ");

/** Open incidents from one status feed, by its shape, or null for a shape this does not know. Statuspage, Datadog
 * status pages, Better Stack, Stripe's /current, X's developer status API, Google Cloud's incidents.json.
 * `now` is the moment the age is measured from, so a test can pin it. */
export function readFeed(d: any, url: string, now = Date.now()): Incident[] | null {
  const found = readShape(d, url);
  if (found === null) return null;
  // Fresh first: a stale incident sits below the live ones, never above them (card #46).
  return found.map((i) => stamp(i, now)).sort((a, b) => Number(!!a.stale) - Number(!!b.stale));
}

/** Ages one incident from the vendor's own dates. A feed that gives no date leaves it unstamped, not guessed. */
function stamp(i: Incident, now: number): Incident {
  const t = Date.parse(i.updated || i.opened || "");
  return Number.isNaN(t) ? i : { ...i, stale: (now - t) / 86_400_000 >= STALE_DAYS };
}

function readShape(d: any, url: string): Incident[] | null {
  if (Array.isArray(d)) {
    // Google Cloud's incidents.json: every recent incident; open ones have no end
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
          // A feed's own `shortlink` is outside data and lands in an `<a href>`: only a web address is a link, else the
          // vendor's own status page (collector#84).
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
  /** How much we depend on it, from config.json's `vendors[].criticality` (collector#78). */
  criticality?: string;
}

/** One vendor's status page: "feed" when set, else the first known feed path that reads. No feed: a link only. */
async function vendor(v: Vendor): Promise<VendorRow> {
  const url = v.url.replace(/\/+$/, "");
  const row: VendorRow = { name: v.name, url, state: "no feed", incidents: [], criticality: v.criticality };
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
      // The headline state is the worst incident of the week. A stale one is still listed, with its age, but it is
      // not what a vendor is doing today — and a vendor whose only open incident is stale is not "major" (card #46).
      const fresh = found.filter((i) => !i.stale);
      row.state = ["ok", "minor", "major", "critical"][Math.max(0, ...fresh.map((i) => IMPACT[i.impact] ?? 0))];
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

export const vendors = () =>
  cache.get({ key: (config().vendors || []).map((v) => `${v.name}:${v.criticality || ""}`).join(",") });
