import type { Check } from "./checks";
import { AI_LOW_PERCENT, limitLow, resetText } from "./format";
import { jumpHref } from "./jump";
import { webUrl } from "./links";

export interface Toast {
  key: string;
  state: string;
  level: "error" | "warn" | "good";
  title: string;
  text: string;
  href: string;
  noDot?: boolean;
  action?: { label: string; url: string };
  dismissible?: boolean;
  acknowledges?: boolean;
}

interface ServiceIn {
  name: string;
  url: string;
  status: string;
  error: string | null;
}

interface PortIn {
  proto: string;
  port: number;
  reach: string;
}

interface MachineIn {
  name: string;
  network?: {
    sockets?: PortIn[];
    ssh?: { source: string | null; passwordauthentication: boolean; permitrootlogin: boolean } | null;
  } | null;
  notices?: NoticeIn[];
}

interface NoticeIn {
  key?: string;
  level?: string;
  text?: string;
  href?: string | null;
}

export function serviceToasts(services: ServiceIn[] | null | undefined): Toast[] {
  const out: Toast[] = [];
  for (const s of services || []) {
    if (s.status !== "down" && s.status !== "slow") continue;
    const word = s.status === "down" ? "Down" : "Slow";
    out.push({
      key: `service:${s.url}`,
      state: s.status === "down" ? `down:${s.error ?? ""}` : "slow",
      level: s.status === "down" ? "error" : "warn",
      title: `${s.name} is ${word}`,
      text: s.error ? s.error : s.url.replace(/^https?:\/\//, ""),
      href: jumpHref("services", `service:${s.url}`),
    });
  }
  return out;
}

export function networkToasts(machines: MachineIn[] | null | undefined): Toast[] {
  const out: Toast[] = [];
  for (const m of machines || []) {
    const seen = new Set<string>();
    const ports: string[] = [];
    for (const s of m.network?.sockets || []) {
      if (s.reach !== "internet") continue;
      const p = `${s.proto} ${s.port}`;
      if (seen.has(p)) continue;
      seen.add(p);
      ports.push(p);
    }
    if (!ports.length) continue;
    const shown = ports.slice(0, 6).join(", ");
    const rest = ports.length - Math.min(ports.length, 6);
    out.push({
      key: `network:${m.name}`,
      state: [...ports].sort().join(","),
      level: "error",
      title: `${ports.length === 1 ? "1 port" : `${ports.length} ports`} on ${m.name} open to the internet`,
      text: `${shown}${rest ? `, and ${rest} more` : ""}`,
      href: jumpHref("network", `ports:${m.name}:internet`),
    });
  }
  return out;
}

export function sshToasts(machines: MachineIn[] | null | undefined): Toast[] {
  const out: Toast[] = [];
  for (const m of machines || []) {
    const ssh = m.network?.ssh;
    if (ssh?.source !== "sshd -T") continue;
    const on: string[] = [];
    if (ssh.passwordauthentication) on.push("password logins");
    if (ssh.permitrootlogin) on.push("root login");
    if (!on.length) continue;
    out.push({
      key: `ssh:${m.name}`,
      state: on.join(","),
      level: "error",
      title: `SSH on ${m.name} allows ${on.join(" and ")}`,
      text: "Set PasswordAuthentication no and PermitRootLogin no in sshd's config, then reload sshd.",
      href: jumpHref("network", `check:${m.name}:ssh`),
    });
  }
  return out;
}

export function checkToasts(machines: { name: string; checks: Check[] }[]): Toast[] {
  const out: Toast[] = [];
  for (const m of machines) {
    for (const c of m.checks) {
      if (c.level !== "red" && c.level !== "amber") continue;
      out.push({
        key: c.id,
        state: `${c.level}:${c.value}`,
        level: c.level === "red" ? "error" : "warn",
        title: `${m.name}: ${c.problem ?? c.label}`,
        text: `${c.label}: ${c.value}`,
        href: jumpHref("network", c.id.endsWith(":internet") ? `ports:${m.name}:internet` : c.id),
        dismissible: c.level === "amber",
      });
    }
  }
  return out;
}

export type Shown = Toast & { leaving: boolean };

export function withLeaving(prev: Shown[], next: Toast[]): Shown[] {
  const out: Shown[] = next.map((t) => ({ ...t, leaving: false }));
  prev.forEach((p, i) => {
    if (out.some((t) => t.key === p.key)) return;
    const before = i === 0 ? -1 : out.findIndex((t) => t.key === prev[i - 1].key);
    out.splice(before + 1, 0, { ...p, leaving: true });
  });
  return out;
}

export function visibleToasts(all: Toast[], dismissed: Record<string, string>): Toast[] {
  return all.filter((t) => !(t.dismissible && dismissed[t.key] === t.state));
}

export function forgetFixed(
  dismissed: Record<string, string>,
  machines: { name: string; checks: Check[] }[],
): Record<string, string> {
  const green = new Set(machines.flatMap((m) => m.checks.filter((c) => c.level === "green").map((c) => c.id)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dismissed)) if (!green.has(k)) out[k] = v;
  return out;
}

export function internetPortCount(machines: MachineIn[] | null | undefined): number {
  let n = 0;
  for (const m of machines || []) {
    const seen = new Set<string>();
    for (const s of m.network?.sockets || []) if (s.reach === "internet") seen.add(`${s.proto} ${s.port}`);
    n += seen.size;
  }
  return n;
}

export function noticeToasts(machines: MachineIn[] | null | undefined, acks: string[] = []): Toast[] {
  const out: Toast[] = [];
  for (const m of machines || []) {
    for (const n of m.notices || []) {
      const text = (n.text || "").trim();
      if (!text) continue;
      const key = n.key || text;
      if (acks.includes(key)) continue;
      const href = webUrl(n.href);
      const shared = {
        key,
        state: text,
        title: text,
        text: href || "",
        href: href || jumpHref("dashboard", "attention"),
      };
      out.push(
        n.level === "error"
          ? { ...shared, level: "error" }
          : { ...shared, level: "good", noDot: true, dismissible: true, acknowledges: true },
      );
    }
  }
  return out;
}

export function sortToasts(all: Toast[]): Toast[] {
  const rank = { error: 0, warn: 1, good: 2 };
  return [...all].sort((a, b) => rank[a.level] - rank[b.level]);
}

interface LimitIn {
  used: number;
  limit: number;
  reset: number;
}

const GITHUB_LOW = 500;
const GITHUB_NAMES = { core: "REST", graphql: "GraphQL" } as const;

const resetTime = (s: number) => new Date(s * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function githubToasts(
  github: { error?: string | null; core?: LimitIn; graphql?: LimitIn } | null | undefined,
  time: (reset: number) => string = resetTime,
): Toast[] {
  if (!github || github.error) return [];
  const out: Toast[] = [];
  for (const k of ["core", "graphql"] as const) {
    const l = github[k];
    if (!l) continue;
    const left = Math.max(0, l.limit - l.used);
    if (left >= GITHUB_LOW) continue;
    out.push({
      key: `github:${k}`,
      state: left === 0 ? "out" : "low",
      level: "warn",
      title: `GitHub ${GITHUB_NAMES[k]} limit ${left === 0 ? "used up" : "nearly gone"}`,
      text: `${left.toLocaleString("en-US")} of ${l.limit.toLocaleString("en-US")} left. Resets ${time(l.reset)}.`,
      href: jumpHref("apis", "github-limit"),
      dismissible: true,
    });
  }
  return out;
}

const AI_TOASTS: Record<
  string,
  {
    name: string;
    out: string;
    low: string;
    action?: { label: string; url: string };
    outAction?: { label: string; url: string };
  }
> = {
  nous: {
    name: "Nous",
    out: "Nous credits are out",
    low: "Nous credits are nearly out",
    outAction: { label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" },
  },
  anthropic: {
    name: "Claude",
    out: "Claude is out",
    low: "Claude is nearly out",
    outAction: { label: "Check for reset", url: "https://claude.ai/settings/usage" },
  },
};

interface AiIn {
  provider: string;
  low?: boolean;
  left?: string | null;
  detail?: string | null;
  link?: string;
  out?: boolean;
  waits?: boolean;
  windows?: { label: string; used: number; resets: string | null; limit?: boolean }[];
}

const LIMIT_NAMES: Record<string, string> = {
  Week: "weekly",
  "5-hour session": "5-hour session",
  "5-hour window": "5-hour",
  Today: "daily",
  "This week": "weekly",
  "This month": "monthly",
};

const limitName = (w: { label: string }) => LIMIT_NAMES[w.label] || w.label.toLowerCase();

const theLimits = (ws: { label: string }[]) =>
  `the ${ws.map(limitName).join(" and ")} ${ws.length > 1 ? "limits are" : "limit is"}`;

function whyLow(a: AiIn, now: number, low = (a.windows || []).filter((w) => 100 - w.used < AI_LOW_PERCENT)): string {
  if (!low.length) return `${a.left ?? "?"} left`;
  return low
    .map((w) => {
      const reset = resetText(w.resets, now);
      return `Only ${Math.max(0, 100 - w.used)}% of the ${limitName(w)} limit is left.${reset ? ` Resets ${reset}.` : ""}`;
    })
    .join(" ");
}

function nousLimitToast(a: AiIn, now: number): Pick<Toast, "state" | "title" | "text"> | null {
  const limits = (a.windows || []).filter((w) => w.limit);
  const usedUp = limits.filter((w) => w.used >= 100);
  if (a.waits && usedUp.length) {
    const last = usedUp.some((w) => !w.resets)
      ? null
      : usedUp
          .map((w) => w.resets as string)
          .sort()
          .at(-1);
    const reset = resetText(last, now);
    return {
      state: `out:${usedUp.map((w) => w.label).join(",")}`,
      title: `Nous: ${theLimits(usedUp)} used up`,
      text: `Hermes waits for the reset${reset ? ` ${/^\d/.test(reset) ? "at" : "on"} ${reset}` : ""}.`,
    };
  }
  if (a.left === "$0.00") return null;
  if (usedUp.length)
    return {
      state: `on:${usedUp.map((w) => `${w.label}@${w.resets ?? ""}`).join(",")}`,
      title: `Nous: ${theLimits(usedUp)} used up`,
      text: `Hermes keeps going on the top-up: ${a.left ?? "?"} left.`,
    };
  const low = limits.filter((w) => limitLow(w.used));
  if (!low.length) return null;
  return {
    state: `low:${low.map((w) => w.label).join(",")}`,
    title: `Nous: ${theLimits(low)} nearly used up`,
    text: whyLow(a, now, low),
  };
}

export function aiToasts(ai: AiIn[] | null | undefined, now = Date.now()): Toast[] {
  const out: Toast[] = [];
  for (const a of ai || []) {
    const t = AI_TOASTS[a.provider];
    if (!t || !a.low) continue;
    const limit = a.provider === "nous" ? nousLimitToast(a, now) : null;
    if (limit) {
      out.push({
        key: `ai:${a.provider}`,
        level: "error",
        noDot: true,
        href: a.link || jumpHref("dashboard", "ai-plans"),
        dismissible: true,
        ...limit,
      });
      continue;
    }
    const empty = !!a.out || a.left === "$0.00" || a.left === "0%";
    const action = (empty && t.outAction) || t.action;
    out.push({
      key: `ai:${a.provider}`,
      state: a.left || "low",
      level: "error",
      noDot: true,
      title: empty ? t.out : t.low,
      text: empty ? "" : whyLow(a, now),
      href: a.link || jumpHref("dashboard", "ai-plans"),
      ...(action ? { action } : {}),
      dismissible: true,
    });
  }
  return out;
}
