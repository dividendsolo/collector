import type { Roast } from "../roast";
import { config, type Service } from "./config";
import { fetchWithTimeout, why } from "./http";
import { latestRoast } from "./roast";
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
  checked?: "online" | "slow" | "down";
  roast?: Roast | null;
  [key: string]: unknown;
}

export function confirmDown(list: Checked[], prev: Checked[]): Checked[] {
  return list.map((s) => {
    const checked = s.status;
    if (checked !== "down") return { ...s, checked };
    const before = prev.find((p) => p.name === s.name && p.url === s.url);
    const failedBefore = (before?.checked ?? before?.status) === "down";
    return { ...s, checked, status: failedBefore ? "down" : "slow" };
  });
}

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

const withRoasts = (list: Checked[]) => Promise.all(list.map(async (s) => ({ ...s, roast: await latestRoast(s.url) })));

const state = once("services", () => ({ list: [] as Checked[], busy: null as Promise<Checked[]> | null }));

export function checkServices(): Promise<Checked[]> {
  if (!state.busy) {
    state.busy = Promise.all((config().services || []).map(check))
      .then((list) => {
        for (const line of serviceLogLines(list)) console.log(line);
        state.list = confirmDown(list, state.list).map((s) => ({ ...s, roast: latestRoast(s.url) }));
        return state.list;
      })
      .finally(() => {
        state.busy = null;
      });
  }
  return state.busy;
}

export const lastServices = () => state.list;
