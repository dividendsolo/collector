/**
 * The toasts (collector#67): a small card on every page when a service turns Slow or Down, or a machine has ports
 * open to the internet, so nobody has to scroll to the Service health panel or the Network page to learn it.
 *
 * A toast has no Dismiss: it stays while the problem lasts and goes away by itself when the problem is resolved
 * (James, 2026-11-06: "we want that toast to be there until everything's resolved"). Each toast has a `key` (which
 * thing it is about) and a `state` (what is wrong with it now): a dismissed toast shows again in a new state.
 *
 * Pure functions here; the component (`components/toasts.tsx`) reads the services and the state.
 */

import type { Check } from "./checks";
import { AI_LOW_PERCENT, resetText } from "./format";
import { jumpHref } from "./jump";
import { webUrl } from "./links";

export interface Toast {
  /** Which thing it is about: `service:<url>` or `network:<machine>`. */
  key: string;
  /** What is wrong with it now: a new state is a new problem. */
  state: string;
  level: "error" | "warn";
  title: string;
  text: string;
  /** Where the details are: the Services page, or the Network page. */
  href: string;
  /** Drawn without the colored dot (James, 2026-11-09, on the Nous toast: "No dot"). */
  noDot?: boolean;
  /** A button that does the fix, opened in a new tab: the Nous top-up page (James, 2026-11-09). */
  action?: { label: string; url: string };
  /** An amber Security check the user may dismiss (James, 2026-11-06: "if they're okay with it, that's fine"). A
   * red one, a Down service and an open port stay until fixed. */
  dismissible?: boolean;
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
  /** The machine's own job notices: one line of `~/.hermes/notices/*.jsonl` each (collector#82). */
  notices?: NoticeIn[];
}

interface NoticeIn {
  key?: string;
  level?: string;
  text?: string;
  href?: string | null;
}

/** A service that is Slow or Down: one toast, its state the status and the error. */
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

/** A machine with ports open to the internet: one toast naming them, its state the list of ports. A port only the
 * local network, the tailnet or the machine itself can reach is no toast. */
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

/** A machine whose sshd really lets passwords or root in: one red toast. Read from `sshd -T` (the settings sshd
 * uses, drop-ins included); a reading from the config file alone can be overridden by a drop-in, so it makes no
 * toast (ezio, 2026-11-06: the file said yes, the drop-in said no). */
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

/** A machine's Security checks that are not green: red ones stay until fixed, amber ones may be dismissed. Grey
 * (not read) makes no toast: there is nothing to fix, only nothing known. The open ports and SSH are checks too, so
 * this replaces their own toasts on the page. */
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
        // The fix is in the check's card on the Network page; a command in a toast wraps badly and reads worse.
        text: `${c.label}: ${c.value}`,
        href: jumpHref("network", c.id.endsWith(":internet") ? `ports:${m.name}:internet` : c.id),
        dismissible: c.level === "amber",
      });
    }
  }
  return out;
}

/** The toasts to show: the dismissed amber ones left out while their state is the same. A dismissal holds for that
 * state only, so a new value (another app on the allow list) shows again. */
export function visibleToasts(all: Toast[], dismissed: Record<string, string>): Toast[] {
  return all.filter((t) => !(t.dismissible && dismissed[t.key] === t.state));
}

/** The dismissals still worth keeping: a check that is green now drops its dismissal, so the next time it breaks
 * its toast shows, even with the same value as before (2026-11-06: dismiss "stealth off", fix it, break it again,
 * and the toast stayed hidden). A check that is still amber, and one not read this time, keeps its dismissal. */
export function forgetFixed(
  dismissed: Record<string, string>,
  machines: { name: string; checks: Check[] }[],
): Record<string, string> {
  const green = new Set(machines.flatMap((m) => m.checks.filter((c) => c.level === "green").map((c) => c.id)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dismissed)) if (!green.has(k)) out[k] = v;
  return out;
}

/** How many ports are open to the internet, across every machine: the Network page's count in the sidebar. A port is
 * counted once per machine, whatever its addresses. */
export function internetPortCount(machines: MachineIn[] | null | undefined): number {
  let n = 0;
  for (const m of machines || []) {
    const seen = new Set<string>();
    for (const s of m.network?.sockets || []) if (s.reach === "internet") seen.add(`${s.proto} ${s.port}`);
    n += seen.size;
  }
  return n;
}

/** A machine's job notices (collector#82): one amber toast per line a job wrote into `~/.hermes/notices/*.jsonl` —
 * a new directory listing, say — its title the line's own text, linking to the listing. It is good news, so it is
 * never an error and draws no red, and a line whose key is acknowledged makes no toast: the row on the
 * Dashboard carries the Acknowledge, and both read the same acks, so one click clears the pair. */
