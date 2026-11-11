import { config, type Service } from "./config";
import { fetchWithTimeout, why } from "./http";
import { once } from "./store";

export const SLOW_SECONDS = 3;

export interface Checked {
  name: string;
  url: string;
  status: "online" | "slow" | "down";
  code: number | null;
  ms: number;
  error: string | null;
  checked_at: number;
  hosting: string | null;
  /** What this one check found, before confirmDown: a first failure shows as slow, but the log keeps "down". */
  checked?: "online" | "slow" | "down";
  [key: string]: unknown;
}

/** A site shows Down only when two checks in a row fail (James, 2026-11-11: four sites behind Cloudflare failed in
 * the same second from the Mac while they were up, and ezio's proxy saw no request). The first failure shows as
 * Slow with its error; a good check starts the count over. Every failure is still logged. */
export function confirmDown(list: Checked[], prev: Checked[]): Checked[] {
  return list.map((s) => {
    const checked = s.status;
    if (checked !== "down") return { ...s, checked };
    const before = prev.find((p) => p.name === s.name && p.url === s.url);
    const failedBefore = (before?.checked ?? before?.status) === "down";
    return { ...s, checked, status: failedBefore ? "down" : "slow" };
  });
}

/** The response header each host adds to every answer. */
const HOST_HEADERS: [string, string][] = [
  ["x-vercel-id", "Vercel"],
  ["fly-request-id", "Fly.io"],
  ["x-nf-request-id", "Netlify"],
  ["x-railway-request-id", "Railway"],
  ["x-render-origin-server", "Render"],
];

export function hostFromHeaders(get: (name: string) => string | null | undefined): string | null {
  for (const [name, host] of HOST_HEADERS) if (get(name)) return host;
  return null;
}

/** One GET of the service URL: online, slow (over SLOW_SECONDS), or down (an error or a 4xx/5xx answer).
 * 10 seconds on it, and no retry at all: this call measures the service, so a second try would report a service
 * that just timed out as online, and would hide exactly the slowness the page is here to show (repo standard S2). */
export async function check(service: Service): Promise<Checked> {
  const start = Date.now();
  let code: number | null = null;
  let error: string | null = null;
  let hosting: string | null = null;
  try {
    const r = await fetchWithTimeout(
      service.url,
      { headers: { "User-Agent": "collector-health-check", ...(service.headers || {}) }, cache: "no-store" },
      10,
    );
    code = r.status;
    hosting = hostFromHeaders((n) => r.headers.get(n));
    if (r.status >= 400) error = `HTTP ${r.status}`;
    await r.body?.cancel().catch(() => {});
  } catch (e) {
    error = why(e).slice(0, 140);
  }
  const ms = Date.now() - start;
  const { headers: _h, ...rest } = service;
  return {
    ...rest,
    status: error ? "down" : ms > SLOW_SECONDS * 1000 ? "slow" : "online",
    code,
    ms,
    error,
    checked_at: Math.floor(Date.now() / 1000),
    hosting,
  };
}

/** One `[services]` log line per Slow or Down check, so collector.log keeps how many there were and when
 * (collector#94: the page only ever shows the newest check). An online check writes nothing. The url stays out:
 * a service url may carry a key in its query, and the log never holds a key. */
export function serviceLogLines(list: Checked[]): string[] {
  return list
    .filter((s) => s.status !== "online")
    .map((s) =>
      [
        "[services]",
        new Date(s.checked_at * 1000).toISOString(),
        s.name,
        s.status,
        `${s.ms} ms`,
        ...(s.error ? [s.error] : []),
      ].join(" "),
    );
}

const state = once("services", () => ({ list: [] as Checked[], busy: null as Promise<Checked[]> | null }));

/** Check every service now (the page asks once a minute). Two asks at once share one check. */
export function checkServices(): Promise<Checked[]> {
  if (!state.busy) {
    state.busy = Promise.all((config().services || []).map(check))
      .then((list) => {
        for (const line of serviceLogLines(list)) console.log(line);
        state.list = confirmDown(list, state.list);
        return state.list;
      })
      .finally(() => {
        state.busy = null;
      });
  }
  return state.busy;
}

export const lastServices = () => state.list;
