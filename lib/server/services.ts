import { config, type Service } from "./config";
import { why } from "./http";
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
  [key: string]: unknown;
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

/** One GET of the service URL: online, slow (over SLOW_SECONDS), or down (an error or a 4xx/5xx answer). */
export async function check(service: Service): Promise<Checked> {
  const start = Date.now();
  let code: number | null = null;
  let error: string | null = null;
  let hosting: string | null = null;
  try {
    const r = await fetch(service.url, {
      headers: { "User-Agent": "collector-health-check", ...(service.headers || {}) },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
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

const state = once("services", () => ({ list: [] as Checked[], busy: null as Promise<Checked[]> | null }));

/** Check every service now (the page asks once a minute). Two asks at once share one check. */
export function checkServices(): Promise<Checked[]> {
  if (!state.busy) {
    state.busy = Promise.all((config().services || []).map(check))
      .then((list) => {
        state.list = list;
        return list;
      })
      .finally(() => {
        state.busy = null;
      });
  }
  return state.busy;
}

export const lastServices = () => state.list;
