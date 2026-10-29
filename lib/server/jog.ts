import { swr } from "./cache";
import { secret } from "./env";
import { bearer, getJson, HttpError, why } from "./http";

/** Jog's API (usejog.com/docs/api.md). A Jog personal access token reads these two routes and nothing else: the
 * dashboard's own free-minutes and credit figures live behind its signed-in account pages, which a token cannot
 * call. */
const API = "https://usejog.com/api";
/** The free minutes a month a Jog account includes: 5,000 at 2 vCPU, used before its credits. Jog has one
 * allowance, not a set of plans, so there is nothing to configure (usejog.com/pricing.md). */
const FREE_MINUTES = 5000;
/** Runs come 1,000 a page; a month that needs more than this many is read as far as it gets. */
const MAX_PAGES = 10;

/** One run from /advice/runs: when it was charged, the size it ran on, how long it took, and the micro-dollars Jog
 * charged for it. */
export interface JogRun {
  at?: string;
  size?: string;
  seconds?: number;
  cost?: number;
}

/** Jog this month: the free minutes used (each run's seconds at its size's weight), the dollars charged for them,
 * the minutes a month the account includes, and when they reset. `error` is the reason a read failed, for the page's
 * "Could not read" line. */
export interface JogUsage {
  error?: string | null;
  used?: number;
  spent?: number;
  limit?: number;
  reset?: number;
  runs?: number;
}

/** When Jog charged a run, in epoch seconds; NaN for a run with no time Jog can read. */
const runAt = (r: JogRun) => Math.floor(Date.parse(String(r.at ?? "")) / 1000);

/** The free minutes one machine minute uses: Jog's smallest size is 2 vCPU and burns one free minute, and every size
 * above it burns one per 2 vCPU (2x, 4x, 8x, 16x). A label it does not know counts as the smallest, never as
 * nothing. */
export function sizeWeight(size?: string): number {
  const vcpus = Number(/^jog(?:-(\d+)vcpu)?$/.exec(String(size ?? "").trim())?.[1] ?? 2);
  return Number.isFinite(vcpus) && vcpus >= 2 ? vcpus / 2 : 1;
}

/** The epoch seconds of the first of the month `at` falls in, UTC: the day Jog's free minutes reset on. */
export function monthStart(at: number): number {
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The epoch seconds of the first of the month after `at`, UTC. */
export function resetAt(at: number): number {
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

/** This month's runs, summed from the pages Jog answered (newest first): the free minutes they used, each run's
 * seconds at its size's weight, and the dollars Jog charged for them. A run older than the month's first, or with no
 * time Jog can read, is left out; the reader stops paging when a page reaches back past the month's first. */
export function monthUsage(pages: JogRun[][], at: number): { used: number; spent: number; runs: number } {
  const from = monthStart(at);
  let minutes = 0;
  let micros = 0;
  let runs = 0;
  for (const page of pages)
    for (const r of page) {
      const t = runAt(r);
      if (!(t >= from)) continue;
      minutes += ((Number(r.seconds) || 0) / 60) * sizeWeight(r.size);
      micros += Number(r.cost) || 0;
      runs++;
    }
  return { used: Math.round(minutes), spent: Math.round(micros / 1e4) / 100, runs };
}

/** What the read needs in .env and what is missing from it, or null when both lines are there: JOG_TOKEN is a Jog
 * personal access token (access "advice") and JOG_ACCOUNT is the login Jog runs the account's jobs for. */
export function missingEnv(token: string, account: string): string | null {
  if (!token && !account)
    return "JOG_TOKEN and JOG_ACCOUNT are not in .env (a Jog token from usejog.com/account/-/tokens, and the account's login)";
  if (!token) return "JOG_TOKEN is not in .env (make one at usejog.com/account/-/tokens)";
  if (!account)
    return "JOG_ACCOUNT is not in .env (the login Jog runs the account's jobs for, usually your GitHub account)";
  return null;
}

/** Jog's own reason for a read that failed, by the status it answered (usejog.com/docs/api.md). */
export function jogError(code: number): string {
  if (code === 400) return "Jog refused the read (bad_request)";
  if (code === 401) return "the Jog token ended or was revoked (make a new one at usejog.com/account/-/tokens)";
  if (code === 403) return "this Jog token cannot read advice (only the account's owners can)";
  if (code === 404) return "no Jog account with that JOG_ACCOUNT, or this token does not reach it";
  if (code === 409) return "Jog changed its answer since this Collector was built (a newer Collector reads it)";
  if (code === 503) return "Jog is busy (it is read again shortly)";
  return `Jog answered ${code}`;
}

/** The account's Jog minutes this month, read through Jog's advice routes with JOG_TOKEN and JOG_ACCOUNT from .env.
 * Every five minutes, like the other outside reads. */
const cache = swr<JogUsage>("jog", 5 * 60_000, async () => {
  const token = secret("JOG_TOKEN");
  const account = secret("JOG_ACCOUNT");
  const missing = missingEnv(token, account);
  if (missing) return { error: missing };
  const now = Math.floor(Date.now() / 1000);
  const headers = { ...bearer(token), "Jog-Route-Version": "2" };
  const route = (path: string) => `${API}/orgs/${encodeURIComponent(account)}/${path}`;
  try {
    // The advice read gives the window every later read is taken from; the runs in it carry the figures.
    const advice = await getJson(route("advice"), headers, 20);
    const until = String(advice?.window?.end ?? "");
    const from = monthStart(now);
    const pages: JogRun[][] = [];
    let before: { at?: string; jobId?: number } | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams(until ? { until } : {});
      if (before?.at && before?.jobId != null) {
        q.set("beforeAt", before.at);
        q.set("beforeJobId", String(before.jobId));
      }
      const answer = await getJson(`${route("advice/runs")}?${q}`, headers, 20);
      const runs: JogRun[] = answer?.runs || [];
      pages.push(runs);
      // Newest first: a page that reaches back past the month's first ends the read.
      if (!answer?.next?.at || !runs.some((r) => runAt(r) >= from)) break;
      before = answer.next;
    }
    return { ...monthUsage(pages, now), limit: FREE_MINUTES, reset: resetAt(now) };
  } catch (e) {
    return { error: e instanceof HttpError ? jogError(e.code) : why(e).slice(0, 80) };
  }
});

export const jogUsage = () => cache.get();
