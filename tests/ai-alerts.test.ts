import { describe, expect, it } from "vitest";
import { warnings } from "@/lib/server/warnings";
import { aiToasts } from "@/lib/toasts";

/**
 * James, 2026-11-09: "We should just combine all these limit ones ... to one message that says that we are
 * completely out when all ... the fallbacks are drained. These individual ones don't really matter." And: Nous and
 * Claude running low show as toasts in the bottom right; the other providers do not.
 */
const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, machines: [] } as any;
const row = (provider: string, low: boolean, extra: Record<string, unknown> = {}) =>
  ({
    provider,
    profiles: 3,
    kind: "plan",
    low,
    out: low,
    left: low ? "0%" : "80%",
    link: `https://${provider}.example`,
    ...extra,
  }) as any;

describe("Needs attention for AI plans", () => {
  it("has no row for one low provider while another can still answer", () => {
    const ai = [row("anthropic", false), row("nous", true), row("kimi-coding", true), row("minimax", false)];
    expect(warnings({ ...base, ai }).filter((w) => /lanes|AI/.test(w.text))).toEqual([]);
  });

  it("has one row when every provider the lanes call is out", () => {
    const ai = [row("anthropic", true), row("nous", true), row("kimi-coding", true), row("minimax", true)];
    const out = warnings({ ...base, ai });
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("error");
    expect(out[0].text).toBe(
      "Every AI plan is out: anthropic, nous, kimi-coding, minimax. The lanes stop until one resets.",
    );
  });

  // James, 2026-11-11: the row showed while Claude still had 13% of its session and 9% of its week. Low is not out.
  it("has no row while a provider is low but not out", () => {
    const ai = [
      row("anthropic", true, { out: false, left: "13%" }),
      row("nous", true),
      row("kimi-coding", true),
      row("minimax", true),
    ];
    expect(warnings({ ...base, ai }).filter((w) => /lanes|AI/.test(w.text))).toEqual([]);
  });

  it("ignores a provider with no usage reading (Grok) when it decides everything is out", () => {
    const ai = [row("nous", true), row("minimax", true), row("xai-oauth", false, { left: undefined })];
    expect(warnings({ ...base, ai })).toHaveLength(1);
  });
});

// James, 2026-11-11, on "Every AI plan is out: anthropic, kimi-coding, minimax, nous" while Claude had 99% of its
// 5-hour session and 8% of its week: "it says it's out. All of them are out. And if you look at Anthropic, it's not".
// Low (under 10% left) is a toast; the row counts only plans whose reading says out.
describe("the every-plan-is-out row", () => {
  const plan = (provider: string, out: boolean) => ({ provider, low: true, out, left: "8%", windows: [] }) as any;
  it("does not count a plan that is only low", () => {
    const ai = [plan("anthropic", false), plan("kimi-coding", true), plan("minimax", true), plan("nous", true)];
    expect(warnings({ ...base, ai }).filter((w) => /Every AI plan/.test(w.text))).toEqual([]);
  });
  it("shows when every plan is out", () => {
    const ai = [plan("anthropic", true), plan("kimi-coding", true), plan("nous", true)];
    expect(warnings({ ...base, ai }).filter((w) => /Every AI plan/.test(w.text))).toHaveLength(1);
  });
});

describe("AI toasts", () => {
  it("shows Nous and Claude when they are low, and no other provider", () => {
    const ai = [
      row("anthropic", true, { left: "4%", detail: "of this 5-hour session" }),
      row("nous", true, { left: "$0.00" }),
      row("kimi-coding", true),
      row("minimax", true),
    ];
    const t = aiToasts(ai);
    expect(t.map((x) => x.key)).toEqual(["ai:anthropic", "ai:nous"]);
    expect(t[1]).toMatchObject({
      level: "error",
      noDot: true,
      title: "Nous credits are out",
      text: "$0.00 left",
      dismissible: true,
    });
    expect(t[0].title).toBe("Claude is nearly out");
    expect(t[1].action).toEqual({ label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" });
    expect(t[0].action).toBeUndefined();
  });

  it("shows nothing when they are fine", () => {
    expect(aiToasts([row("anthropic", false), row("nous", false)])).toEqual([]);
  });
});

describe("a domain that expires soon", () => {
  const domain = { name: "zerophase.app", registered: true, days: 26, expires: "2026-12-05", registrar: "Cloudflare" };
  it("can be acknowledged until its expiry date changes (James, 2026-11-09: 'I already renewed it')", () => {
    const [row] = warnings({ ...base, ai: [], domains: [domain] });
    expect(row.ack).toEqual({ key: "domain|zerophase.app|2026-12-05", next: null });
    const [later] = warnings({ ...base, ai: [], domains: [{ ...domain, expires: "2027-12-05", days: 20 }] });
    expect(later.ack?.key).not.toBe(row.ack?.key);
  });
});
