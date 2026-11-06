/**
 * The toasts (collector#67): a small card on every page when a service turns Slow or Down, or a machine has ports
 * open to the internet, so nobody has to scroll to the Service health panel or the Network page to learn it.
 *
 * A toast has no Dismiss: it stays while the problem lasts and goes away by itself when the problem is resolved
 * (James, 2026-11-06: "we want that toast to be there until everything's resolved"). Each toast has a `key` (which
 * thing it is about) and a `state` (what is wrong with it now); the alarm sound uses the pair to sound once per new
 * problem.
 *
 * Pure functions here; the component (`components/toasts.tsx`) reads the services and the state.
 */

import type { Check } from "./checks";

export interface Toast {
  /** Which thing it is about: `service:<url>` or `network:<machine>`. */
  key: string;
  /** What is wrong with it now: a new state is a new problem, and sounds the alarm again. */
  state: string;
  level: "error" | "warn";
  title: string;
  text: string;
  /** Where the details are: the Services page, or the Network page. */
  href: string;
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
      href: "#/services",
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
      href: "#/network?first=internet",
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
      href: "#/network",
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
        href: c.id.endsWith(":internet") ? "#/network?first=internet" : "#/network",
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

/** The toasts to show, errors first, then warnings. */
export function sortToasts(all: Toast[]): Toast[] {
  const rank = { error: 0, warn: 1 };
  return [...all].sort((a, b) => rank[a.level] - rank[b.level]);
}

/** The red toasts that are new since the last look: an error whose key and state were not showing before. A toast
 * already showing makes no sound twice; a warning (Slow) makes none. */
export function newAlarms(shown: Toast[], heard: Set<string>): Toast[] {
  return shown.filter((t) => t.level === "error" && !heard.has(`${t.key}|${t.state}`));
}
