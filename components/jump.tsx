"use client";

import { useEffect } from "react";
import { jumpTargetOf, withoutJump } from "@/lib/jump";

const WAIT_MS = 8000;
const STEP_MS = 100;

/** Glide to the element and flash it once. False while the page has not drawn it yet. */
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

/** Mounted once in the Shell: every `?to=<id>` in the address (a toast's link) opens its page, waits for the element
 * (a page may still be reading its data), then glides to it. Two frames after it appears, so the Shell's jump to the
 * top of a new page runs first and the glide starts from there. */
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
