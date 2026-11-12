import { describe, expect, it } from "vitest";
import { resetText } from "@/lib/format";
import { nousReading } from "@/lib/server/ai";
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
      row("anthropic", true, { left: "4%", out: false, detail: "of this 5-hour session" }),
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
      text: "",
      dismissible: true,
    });
    expect(t[0].title).toBe("Claude is nearly out");
    expect(t[1].action).toEqual({ label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" });
    expect(t[0].action).toBeUndefined();
  });

  // James, 2026-11-11: "If the credits are out, then it just says out ... we don't need to say only 0%."
  it("says nothing under the title when a plan is out", () => {
    const nous = row("nous", true, {
      left: "$0.00",
      out: true,
      windows: [
        { label: "Plan credits", used: 100, resets: "2026-11-20T14:07:02.000Z" },
        { label: "Top-up ($25)", used: 100, resets: null },
      ],
    });
    const [t] = aiToasts([nous]);
    expect(t.title).toBe("Nous credits are out");
    expect(t.text).toBe("");
  });

  // James, 2026-11-11: "when it's completely out, we need to put that button up there, not when there's 7% left".
  it("gives Claude's toast Check for reset only when a limit is used up", () => {
    const out = aiToasts([row("anthropic", true, { left: "40%", out: true })])[0];
    expect(out.title).toBe("Claude is out");
    expect(out.action).toEqual({ label: "Check for reset", url: "https://claude.ai/settings/usage" });
    const low = aiToasts([row("anthropic", true, { left: "40%", out: false })])[0];
    expect(low.title).toBe("Claude is nearly out");
    expect(low.action).toBeUndefined();
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

/**
 * James, 2026-11-11, on the toast "Claude is nearly out / 94% left of this 5-hour session (resets 8:49 PM), 7% of the
 * week (resets Thu 9 PM)": "Just put why the notification is up ... only 7% of the weekly limit is left, and then put
 * resets Thursday, 9 p.m." And the toast said Thu 9 PM while the AI plans panel said 10 PM: "we need to get the dates
 * consistent. It should be local time only, not UTC."
 */
describe("the Claude toast says only why it is up", () => {
  const now = new Date(2026, 10, 11, 16, 47).getTime();
  const weekEnd = new Date(2026, 10, 12, 21, 59, 59, 650).toISOString();
  const claude = row("anthropic", true, {
    left: "94%",
    out: false,
    windows: [
      { label: "5-hour session", used: 6, resets: new Date(2026, 10, 11, 20, 49, 59).toISOString() },
      { label: "Week", used: 93, resets: weekEnd },
    ],
  });

  it("names the low limit and its reset, and nothing else", () => {
    const [t] = aiToasts([claude], now);
    expect(t.text).toBe("Only 7% of the weekly limit is left. Resets Thu 10 PM.");
  });

  it("names both limits when both are low", () => {
    const both = { ...claude, windows: [{ ...claude.windows[0], used: 95 }, claude.windows[1]] };
    expect(aiToasts([both], now)[0].text).toBe(
      "Only 5% of the 5-hour session limit is left. Resets 8:50 PM. Only 7% of the weekly limit is left. Resets Thu 10 PM.",
    );
  });

  it("formats a reset the same way the AI plans panel does", () => {
    expect(resetText(weekEnd, now)).toBe("Thu 10 PM");
    expect(resetText(new Date(2026, 10, 11, 20, 49, 59).toISOString(), now)).toBe("8:50 PM");
    expect(resetText(new Date(2026, 10, 13, 9, 30).toISOString(), now)).toBe("Fri 9:30 AM");
    expect(resetText(new Date(2026, 10, 25, 9, 0).toISOString(), now)).toBe("Nov 25");
  });
});

/**
 * Review of PR #132 (card #131): on Hermes Plus a limit is not the credits. With keep-going off, a used-up limit means
 * Hermes waits for the reset and the top-up is not used, so the toast names the limit and has no Top up; the credit
 * titles stay for the credits. The row and the toast read one threshold: a limit at 90% or more is low.
 */
describe("the Nous toast on plan limits", () => {
  const now = new Date(2026, 10, 12, 9, 0).getTime();
  const dayReset = new Date(2026, 10, 12, 11, 5).getTime();
  const weekReset = new Date(2026, 10, 19, 0, 0).getTime();
  const monthReset = new Date(2026, 10, 20, 9, 7).getTime();
  const nous = (day: number, keepGoing = false, credits = 25.071492236524648, week = 1868) => ({
    provider: "nous",
    profiles: 3,
    kind: "usage",
    link: "https://portal.nousresearch.com",
    ...nousReading({
      logged_in: true,
      plan: "Hermes Plus",
      usable: credits,
      monthly: 0,
      charge: 20,
      plan_left: 0,
      topup: credits,
      usage_window: {
        gauges: [
          { id: "day", label: "Today", used_bp: day, resets_at_ms: dayReset },
          { id: "week", label: "This week", used_bp: week, resets_at_ms: weekReset },
          { id: "month", label: "This month", used_bp: 622, resets_at_ms: monthReset },
        ],
        keep_going_on_credits: keepGoing,
      },
    }),
  });

  it("names a used-up limit and says Hermes waits for the reset, with no Top up while keep-going is off", () => {
    const [t] = aiToasts([nous(10000)], now);
    expect(t.title).toBe("Nous: the daily limit is used up");
    expect(t.text).toBe("Hermes waits for the reset at 11:05 AM.");
    expect(t.action).toBeUndefined();
  });

  it("keeps the Top up while keep-going is on, since the top-up is then used", () => {
    const [t] = aiToasts([nous(10000, true)], now);
    expect(t.title).toBe("Nous: the daily limit is used up");
    expect(t.text).toBe("Hermes keeps going on the top-up: $25.07 left.");
    expect(t.action).toEqual({ label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" });
  });

  it("says the credits are out only when they are at 0", () => {
    const [t] = aiToasts([nous(1000, false, 0)], now);
    expect(t.title).toBe("Nous credits are out");
    expect(t.action).toEqual({ label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" });
  });

  it("gives a low limit a title about the limit, not the credits", () => {
    const [t] = aiToasts([nous(9500)], now);
    expect(t.title).toBe("Nous: the daily limit is nearly used up");
    expect(t.text).toBe("Only 5% of the daily limit is left. Resets 11:05 AM.");
    expect(t.action).toBeUndefined();
  });

  it("keeps the credit title for credits under $5", () => {
    const [t] = aiToasts([nous(1000, false, 3.5)], now);
    expect(t.title).toBe("Nous credits are nearly out");
    expect(t.text).toBe("$3.50 left");
  });

  it("gives a reason at exactly 90%, the same threshold the row reads", () => {
    const row = nous(9000);
    expect(row.low).toBe(true);
    const [t] = aiToasts([row], now);
    expect(t.text).toBe("Only 10% of the daily limit is left. Resets 11:05 AM.");
  });

  it("names the weekly limit as weekly", () => {
    const [t] = aiToasts([nous(1000, false, 25, 9600)], now);
    expect(t.text).toBe("Only 4% of the weekly limit is left. Resets Nov 19.");
  });

  it("shows a used-up toast again after the low one was dismissed", () => {
    const [low] = aiToasts([nous(9500)], now);
    const [used] = aiToasts([nous(10000)], now);
    expect(used.state).not.toBe(low.state);
  });
});
