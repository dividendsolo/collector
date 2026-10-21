/** One instance per server process. Next.js may load a module more than once (one bundle per route), so every
 * cache and timer hangs off globalThis under its own key. */
export function once<T>(key: string, make: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const k = `__collector:${key}`;
  if (!(k in g)) g[k] = make();
  return g[k] as T;
}
