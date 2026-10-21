import { swr } from "./cache";
import { secret } from "./env";
import { bearer, getJson, why } from "./http";

export interface XUsage {
  used?: number;
  limit?: number;
  reset_day?: number;
  credits?: { total: number | null; free: number | null; prepaid: number | null; free_expires: string | null };
  error?: string;
}

/** Posts read this month against the X API project cap, and the pay-per-use credit balance, with X_BEARER_TOKEN
 * from .env. Null when no key is set. Read every five minutes. */
const cache = swr<XUsage | null>("x", 300_000, async () => {
  const key = secret("X_BEARER_TOKEN");
  if (!key) return null;
  try {
    const d = (await getJson("https://api.x.com/2/usage/tweets", bearer(key))).data || {};
    const out: XUsage = {
      used: Number(d.project_usage || 0),
      limit: Number(d.project_cap || 0),
      reset_day: d.cap_reset_day,
    };
    const c = (await getJson("https://api.x.com/2/usage/credits", bearer(key))).data || {};
    const grants = (c.free_grants || [])
      .map((g: any) => g.expires_at)
      .filter(Boolean)
      .sort();
    out.credits = {
      total: c.total_balance ?? null,
      free: c.free_balance ?? null,
      prepaid: c.prepaid_balance ?? null,
      free_expires: grants[0] ?? null,
    };
    return out;
  } catch (e) {
    return { error: `Could not read X API usage: ${why(e).slice(0, 80)}` };
  }
});

export const xUsage = () => (secret("X_BEARER_TOKEN") ? cache.get() : Promise.resolve(null));
export const lastX = () => cache.peek() ?? null;
