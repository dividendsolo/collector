import { asRoast, PAGEROAST, type Roast } from "../roast";
import { swr } from "./cache";
import { secret } from "./env";
import { getJson, HttpError } from "./http";
import { once } from "./store";

export const ROAST_TTL_MS = 86_400_000;
export const ROAST_RETRY_MS = 3_600_000;

export async function readLatest(base: string, key: string, url: string): Promise<Roast | null> {
  try {
    return asRoast(
      await getJson(`${base}/api/latest?url=${encodeURIComponent(url)}`, { "x-admin": key }, 10, { attempts: 1 }),
    );
  } catch (e) {
    if (e instanceof HttpError && e.code === 404) return null;
    throw e;
  }
}

export function latestRoast(url: string): Roast | null {
  const key = secret("PAGEROAST_ADMIN");
  if (!key) return null;
  const failed = once(`roast-failed:${url}`, () => ({ at: Number.NEGATIVE_INFINITY }));
  const cached = swr<Roast | null>(`roast:${url}`, ROAST_TTL_MS, () =>
    readLatest(PAGEROAST, key, url).catch((e) => {
      failed.at = Date.now();
      throw e;
    }),
  );
  if (Date.now() - failed.at > ROAST_RETRY_MS) cached.get().catch(() => {});
  return cached.peek() ?? null;
}
