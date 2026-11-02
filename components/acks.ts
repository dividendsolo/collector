"use client";

import { useSyncExternalStore } from "react";

/** Acknowledged Needs attention rows (James, 2026-11-02: "I've acknowledged it and I've handled it and we just have
 * to wait for the next run"). A failed job's warning carries `ack.key` = machine, job and that run's time, so an
 * acknowledgement covers one run only: the next run either clears the row or brings a new failure back as unread.
 * Kept in this browser's localStorage, like the money blur; Collector has no database. */
const KEY = "collector.acks";
const EVENT = "collector-acks";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let cache = "";
let list: string[] = [];
function snapshot(): string[] {
  const raw = typeof localStorage === "undefined" ? "[]" : localStorage.getItem(KEY) || "[]";
  if (raw !== cache) {
    cache = raw;
    list = read();
  }
  return list;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const EMPTY: string[] = [];

export function useAcks(): string[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** Acknowledge (on) or take back (off) one row. Keeps the newest 50 so the list cannot grow without end. */
export function setAck(key: string, on: boolean) {
  const next = read().filter((k) => k !== key);
  if (on) next.push(key);
  localStorage.setItem(KEY, JSON.stringify(next.slice(-50)));
  window.dispatchEvent(new Event(EVENT));
}

/** True when this warning's current run was acknowledged. */
export function acked(w: { ack?: { key: string } }, acks: string[]): boolean {
  return Boolean(w.ack && acks.includes(w.ack.key));
}
