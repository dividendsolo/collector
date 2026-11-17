export const MAX_ATTEMPTS = 4;

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export function backoffDelay(attempt: number, opts: RetryOptions = {}): number {
  const base = opts.baseDelayMs ?? 250;
  const cap = opts.maxDelayMs ?? 2000;
  const random = opts.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 2));
  return Math.round(exp / 2 + random() * (exp / 2));
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function attemptsFor(attempts: number | undefined, fallback: number): number {
  if (attempts === undefined || Number.isNaN(attempts)) return fallback;
  return Math.max(1, Math.min(Math.floor(attempts), MAX_ATTEMPTS));
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = attemptsFor(opts.attempts, 3);
  const wait = opts.sleep ?? pause;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= attempts || !(opts.retryOn ?? (() => true))(e)) throw e;
      await wait(backoffDelay(attempt + 1, opts));
    }
  }
}
