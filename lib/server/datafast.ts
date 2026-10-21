import fs from "node:fs";
import path from "node:path";
import { swr } from "./cache";
import { bearer, getJson, HttpError, why } from "./http";
import { HOME } from "./paths";

export interface Traffic {
  visitors?: number;
  revenue?: number;
  payments?: number;
  revenue_total?: number;
  payments_total?: number;
  since?: string;
  error?: string;
}

/** The DataFast CLI's token (`datafast login` writes it), or DATAFAST_TOKEN. */
function token(): string | null {
  if (process.env.DATAFAST_TOKEN) return process.env.DATAFAST_TOKEN;
  try {
    return JSON.parse(fs.readFileSync(path.join(HOME, ".config/datafast/config.json"), "utf8")).token || null;
  } catch {
    return null;
  }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** {hostname: {visitors, revenue, payments}} for every DataFast website over 30 days, read every ten minutes. */
export const datafast = swr<{ sites: Record<string, Traffic>; error: string | null }>("datafast", 600_000, async () => {
  const t = token();
  if (!t) return { sites: {}, error: "no token" };
  const get = async (p: string) => (await getJson(`https://datafa.st/api/v1/${p}`, bearer(t), 15)).data;
  const end = ymd(new Date());
  const start = ymd(new Date(Date.now() - 29 * 86_400_000));
  try {
    const sites: any[] = (await get("admin/websites")) || [];
    const rows = await Promise.all(
      sites.map(async (site) => {
        const row =
          ((await get(
            `analytics/overview?websiteId=${site._id}&startAt=${start}&endAt=${end}&fields=visitors,revenue,payments`,
          )) || [{}])[0] || {};
        const total =
          ((await get(
            `analytics/overview?websiteId=${site._id}&startAt=${site.createdAt.slice(0, 10)}&endAt=${end}&fields=revenue,payments`,
          )) || [{}])[0] || {};
        return [
          site.domain,
          {
            visitors: row.visitors,
            revenue: row.revenue,
            payments: row.payments,
            revenue_total: total.revenue,
            payments_total: total.payments,
            since: site.createdAt.slice(0, 10),
          },
        ] as const;
      }),
    );
    return { sites: Object.fromEntries(rows), error: null };
  } catch (e) {
    return { sites: {}, error: e instanceof HttpError ? String(e.code) : why(e) };
  }
});
