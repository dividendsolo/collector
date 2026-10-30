import { swr } from "./cache";
import { secret } from "./env";
import { bearer, getJson, HttpError, why } from "./http";
import { run } from "./run";

/** Jog's API (usejog.com/docs/api.md). A Jog personal access token reads advice and runs, and nothing else: the
 * dashboard's own free-minutes and credit figures sit behind its signed-in pages, which answer a token with
 * `403 key_not_allowed` (checked 2026-10-29). */
const API = "https://usejog.com/api";
/** The free minutes a month one Jog account includes: 5,000 at 2 vCPU, used before its credits
 * (usejog.com/pricing.md). */
const FREE_MINUTES = 5000;
/** Runs come 1,000 a page; a month that needs more than this many is read as far as it gets. */
const MAX_PAGES = 10;
/** The advice route is at version 2; a call that names no version gets `409 updated`. The runs route is still
 * version 1 and takes no version header — sending one answers `409 updated` there too. */
const ADVICE_VERSION = "2";

/** One run from /advice/runs: when it was charged, the size it ran on, how long it took, and the micro-dollars Jog
 * prices it at. `cost` is that list value, not money taken: the free minutes cover it. */
export interface JogRun {
  at?: string;
  size?: string;
  seconds?: number;
  cost?: number;
}

/** Jog this month: the free minutes used (each run's seconds at its size's weight), the minutes a month the
 * accounts include, when they reset, and the accounts the token answered for. `error` is the reason a read failed,
 * for the page's "Could not read" line. */
export interface JogUsage {
  error?: string | null;
  used?: number;
  limit?: number;
  reset?: number;
  runs?: number;
  accounts?: string[];
}

/** When Jog charged a run, in epoch seconds; NaN for a run with no time Jog can read. */
const runAt = (r: JogRun) => Math.floor(Date.parse(String(r.at ?? "")) / 1000);

/** The free minutes one machine minute uses. Jog's smallest size is 2 vCPU and burns one free minute, every size
 * above it burns one per 2 vCPU (2x, 4x, 8x, 16x), and a Jog Max minute uses twice its size's free minutes
 * (usejog.com/pricing.md). A label it does not know counts as the smallest, never as nothing. */
export function sizeWeight(size?: string): number {
  const match = /^jog(-max)?(?:-(\d+)vcpu)?$/.exec(
    String(size ?? "")
      .trim()
      .toLowerCase(),
  );
  if (!match) return 1;
  const vcpus = Number(match[2] ?? 2);
  const weight = Number.isFinite(vcpus) && vcpus >= 2 ? vcpus / 2 : 1;
  return match[1] ? weight * 2 : weight;
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
 * seconds at its size's weight. A run older than the month's first, or with no time Jog can read, is left out; the
 * reader stops paging when a page reaches back past the month's first. */
export function monthUsage(pages: JogRun[][], at: number): { used: number; runs: number } {
  const from = monthStart(at);
  let minutes = 0;
  let runs = 0;
  for (const page of pages)
    for (const r of page) {
      if (!(runAt(r) >= from)) continue;
      minutes += ((Number(r.seconds) || 0) / 60) * sizeWeight(r.size);
      runs++;
    }
  return { used: minutes, runs };
}

/** What the read needs in .env and what is missing from it, or null when the token is there. Only the token: James
 * made one for all his accounts (2026-10-29), so no account is named in .env and the account is found through the
 * API. */
export function missingToken(token: string): string | null {
  return token ? null : "JOG_TOKEN is not in .env (make one at usejog.com/account/-/tokens)";
}

/** The logins to ask Jog about, in order: `JOG_ACCOUNT` from .env when it is set (one account, and no asking), then
 * every GitHub login Collector can name. Jog's account for a repository is its GitHub owner's login, and a token
 * made for all of a person's accounts reads each of them. Junk and repeats are dropped, since Jog's account names
 * are letters, digits and hyphens. */
export function loginCandidates(override: string, logins: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of [override, ...logins]) {
    const login = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9-]+$/.test(login)) continue;
    if (!out.some((l) => l.toLowerCase() === login.toLowerCase())) out.push(login);
  }
  return out;
}

/** The accounts a token reads. Jog answers the advice route only for an account the token reaches and whose owner
 * it acts for, so the reader asks every login it knows and keeps the ones that answer. A 401 ends the read: a token
 * that has ended reads no account at all. A 404 is that login not being one of the person's Jog accounts, which is
 * ordinary; any other refusal is the read's own reason, kept for the page when none of the logins answers. */
