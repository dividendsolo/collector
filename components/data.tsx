"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** One reader's answer, asked again once a minute (each reader has its own refresh rate on the server). */
export function useApi<T = any>(url: string, every = 60_000) {
  return useSWR<T>(url, fetcher, { refreshInterval: every, revalidateOnFocus: false, dedupingInterval: 2_000 });
}

export interface Live {
  state: any | null;
  updated: string;
  liveClass: string;
  next: number;
  tick: () => void;
  board: { tickets: any; work: any } | null;
}

const LiveContext = createContext<Live | null>(null);
export const useLive = () => useContext(LiveContext) as Live;

/** The main read every 15 seconds with a visible countdown, the board pushed over server-sent events, and a reload
 * when the server runs a new build. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<any | null>(null);
  const [updated, setUpdated] = useState("Loading…");
  const [liveClass, setLiveClass] = useState("live");
  const [next, setNext] = useState(0);
  const [board, setBoard] = useState<Live["board"]>(null);
  const nextRef = useRef(0);

  const tick = useCallback(async () => {
    nextRef.current = 0;
    setNext(0);
    setLiveClass("live busy");
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      const d = await r.json();
      setState(d);
      setUpdated(`Updated ${new Date(d.at * 1000).toLocaleTimeString()}`);
      setLiveClass("live");
    } catch (e) {
      setUpdated(`Could not reach the Collector server: ${(e as Error).message}`);
      setLiveClass("live down");
    }
    nextRef.current = 15;
    setNext(15);
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(() => {
      if (!nextRef.current) return;
      nextRef.current -= 1;
      setNext(nextRef.current);
      if (nextRef.current === 0) tick();
    }, 1000);
    return () => clearInterval(t);
  }, [tick]);

  // The board: pushed by the server within a second of each read that sees a change.
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("board", (e) => {
      const v = JSON.parse((e as MessageEvent).data);
      setBoard({ tickets: v.tickets, work: v.work });
      mutate("/api/work-stats", (s: any) => (s ? { ...s, open: v.work.cards.length } : s), { revalidate: false });
    });
    return () => es.close();
  }, []);

  // Hot reload: a new build on the server reloads the page.
  useEffect(() => {
    let seen: string | null = null;
    const t = setInterval(async () => {
      try {
        const v = await (await fetch("/api/version", { cache: "no-store" })).text();
        if (seen && v !== seen) location.reload();
        seen = v;
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <LiveContext.Provider value={{ state, updated, liveClass, next, tick, board }}>{children}</LiveContext.Provider>
  );
}
