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

const AT_KEY = "collector.acks.at";
export const ACKED_SHOWN_MS = 24 * 3600_000;

function readAt(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(AT_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

let atCache = "";
let atMap: Record<string, number> = {};
const EMPTY_AT: Record<string, number> = {};
function atSnapshot(): Record<string, number> {
  const raw = typeof localStorage === "undefined" ? "{}" : localStorage.getItem(AT_KEY) || "{}";
  if (raw !== atCache) {
    atCache = raw;
    atMap = readAt();
  }
  return atMap;
}

export function useAckTimes(): Record<string, number> {
  return useSyncExternalStore(subscribe, atSnapshot, () => EMPTY_AT);
}

export function setAck(key: string, on: boolean) {
  const next = read().filter((k) => k !== key);
  if (on) next.push(key);
  const kept = next.slice(-50);
  const at = readAt();
  const times: Record<string, number> = {};
  for (const k of kept) if (at[k]) times[k] = at[k];
  if (on) times[key] = Date.now();
  localStorage.setItem(KEY, JSON.stringify(kept));
  localStorage.setItem(AT_KEY, JSON.stringify(times));
  window.dispatchEvent(new Event(EVENT));
}

export function recentlyAcked<T extends { ack?: { key: string } }>(
  rows: T[],
  at: Record<string, number>,
  now = Date.now(),
): T[] {
  return rows.filter((r) => {
    const when = r.ack ? at[r.ack.key] : undefined;
    return typeof when === "number" && now - when < ACKED_SHOWN_MS;
  });
}

export function acked(w: { ack?: { key: string } }, acks: string[]): boolean {
  return Boolean(w.ack && acks.includes(w.ack.key));
}
