import { swr } from "./cache";
import { secret } from "./env";
import { bearer, getJson, HttpError, why } from "./http";
import { run } from "./run";

const API = "https://usejog.com/api";
const FREE_MINUTES = 5000;
const MAX_PAGES = 10;
const ROUTE_VERSION = "4";

export interface JogRun {
  at?: string;
  size?: string;
  seconds?: number;
  cost?: number;
}

export interface JogUsage {
  error?: string | null;
  used?: number;
  limit?: number;
  reset?: number;
  runs?: number;
  accounts?: string[];
}

const runAt = (r: JogRun) => Math.floor(Date.parse(String(r.at ?? "")) / 1000);

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

export function monthStart(at: number): number {
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

export function resetAt(at: number): number {
  const d = new Date(at * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
}

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

export function missingToken(token: string): string | null {
  return token ? null : "JOG_TOKEN is not in .env (make one at usejog.com/account/-/tokens)";
}

export function loginCandidates(override: string, logins: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of [override, ...logins]) {
    const login = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9-]+$/.test(login)) continue;
    if (!out.some((l) => l.toLowerCase() === login.toLowerCase())) out.push(login);
  }
  return out;
}

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

export function jogError(code: number): string {
  if (code === 400) return "Jog refused the read (bad_request)";
  if (code === 401) return "the Jog token ended or was revoked (make a new one at usejog.com/account/-/tokens)";
  if (code === 403) return "this Jog token cannot read advice (only the account's owners can)";
  if (code === 404) return "no Jog account with that login, or this token does not reach it";
  if (code === 409) return "Jog changed its answer since this Collector was built (a newer Collector reads it)";
  if (code === 503) return "Jog is busy (it is read again shortly)";
  return `Jog answered ${code}`;
}

async function knownLogins(): Promise<string[]> {
  const [[user], [orgs]] = await Promise.all([
    run<{ login?: string }>(["gh", "api", "user"], { timeout: 10 }),
    run<{ login?: string }[]>(["gh", "api", "user/orgs"], { timeout: 15 }),
  ]);
  return [user?.login, ...(orgs || []).map((o) => o?.login)].filter((l): l is string => Boolean(l));
}

const adviceUrl = (login: string, path: string) => `${API}/orgs/${encodeURIComponent(login)}/${path}`;

export function nextPageQuery(next: unknown): URLSearchParams {
  return new URLSearchParams({ after: typeof next === "string" ? next : JSON.stringify(next) });
}

async function runsSince(
  login: string,
  until: unknown,
  auth: Record<string, string>,
  from: number,
): Promise<JogRun[][]> {
  const pages: JogRun[][] = [];
  let q = new URLSearchParams(until ? { until: String(until) } : {});
  for (let page = 0; page < MAX_PAGES; page++) {
    const answer = await getJson<any>(`${adviceUrl(login, "advice/runs")}?${q}`, auth, 20);
    const runs: JogRun[] = answer?.runs || [];
    pages.push(runs);
    if (answer?.next == null || !runs.some((r) => runAt(r) >= from)) break;
    q = nextPageQuery(answer.next);
  }
  return pages;
}

const cache = swr<JogUsage>("jog", 5 * 60_000, async () => {
  const token = secret("JOG_TOKEN");
  const missing = missingToken(token);
  if (missing) return { error: missing };
  const now = Math.floor(Date.now() / 1000);
  const auth = { ...bearer(token), "Jog-Route-Version": ROUTE_VERSION };
  const override = secret("JOG_ACCOUNT").trim();
  const candidates = loginCandidates(override, override ? [] : await knownLogins());
  if (!candidates.length)
    return { error: "no GitHub login to ask Jog about (gh is not signed in, and JOG_ACCOUNT is not in .env)" };
  try {
    const { accounts, error } = await accountsThatAnswer(
      candidates,
      (login) => getJson(adviceUrl(login, "advice"), auth, 20),
      (e) => (e instanceof HttpError ? e.code : null),
    );
    if (!accounts.length) return { error };
    const from = monthStart(now);
    let used = 0;
    let runs = 0;
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
