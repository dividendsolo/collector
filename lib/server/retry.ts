/**
 * Capped exponential backoff with jitter, for the outbound calls this page can retry (repo standard S2).
 *
 * The rule the repo lives by: an outbound call has a deadline, and where another try can help it gets a few of them
 * with a growing, jittered wait between. Nothing here retries forever — `attempts` is finite and `MAX_ATTEMPTS`
 * caps it whatever a caller asks, so a service that is down can never hold a read open. The jitter matters: every
 * reader and every open page hits the same failing host, and without it they would all come back at the same moment.
 */

/** No call makes more tries than this, whatever a caller asks: the point is a bounded call, not a permanent one. */
export const MAX_ATTEMPTS = 4;

export interface RetryOptions {
  /** Total tries, the first one included. 1 means no retry at all. Default 3. */
  attempts?: number;
  /** The wait before the first retry, doubled per try. Default 250 ms. */
  baseDelayMs?: number;
  /** The ceiling on a single wait. Default 2000 ms. */
  maxDelayMs?: number;
  /** Whether this failure is worth another try. Default: any failure is. */
  retryOn?: (error: unknown) => boolean;
  /** For tests: how a wait really passes, and where its jitter comes from. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * How long to wait before try `attempt` (1-based, so this is the wait before try 2 at the earliest): exponential
 * from `baseDelayMs`, capped at `maxDelayMs`, with half jitter — somewhere in `[exp / 2, exp]` — so two callers
 * that fail together do not come back together.
 */
export function backoffDelay(attempt: number, opts: RetryOptions = {}): number {
  const base = opts.baseDelayMs ?? 250;
  const cap = opts.maxDelayMs ?? 2000;
  const random = opts.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 2));
  return Math.round(exp / 2 + random() * (exp / 2));
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A caller's `attempts`, clamped to at least 1 and at most `MAX_ATTEMPTS`. `NaN` falls back to `fallback` instead:
 * `attempt > NaN` is false forever, so trusting a raw `NaN` would turn "at most four tries" into a loop with no
 * end — the one thing this module must never do. An infinite count is simply the cap.
 */
export function attemptsFor(attempts: number | undefined, fallback: number): number {
  if (attempts === undefined || Number.isNaN(attempts)) return fallback;
  return Math.max(1, Math.min(Math.floor(attempts), MAX_ATTEMPTS));
}

/** Run `fn` until it answers or its tries run out; `fn` gets the 1-based try number. The last failure is thrown. */
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
