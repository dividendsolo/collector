import { asRoast, PAGEROAST, type Roast } from "../roast";
import { swr } from "./cache";
import { secret } from "./env";
import { getJson, HttpError } from "./http";

export const ROAST_TTL_MS = 86_400_000;

export async function readLatest(base: string, key: string, url: string): Promise<Roast | null> {
  try {
    return asRoast(await getJson(`${base}/api/latest?url=${encodeURIComponent(url)}`, { "x-admin": key }, 10));
  } catch (e) {
    if (e instanceof HttpError && e.code === 404) return null;
    throw e;
  }
}

export function latestRoast(url: string): Roast | null {
  const key = secret("PAGEROAST_ADMIN");
  if (!key) return null;
  const cached = swr<Roast | null>(`roast:${url}`, ROAST_TTL_MS, () => readLatest(PAGEROAST, key, url));
  cached.get().catch(() => {});
  return cached.peek() ?? null;
}
