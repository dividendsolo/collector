import type { AiRow } from "./ai";
import { AI_LOW_USD } from "./ai";
import { type Config, unknownConfigKeys } from "./config";
import type { Domain } from "./domains";
import { TICKER_STALE_S } from "./hermes";
import type { GithubLimit } from "./machines";
import { exposedSockets } from "./network";
import type { Checked } from "./services";
import type { VendorRow } from "./vendors";
import type { XUsage } from "./x";

export interface Warning {
  level: "error" | "warn";
  text: string;
  url?: string;
  /** A value for the row's right side (GitHub Actions sets the dollars billed this month). */
  aside?: string;
  /** A one-click fix on the row's right side, posted to `post` (Start Tailscale on this machine). */
  action?: { label: string; post: string };
  /** A failed job's row can be acknowledged until its next run: `key` names that run, `next` is when the next one is. */
  ack?: { key: string; next: string | null };
  /** When the row first showed up, epoch seconds (state.ts adds it from first-seen.ts). */
  since?: number;
}

const START_TAILSCALE = { label: "Start Tailscale", post: "/api/tailscale" };
const START_HERMES = { label: "Start Hermes", post: "/api/hermes" };

/** A duration in the words a row reads it in: "12 min", "4 h". */
const ageText = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

export interface WarningInputs {
  machines: any[];
  github: GithubLimit;
  cfg: Config;
  services: Checked[];
  domains: Domain[];
  ticketsError: string | null;
  vendors?: VendorRow[];
  x: XUsage | null;
  ai: AiRow[];
}

/** Needs attention: failed jobs, a work script in a loop, one script started from two jobs, domains and certificates
 * near expiry, the GitHub GraphQL limit, sites down, machines that could not be read, the Hermes gateway or its cron
 * ticker on a machine that has one, the agents and jobs the user's own `watch` entries name, tickets that did not
 * list, low AI or X credit, open incidents of the vendors marked "attention" in config.json, and a config.json key
 * Collector does not read. Errors first. Adds `machine` and `what` to each job. */
