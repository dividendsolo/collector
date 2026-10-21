export class HttpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** One GET with a timeout in seconds. A 4xx/5xx answer throws HttpError. */
export async function getJson<T = any>(url: string, headers: Record<string, string> = {}, timeout = 10): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": "collector", ...headers },
    signal: AbortSignal.timeout(timeout * 1000),
    cache: "no-store",
  });
  if (!r.ok) throw new HttpError(r.status, `HTTP Error ${r.status}: ${r.statusText}`);
  return (await r.json()) as T;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A short reason for a failed request, like urllib's: the cause's message when there is one. */
export function why(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; name?: string; message?: string };
  if (err?.name === "TimeoutError") return "timed out";
  return String(err?.cause?.code || err?.cause?.message || err?.message || e);
}
