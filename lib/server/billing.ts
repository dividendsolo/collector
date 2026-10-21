import { swr } from "./cache";
import { accountsOf, config } from "./config";
import { envFile, envStamp } from "./env";
import { bearer, getJson, HttpError, why } from "./http";

/** One subscription's price as a monthly amount in dollars. */
export function perMonth(cents: number, interval: string | null | undefined, count?: number | null): number {
  const months = ({ day: 12 / 365, week: 12 / 52, month: 1, year: 12 } as Record<string, number>)[interval || ""];
  return months ? cents / 100 / (months * (count || 1)) : 0;
}

export interface Revenue {
  mrr: number;
  subscribers: number;
  revenue: number;
  payments: number;
}

/** MRR from active subscriptions; revenue from every paid charge, less refunds. Clerk Billing charges plain payments
 * with no Stripe subscription behind them: a charge named "Pro (annual)" or "(monthly)" counts toward MRR until its
 * term ends. */
export function stripeRevenue(subs: any[], charges: any[], now = Date.now() / 1000): Revenue {
  let mrr = 0;
  for (const s of subs)
    for (const i of s.items.data) {
      const rec = i.price.recurring || {};
      mrr += perMonth((i.price.unit_amount || 0) * (i.quantity || 1), rec.interval, rec.interval_count);
    }
  const paid = charges.filter((c) => c.paid && c.status === "succeeded");
  const terms: [string, number][] = [
    ["annual", 365],
    ["yearly", 365],
    ["monthly", 31],
  ];
  let subscribers = subs.length;
  for (const c of paid) {
    const desc = (c.description || "").toLowerCase();
    const term = terms.find(([word]) => desc.includes(`(${word})`))?.[1];
    if (term && now - c.created < term * 86400 && !c.refunded) {
      mrr += (c.amount - (c.amount_refunded || 0)) / 100 / (term > 31 ? 12 : 1);
      subscribers++;
    }
  }
  return {
    mrr,
    subscribers,
    revenue: paid.reduce((n, c) => n + c.amount - (c.amount_refunded || 0), 0) / 100,
    payments: paid.length,
  };
}

async function stripeList(key: string, p: string) {
  const rows: any[] = [];
  let after: string | null = null;
  for (;;) {
    const url: string = `https://api.stripe.com/v1/${p}${p.includes("?") ? "&" : "?"}limit=100${after ? `&starting_after=${after}` : ""}`;
    const page: any = await getJson(url, bearer(key), 15);
    rows.push(...page.data);
    if (!page.has_more) return rows;
    after = page.data[page.data.length - 1].id;
  }
}

async function stripe(key: string) {
  return stripeRevenue(await stripeList(key, "subscriptions?status=active"), await stripeList(key, "charges"));
}

async function polarList(key: string, p: string) {
  const rows: any[] = [];
  for (let page = 1; ; page++) {
    const url = `https://api.polar.sh/v1/${p}${p.includes("?") ? "&" : "?"}limit=100&page=${page}`;
    const body = await getJson(url, { ...bearer(key), Accept: "application/json" }, 15);
    rows.push(...body.items);
    if (page >= (body.pagination?.max_page ?? 1)) return rows;
  }
}

export function polarRevenue(subs: any[], orders: any[]): Revenue {
  const paid = orders.filter((o) => o.paid);
  return {
    mrr: subs.reduce((n, s) => n + perMonth(s.amount || 0, s.recurring_interval, s.recurring_interval_count), 0),
    subscribers: subs.length,
    revenue: paid.reduce((n, o) => n + (o.total_amount || 0) - (o.refunded_amount || 0), 0) / 100,
    payments: paid.length,
  };
}

async function polar(key: string) {
  return polarRevenue(await polarList(key, "subscriptions/?active=true"), await polarList(key, "orders/"));
}

export type Billing = { error: string } | (Revenue & { providers: string[]; missing: string[]; rejected: string[] });

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** A project can bill through more than one provider; the totals add up. */
async function fetchBilling(): Promise<Record<string, Billing>> {
  const keys = envFile();
  const out: Record<string, Billing> = {};
  for (const [repo, accounts] of Object.entries(config().billing || {})) {
    const total = {
      mrr: 0,
      subscribers: 0,
      revenue: 0,
      payments: 0,
      providers: [] as string[],
      missing: [] as string[],
      rejected: [] as string[],
    };
    for (const b of accountsOf(accounts)) {
      const key = process.env[b.key] || keys[b.key];
      if (!key) {
        total.missing.push(b.key);
        continue;
      }
      try {
        const reader = ({ stripe, polar } as Record<string, (k: string) => Promise<Revenue>>)[b.provider];
        if (!reader) throw new Error(b.provider);
        const one = await reader(key);
        total.mrr += one.mrr;
        total.subscribers += one.subscribers;
        total.revenue += one.revenue;
        total.payments += one.payments;
        total.providers.push(title(b.provider));
      } catch (e) {
        const code = e instanceof HttpError ? e.code : null;
        const reason =
          code === 401
            ? "the key is wrong or deleted"
            : code === 403
              ? "the key lacks a permission"
              : String(code || why(e));
        total.rejected.push(`${title(b.provider)} refused ${b.key}: ${reason}`);
      }
    }
    if (!total.providers.length) {
      out[repo] = {
        error: [...total.rejected, ...(total.missing.length ? [`add ${total.missing.join(", ")} to .env`] : [])].join(
          "; ",
        ),
      };
    } else {
      out[repo] = { ...total, mrr: Math.round(total.mrr * 100) / 100, revenue: Math.round(total.revenue * 100) / 100 };
    }
  }
  return out;
}

const cache = swr("billing", 600_000, fetchBilling);

/** {repo: revenue or {error}}, read every ten minutes, and at once when .env changes. */
export const billing = () => cache.get({ key: String(envStamp()) });