export function warnings(w: WarningInputs): Warning[] {
  const out: Warning[] = [];
  const byScript = new Map<string, string[]>();
  const unknown = unknownConfigKeys(w.cfg);
  if (unknown.length)
    out.push({
      level: "warn",
      text: `config.json has ${unknown.length === 1 ? "a key" : `${unknown.length} keys`} Collector does not read: ${unknown.join(", ")}`,
    });
  const what = w.cfg.jobs || {};
  const work = w.cfg.work_script || {};
  const workJobs = new Set(work.jobs || []);
  const workLabel = work.label || "The work script";
  for (const m of w.machines) {
    // The foreman's host-broken-<repo> marker: this machine cannot pass that repo's base checks, so no card of
    // that repo is built here. collect.py reports each marker with its one line (the failing step and base SHA).
    for (const b of m.host_broken || [])
      if (b?.repo)
        out.push({ level: "error", text: `host broken: ${b.repo} on ${m.name}${b.line ? `: ${b.line}` : ""}` });
    // collect.py's tailnet state; null with no Tailscale on that machine. A stopped tailnet breaks every ssh job
    // there, so the jobs' rows carry the reason and, on this machine, the button that starts it again.
    const tailnetDown = !!m.tailscale && m.tailscale !== "Running";
    if (
      tailnetDown &&
      !(m.jobs || []).some((j: any) => j.enabled && j.ssh_host && j.last_status && !j.last_status.startsWith("ok"))
    )
      out.push({
        level: "warn",
        text: `Tailscale is ${String(m.tailscale).toLowerCase()} on ${m.name}`,
        ...(m.local ? { action: START_TAILSCALE } : {}),
      });
    // The Hermes gateway on that machine (agent-stack#261): the waiting crew runs as a Hermes cron on the gateway's
    // own ticker, so a gateway that is not running, or a ticker that has not moved in ten minutes, is a crew that has
    // stopped silently. A gateway that is down is an error (nothing of the crew runs); a ticker that stopped under a
    // running gateway is a warning (the process is up, its work is not). Only the machine Collector runs on gets the
    // button: a click would act there, never on the machine read over ssh.
    const gw = m.hermes_gateway;
    if (gw) {
      const age = typeof gw.ticker_age_s === "number" ? gw.ticker_age_s : null;
      if (!gw.running)
        out.push({
          level: "error",
          text: `Hermes gateway is down on ${m.name}`,
          ...(m.local ? { action: START_HERMES } : {}),
        });
      else if (age !== null && age > (gw.ticker_stale_s ?? TICKER_STALE_S))
        out.push({
          level: "warn",
          text: `Hermes cron ticker stopped ${ageText(age)} ago on ${m.name}`,
          ...(m.local ? { action: START_HERMES } : {}),
        });
    }
    for (const j of m.jobs || []) {
      j.machine = m.name;
      j.what = what[j.name] ?? (j.script || "");
      if (!j.enabled) continue;
      if (j.last_status && !j.last_status.startsWith("ok"))
        out.push({
          level: "error",
          text: `${j.name} on ${m.name}: last run ${j.last_status}${j.last_error ? ` (${j.last_error.slice(0, 140)})` : ""}`,
          ...(j.ssh_host && tailnetDown && m.local ? { action: START_TAILSCALE } : {}),
          ack: { key: `${m.name}|${j.name}|${j.last_run_at ?? ""}`, next: j.next_run_at ?? null },
        });
      const key = workJobs.has(j.name) ? workLabel : j.script;
      if (key) {
        const k = JSON.stringify([key, m.name]);
        byScript.set(k, [...(byScript.get(k) || []), j.name]);
      }
    }
    // The agents and jobs the user's own `watch` entries name (collector#54): collect.py read each entry's own
    // signal on that machine — a process, a coding-agent session, a launchd label, a log or a heartbeat file — and
    // the row carries what it found. Failing is an error and idle too long a warning, the same as our droids; a
    // signal that is alive (`busy`) or last worked (`ok`) says nothing here. An entry Collector cannot read is a
    // warning: a setting that does nothing should not be silent.
    for (const x of m.watch || [])
      if (x.state !== "busy" && x.state !== "ok")
        out.push({
          level: x.state === "failed" ? "error" : "warn",
          text: `${x.name} on ${m.name}: ${x.detail || x.state}`,
        });
    // The ports anyone on the internet can connect to (collector#65), one error row per machine naming the first ten:
    // a machine can have twenty, and a row each would bury every other warning on the Dashboard. A port only the
    // local network, the tailnet or the machine itself can reach is no warning. The Network page has each port with
    // its addresses and its process. The firewall is not read, so a port listed here may still be blocked there.
    const open = exposedSockets(m);
    if (open.length) {
      const shown = open.slice(0, 10).map((s) => `${s.proto} ${s.port}`);
      const rest = open.length - shown.length;
      out.push({
        level: "error",
        text: `${open.length === 1 ? "1 port" : `${open.length} ports`} on ${m.name} ${open.length === 1 ? "is" : "are"} open to anyone on the internet: ${shown.join(", ")}${rest ? `, and ${rest} more (see the Network page)` : ""}`,
      });
    }
    // The two sshd settings that should not be on, read on the same machine read (collector#65).
    // Only from `sshd -T`, the settings sshd really uses: the config file alone can be overridden by a drop-in
    // (ezio, 2026-11-06: the file said yes, sshd_config.d/00-hardening.conf said no, and this row was false).
    const ssh = m.network?.ssh;
    if (ssh?.source === "sshd -T" && ssh.passwordauthentication)
      out.push({ level: "error", text: `SSH on ${m.name}: password authentication is on` });
    if (ssh?.source === "sshd -T" && ssh.permitrootlogin)
      out.push({ level: "error", text: `SSH on ${m.name}: root login is on` });
    const starts: number[] = Array.isArray(m.work_starts_10m) ? m.work_starts_10m : [];
    const limit = work.max_starts_60s ?? 5;
    // collect.py reports the starts as epoch seconds.
    const stamps = starts.filter((t) => typeof t === "number").sort((a, b) => a - b);
    let burst = 0;
    for (let i = 0; i < stamps.length; i++) {
      let j = i;
      while (j < stamps.length && stamps[j] - stamps[i] <= 60) j++;
      if (j - i > burst) burst = j - i;
    }
    if (burst >= limit)
      out.push({
        level: "error",
        text: `${workLabel} on ${m.name} started ${burst} times in 60 s: it is starting itself in a loop`,
      });
  }
  for (const [k, where] of byScript) {
    const [script, machine] = JSON.parse(k);
    if (where.length > 1)
      out.push({
        level: "warn",
        text: `The same script (${script}) starts from ${where.length} jobs on ${machine}: ${where.join(", ")}`,
      });
  }
  for (const d of w.domains) {
    if (d.registered && d.days != null && d.days <= 30)
      out.push({
        level: d.days <= 7 ? "error" : "warn",
        text: `${d.name} expires in ${d.days} days (${d.expires}) at ${d.registrar || "its registrar"}`,
      });
    if (d.auto_renew === false && d.days != null && d.days <= 60)
      out.push({ level: "warn", text: `${d.name} expires in ${d.days} days and auto-renew is off` });
    if (d.ssl_days != null && d.ssl_days <= 14)
      out.push({ level: "error", text: `The HTTPS certificate of ${d.name} runs out in ${d.ssl_days} days` });
  }
  const g = w.github.graphql;
  if (g && g.limit - g.used < 500)
    out.push({ level: "error", text: `GitHub GraphQL limit nearly gone: ${g.limit - g.used} of ${g.limit} left` });
  const ga = w.github.actions;
  if (ga?.used != null && ga.limit && ga.used >= ga.limit * 0.9)
    out.push({
      level: ga.used >= ga.limit ? "error" : "warn",
      text: `GitHub Actions: ${ga.used.toLocaleString()} of ${ga.limit.toLocaleString()} included minutes used this month${ga.used >= ga.limit ? " (each extra minute is billed)" : ""}`,
      url: "https://github.com/settings/billing",
      aside: `$${(ga.billed ?? 0).toFixed(2)} billed`,
    });
  for (const x of w.services)
    if (x.status === "down") out.push({ level: "error", text: `${x.name} is down: ${x.error} (${x.url})` });
  // A machine read over ssh fails while this machine's tailnet is down: the row says so and carries the same button.
  const here = w.machines.find((m) => m.local);
  const hereDown = !!here?.tailscale && here.tailscale !== "Running";
  for (const m of w.machines)
    if (m.error)
      out.push({
        level: "error",
        text: `Could not read ${m.name}: ${m.error}${!m.local && hereDown ? ` (Tailscale is ${String(here.tailscale).toLowerCase()} on ${here.name})` : ""}`,
        ...(!m.local && hereDown ? { action: START_TAILSCALE } : {}),
      });
  if (w.ticketsError) out.push({ level: "warn", text: `Could not list tickets: ${w.ticketsError}` });
  const watched = new Set((w.cfg.vendors || []).filter((v) => v.attention).map((v) => v.name));
  for (const v of w.vendors || [])
    if (watched.has(v.name) && v.incidents.length)
      out.push({
        level: v.state === "major" || v.state === "critical" ? "error" : "warn",
        text: `${v.name} incident: ${v.incidents.map((i) => `${i.name} (${i.impact})`).join("; ")}`,
        url: v.url,
      });
  const xc = w.x?.credits?.total;
  if (typeof xc === "number" && xc < AI_LOW_USD)
    out.push({
      level: "error",
      text: `X API: $${xc.toFixed(2)} of credits left (top up before Situation's X wire stops)`,
      url: "https://console.x.com",
    });
  for (const a of w.ai)
    if (a.low)
      out.push({
        level: "error",
        url: a.link,
        text: a.alert || `${`${a.provider}: ${a.left} left ${a.detail || ""}`.trim()} (top up before the lanes stop)`,
      });
  return [...out.filter((x) => x.level === "error"), ...out.filter((x) => x.level === "warn")];
}