export async function accountsThatAnswer<T>(
  candidates: string[],
  ask: (login: string) => Promise<T>,
  status: (e: unknown) => number | null,
): Promise<{ accounts: { login: string; advice: T }[]; error: string | null }> {
  const accounts: { login: string; advice: T }[] = [];
  let other: string | null = null;
  for (const login of candidates) {
    try {
      accounts.push({ login, advice: await ask(login) });
    } catch (e) {
      const code = status(e);
      if (code === 401) return { accounts: [], error: jogError(401) };
      if (code !== 404) other = code === null ? why(e).slice(0, 80) : jogError(code);
    }
  }
  return {
    accounts,
    error: accounts.length
      ? null
      : (other ??
        `no Jog account among ${candidates.join(", ")} (a token reads the accounts of the person who made it)`),
  };
}

/** Jog's own reason for a read that failed, by the status it answered (usejog.com/docs/api.md). */
export function jogError(code: number): string {
  if (code === 400) return "Jog refused the read (bad_request)";
  if (code === 401) return "the Jog token ended or was revoked (make a new one at usejog.com/account/-/tokens)";
  if (code === 403) return "this Jog token cannot read advice (only the account's owners can)";
  if (code === 404) return "no Jog account with that login, or this token does not reach it";
  if (code === 409) return "Jog changed its answer since this Collector was built (a newer Collector reads it)";
  if (code === 503) return "Jog is busy (it is read again shortly)";
  return `Jog answered ${code}`;
}

/** Every GitHub login Collector can name: the gh login and the orgs it is in. Jog's account for a repository is its
 * owner's login, so these are the logins a Jog account of James's can be under. */
async function knownLogins(): Promise<string[]> {
  const [[user], [orgs]] = await Promise.all([
    run<{ login?: string }>(["gh", "api", "user"], { timeout: 10 }),
    run<{ login?: string }[]>(["gh", "api", "user/orgs"], { timeout: 15 }),
  ]);
  return [user?.login, ...(orgs || []).map((o) => o?.login)].filter((l): l is string => Boolean(l));
}

const adviceUrl = (login: string, path: string) => `${API}/orgs/${encodeURIComponent(login)}/${path}`;

/** One account's runs in the advice window, newest first, read back as far as the month's first: page after page
 * until a page reaches past it, or Jog has none left. The runs route is version 1, so it takes the token alone. */
async function runsSince(
  login: string,
  until: unknown,
  auth: Record<string, string>,
  from: number,
): Promise<JogRun[][]> {
  const pages: JogRun[][] = [];
  let before: { at?: string; jobId?: number } | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams(until ? { until: String(until) } : {});
    if (before?.at && before.jobId != null) {
      q.set("beforeAt", before.at);
      q.set("beforeJobId", String(before.jobId));
    }
    const answer = await getJson<any>(`${adviceUrl(login, "advice/runs")}?${q}`, auth, 20);
    const runs: JogRun[] = answer?.runs || [];
    pages.push(runs);
    // Newest first: a page that reaches back past the month's first ends the read.
    if (!answer?.next?.at || !runs.some((r) => runAt(r) >= from)) break;
    before = answer.next;
  }
  return pages;
}

/** The Jog accounts' runner minutes this month, read through Jog's advice routes with JOG_TOKEN from .env, and the
 * accounts the token answers for found through the API. Every five minutes, like the other outside reads. */
const cache = swr<JogUsage>("jog", 5 * 60_000, async () => {
  const token = secret("JOG_TOKEN");
  const missing = missingToken(token);
  if (missing) return { error: missing };
  const now = Math.floor(Date.now() / 1000);
  const auth = bearer(token);
  const override = secret("JOG_ACCOUNT").trim();
  const candidates = loginCandidates(override, override ? [] : await knownLogins());
  if (!candidates.length)
    return { error: "no GitHub login to ask Jog about (gh is not signed in, and JOG_ACCOUNT is not in .env)" };
  try {
    const { accounts, error } = await accountsThatAnswer(
      candidates,
      (login) => getJson(adviceUrl(login, "advice"), { ...auth, "Jog-Route-Version": ADVICE_VERSION }, 20),
      (e) => (e instanceof HttpError ? e.code : null),
    );
    if (!accounts.length) return { error };
    const from = monthStart(now);
    let used = 0;
    let runs = 0;
    // One window across the accounts: the first advice answer's window.end is every later read's `until`.
    const until = accounts[0]?.advice?.window?.end;
    for (const account of accounts) {
      const sum = monthUsage(await runsSince(account.login, until, auth, from), now);
      used += sum.used;
      runs += sum.runs;
    }
    return {
      used: Math.round(used),
      limit: FREE_MINUTES * accounts.length,
      reset: resetAt(now),
      runs,
      accounts: accounts.map((a) => a.login),
    };
  } catch (e) {
    return { error: e instanceof HttpError ? jogError(e.code) : why(e).slice(0, 80) };
  }
});

export const jogUsage = () => cache.get();
