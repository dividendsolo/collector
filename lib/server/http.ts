import { type RetryOptions, withRetry } from "./retry";

export class HttpError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** A call given up on at its own deadline, named so `why()` and a log can say so plainly (repo standard S2). */
export class TimeoutError extends Error {
  constructor(public seconds: number) {
    super(`timed out after ${seconds} s`);
    this.name = "TimeoutError";
  }
}

/**
 * One fetch with a deadline of our own: a response, or a TimeoutError naming the limit. Every outbound request in
 * this repo goes through here or through the subprocess runner, so no call is ever left without a time on it.
 * We abort ourselves rather than lean on `AbortSignal.timeout`, whose rejection is named differently on each
 * runtime (Node says TimeoutError, Bun says AbortError) — one name means the error the page shows is always the same.
 */
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

/** Whether another try can help: a network error or a timeout can, a 5xx or a 429 can, any other 4xx cannot (the
 * request was understood and refused, and asking again gets the same answer). */
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

/**
 * One GET with a timeout in seconds, retried up to three tries with capped, jittered backoff. A 4xx/5xx answer
 * throws HttpError; a call that never answers throws TimeoutError. `retry` overrides the policy (a test's
 * `attempts: 1`, or a caller that wants none).
 */
export function getJson<T = any>(
  url: string,
  headers: Record<string, string> = {},
  timeout = 10,
  retry: RetryOptions = {},
): Promise<T> {
  return withRetry(() => getJsonOnce<T>(url, headers, timeout), { retryOn: isRetryable, ...retry });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A short reason for a failed request, like urllib's: the cause's message when there is one. */
export function why(e: unknown): string {
  const err = e as { cause?: { code?: string; message?: string }; name?: string; message?: string };
  if (err?.name === "TimeoutError") return "timed out";
  return String(err?.cause?.code || err?.cause?.message || err?.message || e);
}
