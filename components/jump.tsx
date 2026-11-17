"use client";

import { useEffect } from "react";
import { jumpTargetOf, withoutJump } from "@/lib/jump";

const WAIT_MS = 8000;
const STEP_MS = 100;

function glide(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  el.classList.remove("jump-flash");
  void el.offsetWidth;
  el.classList.add("jump-flash");
  return true;
}

export function useJump() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => {
      const id = jumpTargetOf(location.hash);
      if (!id) return;
      history.replaceState(null, "", withoutJump(location.hash));
      clearTimeout(timer);
      const started = Date.now();
      const tryNow = () => {
        if (document.getElementById(id)) {
          requestAnimationFrame(() => requestAnimationFrame(() => glide(id)));
          return;
        }
        if (Date.now() - started < WAIT_MS) timer = setTimeout(tryNow, STEP_MS);
      };
      timer = setTimeout(tryNow, STEP_MS);
    };
    go();
    addEventListener("hashchange", go);
    return () => {
      removeEventListener("hashchange", go);
      clearTimeout(timer);
    };
  }, []);
}
