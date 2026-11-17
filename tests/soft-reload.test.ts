import { afterEach, describe, expect, it, vi } from "vitest";
import { softReload } from "@/components/data";

describe("the reload onto a new build under reduced motion", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fades the page out and back in instead of redrawing it in one frame", () => {
    vi.useFakeTimers();
    const classes = new Set<string>();
    const stored = new Map<string, string>();
    const reload = vi.fn();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(prefers-reduced-motion: reduce)" }));
    vi.stubGlobal("sessionStorage", { setItem: (k: string, v: string) => stored.set(k, v) });
    vi.stubGlobal("document", { body: { classList: { add: (c: string) => classes.add(c) } } });
    vi.stubGlobal("location", { reload });

    softReload();

    expect(reload).not.toHaveBeenCalled();
    expect(classes.has("fade-out")).toBe(true);
    expect(stored.get("collector.fade-in")).toBe("1");
    vi.advanceTimersByTime(160);
    expect(reload).toHaveBeenCalledOnce();
  });
});