export function noticeToasts(machines: MachineIn[] | null | undefined, acks: string[] = []): Toast[] {
  const out: Toast[] = [];
  for (const m of machines || []) {
    for (const n of m.notices || []) {
      const text = (n.text || "").trim();
      if (!text) continue;
      const key = n.key || text;
      if (acks.includes(key)) continue;
      // The line's href is outside data, and the title above it is the link: only a web address is one (collector#84).
      const href = webUrl(n.href);
      out.push({
        key,
        state: text,
        level: n.level === "error" ? "error" : "warn",
        title: text,
        // The title is the link, so the body is the address it goes to; a notice with no link says nothing more.
        text: href || "",
        href: href || jumpHref("dashboard", "attention"),
      });
    }
  }
  return out;
}

/** The toasts to show, errors first, then warnings. */
export function sortToasts(all: Toast[]): Toast[] {
  const rank = { error: 0, warn: 1 };
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

/** A GitHub API limit (REST or GraphQL) with under 500 calls left: one amber toast with Dismiss, since nobody can fix
 * it but wait for the reset (James, 2026-11-06: "there's really nothing you can do") that names what is left and when it
 * that names what is left and when it resets, linked to the GitHub limits panel on the APIs page. Its state is `low`,
 * then `out` at zero, so a dismissed toast shows again when the limit runs out (James, 2026-11-06, after REST hit 0
 * and only the APIs page said so: "that should be a notification in the toast"). */
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

/** Nous and Claude running low (James, 2026-11-09: "noose, we want to see that one show up. And we want to see the
 * clawed one show up in the bottom right, too"). The other providers are fallbacks and get no toast. Amber and
 * dismissible; its state is what is left, so a new low shows again. */
const AI_TOASTS: Record<string, { name: string; out: string; low: string; action?: { label: string; url: string } }> = {
  // The billing page Hermes itself sends people to (hermes_cli/portal_cli.py, SUBSCRIPTION_URL).
  nous: {
    name: "Nous",
    out: "Nous credits are out",
    low: "Nous credits are nearly out",
    action: { label: "Top up", url: "https://portal.nousresearch.com/manage-subscription" },
  },
  // Claude sometimes grants a free limit reset; its "Reset for free" button is on Settings > Usage, and Collector cannot
  // see whether one is there (James, 2026-11-11: "Check for reset is good").
  anthropic: {
    name: "Claude",
    out: "Claude is out",
    low: "Claude is nearly out",
    action: { label: "Check for reset", url: "https://claude.ai/settings/usage" },
  },
};

interface AiIn {
  provider: string;
  low?: boolean;
  left?: string | null;
  detail?: string | null;
  link?: string;
  windows?: { label: string; used: number; resets: string | null }[];
}

/** The limit names a toast says ("the weekly limit"), by the window's label in lib/server/ai.ts. */
const LIMIT_NAMES: Record<string, string> = {
  Week: "weekly",
  "5-hour session": "5-hour session",
  "5-hour window": "5-hour",
};

/** Why the toast is up, and nothing else (James, 2026-11-11: "Just put why the notification is up"): each low window as
 * "Only 7% of the weekly limit is left. Resets Thu 10 PM." A reading with no windows (a balance) says what is left. */
function whyLow(a: AiIn, now: number): string {
  const low = (a.windows || []).filter((w) => 100 - w.used < AI_LOW_PERCENT);
  if (!low.length) return `${a.left ?? "?"} left`;
  return low
    .map((w) => {
      const reset = resetText(w.resets, now);
      return `Only ${Math.max(0, 100 - w.used)}% of the ${LIMIT_NAMES[w.label] || w.label.toLowerCase()} limit is left.${reset ? ` Resets ${reset}.` : ""}`;
    })
    .join(" ");
}

export function aiToasts(ai: AiIn[] | null | undefined, now = Date.now()): Toast[] {
  const out: Toast[] = [];
  for (const a of ai || []) {
    const t = AI_TOASTS[a.provider];
    if (!t || !a.low) continue;
    const empty = a.left === "$0.00" || a.left === "0%";
    out.push({
      key: `ai:${a.provider}`,
      state: a.left || "low",
      // Red-bordered (James, 2026-11-09: "make it red bordered").
      level: "error",
      noDot: true,
      title: empty ? t.out : t.low,
      text: whyLow(a, now),
      href: a.link || jumpHref("dashboard", "ai-plans"),
      ...(t.action ? { action: t.action } : {}),
      dismissible: true,
    });
  }
  return out;
}
