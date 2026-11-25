import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moneyParts, resetText } from "@/lib/format";
import { claudeReading, nousReading } from "@/lib/server/ai";
import { warnings } from "@/lib/server/warnings";
import { aiToasts, creditBar } from "@/lib/toasts";

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

describe("the Nous plan limits and their on-top-up bar", () => {
  const now = new Date(2026, 10, 12, 9, 0).getTime();
  const dayReset = new Date(2026, 10, 12, 11, 5).getTime();
  const weekReset = new Date(2026, 10, 19, 0, 0).getTime();
  const monthReset = new Date(2026, 10, 20, 9, 7).getTime();
  const nous = (day: number, keepGoing = false, credits = 25.071492236524648, week = 1868, reset = dayReset) => ({
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
          { id: "day", label: "Today", used_bp: day, resets_at_ms: reset },
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

  it("gives no toast while keep-going runs on a top-up that still has money", () => {
    expect(aiToasts([nous(10000, true)], now)).toEqual([]);
  });

  it("has no Top up on a nearly used-up limit with keep-going on", () => {
    const [t] = aiToasts([nous(9500, true)], now);
    expect(t.title).toBe("Nous: the daily limit is nearly used up");
    expect(t.action).toBeUndefined();
  });

  it("shows Top up once the top-up itself is used up, limit or no limit", () => {
    const [t] = aiToasts([nous(10000, true, 0)], now);
    expect(t.title).toBe("Nous credits are out");
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
    expect(t.action).toBeUndefined();
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

  it("draws the on-top-up state as one status-bar line, not a toast (collector#246)", () => {
    const on = nous(10000, true);
    expect(aiToasts([on], now)).toEqual([]);
    expect(creditBar([on], now)).toEqual({
      text: "Nous: on top-up credits until the daily limit resets at 11:05 AM. $25.07 left.",
      short: "Nous: top-up until 11:05 AM. $25.07 left.",
      href: "https://portal.nousresearch.com",
    });
  });

  it("says the reset is tomorrow when it is", () => {
    const tomorrow = new Date(2026, 10, 13, 7, 22).getTime();
    const bar = creditBar([nous(10000, true, 16.37, 1868, tomorrow)], now);
    expect(bar?.text).toBe("Nous: on top-up credits until the daily limit resets at 7:22 AM tomorrow. $16.37 left.");
    expect(bar?.short).toBe("Nous: top-up until 7:22 AM tomorrow. $16.37 left.");
  });

  it("keeps the narrow line short enough for one line at 425 px, with the reset and the amount", () => {
    const tomorrow = new Date(2026, 10, 13, 10, 22).getTime();
    const short = creditBar([nous(10000, true, 1234.56, 1868, tomorrow)], now)?.short ?? "";
    expect(short).toBe("Nous: top-up until 10:22 AM tomorrow. $1234.56 left.");
    expect(short.length).toBeLessThanOrEqual(56);
  });

  it("names every used-up limit, and uses the last reset", () => {
    const bar = creditBar([nous(10000, true, 25, 10000)], now);
    expect(bar?.text).toBe("Nous: on top-up credits until the daily and weekly limits reset on Nov 19. $25.00 left.");
    expect(bar?.short).toBe("Nous: top-up until Nov 19. $25.00 left.");
  });

  it("gives no bar once the limit is not used up, while keep-going is off, or with no credits left", () => {
    expect(creditBar([nous(0, true)], now)).toBeNull();
    expect(creditBar([nous(9500, true)], now)).toBeNull();
    expect(creditBar([nous(10000)], now)).toBeNull();
    expect(creditBar([nous(10000, true, 0)], now)).toBeNull();
    expect(creditBar([], now)).toBeNull();
    expect(creditBar(undefined, now)).toBeNull();
  });
});

describe("the Anthropic reading", () => {
  const login = { subscriptionType: "max", rateLimitTier: "default_claude_max_5x" };
  const week = { utilization: 32, resets_at: "2026-11-27T02:59:59Z" };
  const profile = { organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_20x" } };

  it("names the plan Anthropic reports now, not the one saved at login", () => {
    expect(claudeReading({ five_hour: null, seven_day: week }, profile, login).plan).toBe("Claude Max (20x)");
  });

  it("falls back to the saved login when the profile cannot be read", () => {
    expect(claudeReading({ five_hour: null, seven_day: week }, null, login).plan).toBe("Claude Max (5x)");
  });

  it("shows no 5-hour panel when Anthropic reports no 5-hour limit", () => {
    const r = claudeReading({ five_hour: null, seven_day: week }, profile, login);
    expect(r.windows?.map((w) => w.label)).toEqual(["Week"]);
    expect(r.left).toBe("68%");
    expect(r.detail).not.toContain("5-hour");
  });

  it("still shows the 5-hour session when Anthropic reports one", () => {
    const r = claudeReading(
      { five_hour: { utilization: 40, resets_at: "2026-11-25T18:00:00Z" }, seven_day: week },
      profile,
      login,
    );
    expect(r.windows?.map((w) => w.label)).toEqual(["5-hour session", "Week"]);
    expect(r.left).toBe("60%");
  });
});

describe("the on-top-up bar follows the page's money conventions", () => {
  const src = readFileSync(path.join(process.cwd(), "components", "credit-bar.tsx"), "utf8");

  it("draws its line through the blur text, so the eye toggle covers the balance", () => {
    expect(src).toMatch(/<BlurText text=\{bar\.text\} \/>/);
    expect(src).toMatch(/<BlurText text=\{bar\.short\} \/>/);
  });

  it("carries the amount in the line the panel already shows", () => {
    expect(
      moneyParts("Nous: on top-up credits. $16.37 left.")
        .filter((p) => p.money)
        .map((p) => p.text),
    ).toEqual(["$16.37"]);
  });
});
