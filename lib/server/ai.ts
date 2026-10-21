import fs from "node:fs";
import path from "node:path";
import { swr } from "./cache";
import { hermesEnv } from "./env";
import { bearer, getJson, why } from "./http";
import { snapshot } from "./machines";
import { HERMES_HOME } from "./paths";
import { run, runText } from "./run";
import { check } from "./services";

export const AI_LOW_USD = 5;
export const AI_LOW_PERCENT = 10; // under these, a provider goes to Needs attention

export interface AiRow {
  provider: string;
  profiles: number;
  link?: string;
  kind: "plan" | "usage";
  plan?: string | null;
  left?: string | null;
  detail?: string | null;
  note?: string;
  low?: boolean;
  alert?: string;
  windows?: { label: string; used: number; resets: string | null }[];
}
type Reading = Omit<AiRow, "provider" | "profiles" | "link" | "kind">;

/** Nous credits through Hermes's own portal client: the portal login lives in Hermes's auth.json. */
const NOUS_SCRIPT = `
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
os.chdir(sys.path[0])
from hermes_cli.nous_account import get_nous_portal_account_info
info = get_nous_portal_account_info(force_fresh=True)
access, sub = getattr(info, "paid_service_access_info", None), getattr(info, "subscription", None)
print(json.dumps({"logged_in": bool(getattr(info, "logged_in", False)), "plan": getattr(sub, "plan", None),
                  "usable": getattr(access, "total_usable_credits", None), "monthly": getattr(sub, "monthly_credits", None),
                  "renews": getattr(sub, "current_period_end", None)}))
`;
const LINKS: Record<string, string> = {
  anthropic: "https://claude.ai/settings/usage",
  nous: "https://portal.nousresearch.com",
  minimax: "https://platform.minimax.io/user-center/payment/coding-plan",
  "xai-oauth": "https://grok.com",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** "renews in 9 days (Oct 30)", in local time. */
export function renewsText(iso: string | null | undefined, now = new Date()): string {
  const end = new Date(iso || "");
  if (Number.isNaN(end.getTime())) return "";
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(end) - day(now)) / 86_400_000);
  const when = `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return days > 0 ? `in ${days} ${days === 1 ? "day" : "days"} (${when})` : `today (${when})`;
}

async function nous(): Promise<Reading> {
  const py = path.join(HERMES_HOME, "hermes-agent", "venv", "bin", "python");
  const [data, err] = await run([py, "-c", NOUS_SCRIPT], { timeout: 30 });
  if (!data?.logged_in) return { note: `Could not read the Nous portal: ${err || "not logged in"}` };
  const left = data.usable;
  const renews = renewsText(data.renews);
  return {
    plan: data.plan,
    left: isNum(left) ? `$${left.toFixed(2)}` : null,
    detail: isNum(data.monthly)
      ? `usable on the $${data.monthly.toFixed(0)}/month plan with top-ups${renews ? `, renews ${renews}` : ""}`
      : null,
    low: isNum(left) && left < AI_LOW_USD,
  };
}

async function minimax(): Promise<Reading> {
  const key = hermesEnv().MINIMAX_API_KEY;
  if (!key) return { note: "No MINIMAX_API_KEY in ~/.hermes/.env" };
  let d: any;
  try {
    d = await getJson("https://api.minimax.io/v1/api/openplatform/coding_plan/remains", bearer(key));
  } catch (e) {
    return { note: `Could not read the MiniMax plan: ${why(e).slice(0, 80)}` };
  }
  const m = (d.model_remains || []).find((x: any) => x.model_name === "general");
  if (!m) return { note: "MiniMax returned no plan" };
  const now = m.current_interval_remaining_percent;
  const week = m.current_weekly_remaining_percent;
  const ms = (v: number) => (v ? new Date(v).toISOString() : null);
  return {
    plan: "Coding plan",
    left: `${now}%`,
    windows: [
      { label: "5-hour window", used: 100 - (now ?? 100), resets: ms(m.end_time) },
      { label: "Week", used: 100 - (week ?? 100), resets: ms(m.weekly_end_time) },
    ],
    detail: `of this 5-hour window, ${week}% of the week`,
    low: Math.min(now ?? 100, week ?? 100) < AI_LOW_PERCENT,
  };
}

/** "3:15 PM" or "Thu 9 AM", in local time, like the old strftime with leading zeros dropped. */
export function clock(iso: string | null | undefined, withDay: boolean): string {
  const t = new Date(iso || "");
  if (Number.isNaN(t.getTime())) return "?";
  const h = t.getHours() % 12 || 12;
  const ampm = t.getHours() < 12 ? "AM" : "PM";
  return withDay ? `${WEEKDAYS[t.getDay()]} ${h} ${ampm}` : `${h}:${String(t.getMinutes()).padStart(2, "0")} ${ampm}`;
}

/** The Claude subscription's session and week limits, through Claude Code's own login in the macOS keychain (read
 * only). It never refreshes that login: Claude Code owns it. The token stays in memory for one request. */
async function anthropic(): Promise<Reading> {
  const plan0 = "Claude subscription";
  let login: any;
  try {
    const r = await runText(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      timeout: 10,
    });
    login = JSON.parse(r.stdout.trim()).claudeAiOauth || {};
  } catch {
    return { plan: plan0, note: "No Claude Code login on this Mac" };
  }
  if ((login.expiresAt || 0) / 1000 < Date.now() / 1000)
    return { plan: plan0, note: "Claude Code login expired: open Claude Code to renew it" };
  let d: any;
  try {
    d = await getJson("https://api.anthropic.com/api/oauth/usage", {
      ...bearer(login.accessToken),
      "anthropic-beta": "oauth-2025-04-20",
    });
  } catch (e) {
    return { plan: plan0, note: `Could not read Claude usage: ${why(e).slice(0, 80)}` };
  }
  const session = d.five_hour || {};
  const week = d.seven_day || {};
  const sUsed = Math.round(session.utilization || 0);
  const wUsed = Math.round(week.utilization || 0);
  const tier = (login.rateLimitTier || "").match(/(\d+x)$/);
  const plan = ({ max: "Claude Max", pro: "Claude Pro" } as Record<string, string>)[login.subscriptionType] || plan0;
  return {
    plan: plan + (tier ? ` (${tier[1]})` : ""),
    left: `${100 - sUsed}%`,
    windows: [
      { label: "5-hour session", used: sUsed, resets: session.resets_at ?? null },
      { label: "Week", used: wUsed, resets: week.resets_at ?? null },
    ],
    detail: `of this 5-hour session (resets ${clock(session.resets_at, false)}), ${100 - wUsed}% of the week (resets ${clock(week.resets_at, true)})`,
    low: Math.min(100 - sUsed, 100 - wUsed) < AI_LOW_PERCENT,
  };
}

/** xAI has no usage API for a Grok subscription login, so this checks the login itself: a free models list. */
async function grok(): Promise<Reading> {
  let token: string;
  try {
    token = JSON.parse(fs.readFileSync(path.join(HERMES_HOME, "auth.json"), "utf8")).providers["xai-oauth"].tokens
      .access_token;
    if (!token) throw new Error();
  } catch {
    return {
      plan: "Grok subscription",
      note: "No Grok login in Hermes",
      low: true,
      alert: "Grok: no login in Hermes, so xresearch cannot search X",
    };
  }
  const c = await check({ name: "grok", url: "https://api.x.ai/v1/models", headers: bearer(token) });
  if (c.status === "down")
    return {
      plan: "Grok subscription",
      note: `Login failed (${c.error}): log in again for xresearch`,
      low: true,
      alert: "Grok login failed, so xresearch cannot search X: log in again",
    };
  return { plan: "Grok subscription", note: "Login OK (xAI has no usage API for subscriptions)" };
}

const READERS: Record<string, () => Promise<Reading>> = { nous, minimax, anthropic, xai: grok };
const KIND: Record<string, "usage"> = { nous: "usage" };

/** One row per AI provider the Hermes profiles use (each profile's config.yaml), read from the provider. */
async function readAll(): Promise<{ at: number; providers: AiRow[] }> {
  const snap = await snapshot.get();
  const users = new Map<string, string[]>();
  for (const m of snap.machines)
    for (const prof of m.profiles || []) {
      if (!prof.provider) continue;
      // One account, one row: the Claude SDK login is the same Claude subscription as "anthropic".
      const slug = prof.provider.startsWith("claude") ? "anthropic" : prof.provider;
      users.set(slug, [...(users.get(slug) || []), `${m.name}:${prof.name}`]);
    }
  const sorted = [...users].sort((a, b) => b[1].length - a[1].length);
  const providers = await Promise.all(
    sorted.map(async ([slug, profiles]) => {
      const base = slug.split("-")[0];
      const reader = READERS[slug] || READERS[base];
      const row: Reading = reader ? await reader() : { note: "Subscription login, no usage API" };
      return {
        ...row,
        provider: slug,
        profiles: profiles.length,
        link: LINKS[slug] || LINKS[base],
        kind: KIND[slug] || "plan",
      } as AiRow;
    }),
  );
  return { at: Date.now() / 1000, providers };
}

/** A read takes seconds (the Nous portal), so a stale list is served while a new one is read in the background. */
export const ai = swr("ai", 300_000, readAll);
export const lastAi = () => ai.peek()?.providers ?? [];
