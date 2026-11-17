import { type RetryOptions, withRetry } from "./retry";

export class HttpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

export class TimeoutError extends Error {
  constructor(public seconds: number) {
    super(`timed out after ${seconds} s`);
    this.name = "TimeoutError";
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, seconds = 10): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new TimeoutError(seconds);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function isRetryable(e: unknown): boolean {
  return e instanceof HttpError ? e.code >= 500 || e.code === 429 : true;
}

async function getJsonOnce<T>(url: string, headers: Record<string, string>, timeout: number): Promise<T> {
  const r = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "collector", ...headers }, cache: "no-store" },
    timeout,
  );
  if (!r.ok) throw new HttpError(r.status, `HTTP Error ${r.status}: ${r.statusText}`);
  return (await r.json()) as T;
}

export function getJson<T = any>(
  url: string,
  headers: Record<string, string> = {},
  timeout = 10,
  retry: RetryOptions = {},
): Promise<T> {
  return withRetry(() => getJsonOnce<T>(url, headers, timeout), { retryOn: isRetryable, ...retry });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function why(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; name?: string; message?: string };
  if (err?.name === "TimeoutError") return "timed out";
  return String(err?.cause?.code || err?.cause?.message || err?.message || e);
}
