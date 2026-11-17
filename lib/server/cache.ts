import { once } from "./store";

interface Entry<T> {
  at: number;
  key: string;
  value: T | undefined;
  busy: Promise<T> | null;
}

export function swr<T>(
  name: string,
  ttl: number | ((value: T) => number),
  fn: () => Promise<T>,
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
    async get(opts: { key?: string; force?: boolean; wait?: boolean } = {}): Promise<T> {
      const key = opts.key ?? "";
      if (e.value === undefined || (e.key !== key && e.at > 0) || (opts.force && opts.wait)) return refresh(key);
      if (opts.force || Date.now() - e.at > life(e.value)) refresh(key);
      return e.value;
    },
    peek: () => e.value,
    at: () => e.at,
  };
}
