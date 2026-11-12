// James, 2026-11-12, on the Priority tasks row for darndest's main: "the stuck button on the row ... is still
// clickable and it shouldn't be while it's doing a loading thing." And: "I need that row to be resolved. Like,
// it's stuck right now. ... the button needs to come back and say, I don't know, something else."
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIX_STEPS, parseFixes, stepState } from "@/lib/server/debug-fix";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const dashboard = readFileSync(path.join(process.cwd(), "components", "dashboard.tsx"), "utf8");

describe("a disabled fix button is not clickable", () => {
  it("gives every disabled button the not-allowed cursor, so nothing in the row invites a second click", () => {
    const rule = css.match(/\.btn:disabled\s*\{[^}]*\}/);
    expect(rule, ".btn:disabled must exist in app/globals.css").not.toBeNull();
    expect(rule?.[0]).toMatch(/cursor:\s*not-allowed/);
  });

  it("stops the hover state on a disabled button, so it does not light up under the pointer", () => {
    // `.btn:hover` alone also paints a disabled button. The hover rule must exclude it.
    const hover = css.match(/\.btn:hover(:not\(:disabled\))?\s*\{/);
    expect(hover, ".btn:hover must exist").not.toBeNull();
    expect(hover?.[0]).toContain(":not(:disabled)");
  });

  it("disables the button while the click is in flight", () => {
    expect(dashboard).toMatch(/disabled=\{busy\}/);
  });
});

describe("a session that ends resolves the row", () => {
  it("calls a finished step done, so the row reads as finished and not as working", () => {
    expect(stepState("done: the job ran ok")).toEqual({ kind: "done", label: "Done" });
  });

  it("calls a stuck step stuck, and says it needs James", () => {
    expect(stepState("stuck")).toEqual({ kind: "stuck", label: "Stuck: needs you" });
  });

  it("calls every other step working, with the step as its own label", () => {
    for (const step of FIX_STEPS) {
      if (step === "stuck" || step.startsWith("done")) continue;
      expect(stepState(step)).toEqual({ kind: "working", label: step });
    }
    expect(stepState("working")).toEqual({ kind: "working", label: "working" });
    expect(stepState("triaging")).toEqual({ kind: "working", label: "triaging" });
  });

  it("carries the state on each open fix, so the page never has to match on the words", () => {
    expect(parseFixes("%1|main/altair/darndest|stuck\n%2|ezio/abc|fixing\n")).toEqual({
      "main/altair/darndest": { pane: "%1", step: "stuck", state: "stuck" },
      "ezio/abc": { pane: "%2", step: "fixing", state: "working" },
    });
  });

  it("shows no spinner on a done or stuck button: a spinner says work is still running", () => {
    // The page spins only while the state is working.
    expect(dashboard).toMatch(/state === "working".*spinner|spinner.*state === "working"/s);
  });

  it("lets James close a done or stuck row, so it leaves Priority tasks", () => {
    expect(dashboard).toMatch(/Close|Dismiss/);
  });
});

// The Close button's own route: it may only close a pane Collector tagged, found by its key.
describe("closing a session", () => {
  const panes = (out: string) => async (cmd: string[]) => {
    calls.push(cmd);
    return { ok: true, stdout: cmd.includes("list-panes") ? out : "", error: null };
  };
  let calls: string[][] = [];

  it("closes the pane that carries that key", async () => {
    calls = [];
    const { closeFixPane } = await import("@/lib/server/debug-fix");
    const r = await closeFixPane("main/altair/darndest", panes("%4|main/altair/darndest|stuck\n") as never);
    expect(r).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual(["tmux", "kill-pane", "-t", "%4"]);
  });

  it("refuses a key no open pane carries, so nothing of James's own is ever closed", async () => {
    calls = [];
    const { closeFixPane } = await import("@/lib/server/debug-fix");
    const r = await closeFixPane("%0", panes("%4|main/altair/darndest|stuck\n") as never);
    expect(r).toEqual({ ok: false, why: "that session is not open any more" });
    expect(calls.some((c) => c.includes("kill-pane"))).toBe(false);
  });
});
