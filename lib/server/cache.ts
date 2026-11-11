import { once } from "./store";

interface Entry<T> {
  at: number;
  key: string;
  value: T | undefined;
  busy: Promise<T> | null;
}

/** Stale-while-revalidate: a stale value is served at once while one refresh runs in the background. Only the very
 * first read (or a read for a new key, such as an edited list in config.json) waits. Two reads share one refresh. */
export function swr<T>(
  name: string,
  ttl: number | ((value: T) => number),
  fn: () => Promise<T>,
  /** A value to serve before the first read lands (a read saved on disk), stale at once so a read starts. */
  seed?: () => T | undefined,
) {
  const e = once<Entry<T>>(`swr:${name}`, () => ({ at: 0, key: "", value: seed?.(), busy: null }));
  const life = (v: T) => (typeof ttl === "function" ? ttl(v) : ttl);
  const refresh = (key: string) => {
    if (!e.busy) {
      e.busy = fn()
        .then((v) => {
          e.value = v;
          e.at = Date.now();
          e.key = key;
          return v;
        })
        .finally(() => {
          e.busy = null;
        });
      e.busy.catch(() => {});
    }
    return e.busy;
  };
  return {
    /** The value; waits only when there is none yet for this key, or with `wait`. */
    async get(opts: { key?: string; force?: boolean; wait?: boolean } = {}): Promise<T> {
      const key = opts.key ?? "";
      // A seeded value (at 0) has no key yet: it is served while its first read runs, not waited past.
      if (e.value === undefined || (e.key !== key && e.at > 0) || (opts.force && opts.wait)) return refresh(key);
      if (opts.force || Date.now() - e.at > life(e.value)) refresh(key);
      return e.value;
    },
    peek: () => e.value,
    at: () => e.at,
  };
}
