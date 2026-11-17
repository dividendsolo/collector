"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import useSWR from "swr";
import { downText, markUpdating, updating } from "@/lib/updating";

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export function useApi<T = any>(url: string, every = 60_000) {
  return useSWR<T>(url, fetcher, { refreshInterval: every, revalidateOnFocus: false, dedupingInterval: 2_000 });
}

export interface Live {
  state: any | null;
  updated: string;
  liveClass: string;
  tick: () => void;
  board: { tickets: any; work: any } | null;
}

const LiveContext = createContext<Live | null>(null);
export const useLive = () => useContext(LiveContext) as Live;

export function softReload() {
  sessionStorage.setItem("collector.fade-in", "1");
  document.body.classList.add("fade-out");
  setTimeout(() => location.reload(), 160);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<any | null>(null);
  const [updated, setUpdated] = useState("Loading…");
  const [liveClass, setLiveClass] = useState("live");
  const [board, setBoard] = useState<Live["board"]>(null);

  const tick = useCallback(async () => {
    setLiveClass("live busy");
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      const d = await r.json();
      setState(d);
      setUpdated(`Updated ${new Date(d.at * 1000).toLocaleTimeString()}`);
      setLiveClass("live");
    } catch (e) {
      setUpdated(downText(e));
      setLiveClass(updating() ? "live busy" : "live down");
    }
  }, []);

  useEffect(() => {
    tick();
    const t = setInterval(tick, 15_000);
    return () => clearInterval(t);
  }, [tick]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.addEventListener("board", (e) => {
      const v = JSON.parse((e as MessageEvent).data);
      setBoard({ tickets: v.tickets, work: v.work });
    });
    es.addEventListener("restarting", () => markUpdating());
    return () => es.close();
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("collector.fade-in") !== "1") return;
    sessionStorage.removeItem("collector.fade-in");
    document.documentElement.classList.remove("fading-in");
    document.body.classList.add("fade-in");
    const t = setTimeout(() => document.body.classList.remove("fade-in"), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let seen: string | null = null;
    const t = setInterval(async () => {
      try {
        const v = await (await fetch("/api/version", { cache: "no-store" })).text();
        if (seen && v !== seen) softReload();
        seen = v;
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return <LiveContext.Provider value={{ state, updated, liveClass, tick, board }}>{children}</LiveContext.Provider>;
}
