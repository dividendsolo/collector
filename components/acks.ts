"use client";

import { useSyncExternalStore } from "react";

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

export function setAck(key: string, on: boolean) {
  const next = read().filter((k) => k !== key);
  if (on) next.push(key);
  localStorage.setItem(KEY, JSON.stringify(next.slice(-50)));
  window.dispatchEvent(new Event(EVENT));
}

export function acked(w: { ack?: { key: string } }, acks: string[]): boolean {
  return Boolean(w.ack && acks.includes(w.ack.key));
}
