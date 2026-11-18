import { money } from "../format";
import { webUrl } from "../links";
import { type PriorityGroup, priorityOrder } from "../priority";
import type { AiRow } from "./ai";
import { AI_LOW_USD } from "./ai";
import { badConfigValues, type Config, isRenewsDate, unknownConfigKeys } from "./config";
import { WORK_LOOP } from "./debug-fix";
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
  group?: PriorityGroup;
  url?: string;
  aside?: string;
  action?: { label: string; post: string };
  debug?: { machine: string; id: string };
  fixMain?: { machine: string; repo: string };
  ack?: { key: string; next: string | null };
  since?: number;
}

const START_TAILSCALE = { label: "Start Tailscale", post: "/api/tailscale" };
const START_HERMES = { label: "Start Hermes", post: "/api/hermes" };

const secs = (t: unknown): number | undefined => {
  const n = typeof t === "string" ? Date.parse(t) : Number.NaN;
  return Number.isNaN(n) ? undefined : n / 1000;
};
const oldest = (ts: unknown[]): number | undefined => {
  const n = ts.map(secs).filter((x): x is number => x !== undefined);
  return n.length ? Math.min(...n) : undefined;
};
const ageText = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

export const RENEWS_WARN_DAYS = 7;

export function renewalDays(renews: unknown, now = Date.now()): number | null {
  if (!isRenewsDate(renews)) return null;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(new Date(`${renews}T12:00:00`)) - day(new Date(now))) / 86_400_000);
}

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

const GITHUB = "GitHub";
const NO_RUN_LOG = /failed to get run log|log not found/i;
const MARKER_CARD = / card #\d+\s*$/;
const PREFLIGHT = /^preflight:/;

function githubActionsDown(w: WarningInputs): boolean {
  const watched = (w.cfg.vendors || []).some((v) => v.name === GITHUB && v.attention);
  const gh = (w.vendors || []).find((v) => v.name === GITHUB);
  return watched && !!gh?.incidents.some((i) => !i.stale && (i.where || []).some((p) => /actions/i.test(p)));
}

function waitText(waiting: Map<string, string[]>): string {
  return [...waiting.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, hosts]) => `. ${repo} builds wait on it (${hosts.join(", ")})`)
    .join("");
}

export function brokenStep(line?: string): { step: string; sha: string } {
  const rest = (line || "").replace(MARKER_CARD, "");
  const m = rest.match(/^(.*?):\s*base\s+([0-9a-f]{7,40})/);
  return m ? { step: m[1], sha: m[2].slice(0, 7) } : { step: rest, sha: "" };
}

const CI_STEP = /^Jog CI (\S+)$/;

export function hostBrokenText(b: { repo: string; line?: string; error?: string }, host: string) {
  const { step, sha } = brokenStep(b.line);
  const ci = step.match(CI_STEP);
  const what = ci ? `the unit tests in GitHub Actions (${ci[1]})` : step ? `\`${step}\`` : "a check";
  const failed = `Failed: ${what}${sha ? ` at ${sha}` : ""}${b.error ? `: ${b.error}` : "."}`;
  return (
    `${b.repo}: main fails its own checks on ${host}. The foreman tests main before it builds a card, so ${host} ` +
    `builds no ${b.repo} cards until main passes. ${failed}`
  );
}

function ciRunsUrl(cfg: Config, repo: string, line?: string): string | undefined {
  const ci = brokenStep(line).step.match(CI_STEP);
  if (!ci) return undefined;
  const projects = Array.isArray(cfg.projects) ? cfg.projects : Object.keys(cfg.projects || {});
  const full = projects.find((p: string) => p.split("/")[1] === repo) || `dividendsolo/${repo}`;
  return `https://github.com/${full}/actions/workflows/${ci[1]}?query=branch%3Amain`;
}

export function warnings(w: WarningInputs): Warning[] {
  const out: Warning[] = [];
  const byScript = new Map<string, string[]>();
  const unknown = unknownConfigKeys(w.cfg);
  if (unknown.length)
    out.push({
      group: "cant-work",
      level: "warn",
      text: `config.json has ${unknown.length === 1 ? "a key" : `${unknown.length} keys`} Collector does not read: ${unknown.join(", ")}`,
    });
  const bad = badConfigValues(w.cfg);
  if (bad.length)
    out.push({
      group: "cant-work",
      level: "warn",
      text: `config.json has ${bad.length === 1 ? "a value" : `${bad.length} values`} Collector does not use: ${bad.join("; ")}`,
    });
  const what = w.cfg.jobs || {};
  const work = w.cfg.work_script || {};
  const workJobs = new Set(work.jobs || []);
  const workLabel = work.label || "The work script";
  const actionsDown = githubActionsDown(w);
  const waitingOnGithub = new Map<string, string[]>();
  for (const m of w.machines) {
    for (const b of m.host_broken || []) {
      if (!b?.repo) continue;
      if (NO_RUN_LOG.test(b.error || "")) {
        if (actionsDown) waitingOnGithub.set(b.repo, [...(waitingOnGithub.get(b.repo) || []), m.name]);
        continue;
      }
      if (MARKER_CARD.test(b.line || "") && !PREFLIGHT.test(b.line || "")) continue;
      const url = ciRunsUrl(w.cfg, b.repo, b.line);
      out.push({
        group: "cant-work",
        level: "error",
        text: hostBrokenText(b, m.name),
        ...(url ? { url } : {}),
        fixMain: { machine: m.name, repo: b.repo },
      });
    }
    const tailnetDown = !!m.tailscale && m.tailscale !== "Running";
    if (
      tailnetDown &&
      !(m.jobs || []).some((j: any) => j.enabled && j.ssh_host && j.last_status && !j.last_status.startsWith("ok"))
    )
      out.push({
        group: "cant-work",
        level: "warn",
        text: `Tailscale is ${String(m.tailscale).toLowerCase()} on ${m.name}`,
        ...(m.local ? { action: START_TAILSCALE } : {}),
      });
    const gw = m.hermes_gateway;
    if (gw) {
      const age = typeof gw.ticker_age_s === "number" ? gw.ticker_age_s : null;
      if (!gw.running)
        out.push({
          group: "cant-work",
          level: "error",
          text: `Hermes gateway is down on ${m.name}`,
          ...(m.local ? { action: START_HERMES } : {}),
        });
      else if (age !== null && age > (gw.ticker_stale_s ?? TICKER_STALE_S))
        out.push({
          group: "cant-work",
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
          group: "jobs",
          level: "error",
          text: `${j.name} on ${m.name}: last run ${j.last_status}${j.last_error ? ` (${j.last_error.slice(0, 140)})` : ""}`,
          ...(j.ssh_host && tailnetDown && m.local ? { action: START_TAILSCALE } : {}),
          ...(j.id ? { debug: { machine: m.name, id: String(j.id) } } : {}),
          ...(secs(j.last_run_at) ? { since: secs(j.last_run_at) } : {}),
        });
      const key = workJobs.has(j.name) ? workLabel : j.script;
      if (key) {
        const k = JSON.stringify([key, m.name]);
        byScript.set(k, [...(byScript.get(k) || []), j.name]);
      }
    }
    for (const x of m.watch || [])
      if (x.state !== "busy" && x.state !== "ok")
        out.push({
          group: "jobs",
          level: x.state === "failed" ? "error" : "warn",
          text: `${x.name} on ${m.name}: ${x.detail || x.state}`,
        });
    for (const n of m.notices || []) {
      const href = webUrl(n?.href);
      if (n?.text)
        out.push({
          group: "good-news",
          level: n.level === "error" ? "error" : "warn",
          text: String(n.text),
          ...(href ? { url: href } : {}),
          ack: { key: String(n.key || n.text), next: null },
        });
    }
    const open = exposedSockets(m);
    if (open.length) {
      const shown = open.slice(0, 10).map((s) => `${s.proto} ${s.port}`);
      const rest = open.length - shown.length;
      out.push({
        group: "security",
        level: "error",
        text: `${open.length === 1 ? "1 port" : `${open.length} ports`} on ${m.name} ${open.length === 1 ? "is" : "are"} open to anyone on the internet: ${shown.join(", ")}${rest ? `, and ${rest} more (see the Network page)` : ""}`,
      });
    }
    const ssh = m.network?.ssh;
    if (ssh?.source === "sshd -T" && ssh.passwordauthentication)
      out.push({ group: "security", level: "error", text: `SSH on ${m.name}: password authentication is on` });
    if (ssh?.source === "sshd -T" && ssh.permitrootlogin)
      out.push({ group: "security", level: "error", text: `SSH on ${m.name}: root login is on` });
    const starts: number[] = Array.isArray(m.work_starts_10m) ? m.work_starts_10m : [];
    const limit = work.max_starts_60s ?? 5;
    const stamps = starts.filter((t) => typeof t === "number").sort((a, b) => a - b);
    let burst = 0;
    for (let i = 0; i < stamps.length; i++) {
      let j = i;
      while (j < stamps.length && stamps[j] - stamps[i] <= 60) j++;
      if (j - i > burst) burst = j - i;
    }
    if (burst >= limit)
      out.push({
        group: "cant-work",
        level: "error",
        text: `${workLabel} on ${m.name} started ${burst} times in 60 s: it is starting itself in a loop`,
        debug: { machine: m.name, id: WORK_LOOP },
      });
  }
  for (const [k, where] of byScript) {
    const [script, machine] = JSON.parse(k);
    if (where.length > 1)
      out.push({
        group: "cant-work",
        level: "warn",
        text: `The same script (${script}) starts from ${where.length} jobs on ${machine}: ${where.join(", ")}`,
      });
  }
  for (const s of Array.isArray(w.cfg.subscriptions) ? w.cfg.subscriptions : []) {
    const days = renewalDays(s.renews);
    if ((s.status || "active") === "active" && days != null && days >= 0 && days <= RENEWS_WARN_DAYS)
      out.push({
        group: "money",
        level: "warn",
        text: `${s.name} renews on ${s.renews} for ${money(s.amount, s.currency || "USD")}`,
      });
  }
  for (const d of w.domains) {
    if (d.registered && d.days != null && d.days <= 30)
      out.push({
        group: "cant-work",
        level: d.days <= 7 ? "error" : "warn",
        text: `${d.name} expires in ${d.days} days (${d.expires}) at ${d.registrar || "its registrar"}`,
        ack: { key: `domain|${d.name}|${d.expires}`, next: null },
      });
    if (d.auto_renew === false && d.days != null && d.days <= 60)
      out.push({
        group: "cant-work",
        level: "warn",
        text: `${d.name} expires in ${d.days} days and auto-renew is off`,
      });
    if (d.ssl_days != null && d.ssl_days <= 14)
      out.push({
        group: "cant-work",
        level: "error",
        text: `The HTTPS certificate of ${d.name} runs out in ${d.ssl_days} days`,
      });
  }
  for (const [k, name] of [
    ["graphql", "GraphQL"],
    ["core", "REST"],
  ] as const) {
    const g = w.github[k];
    if (g && g.limit - g.used < 500)
      out.push({
        group: "money",
        level: "error",
        text: `GitHub ${name} limit nearly gone: ${Math.max(0, g.limit - g.used)} of ${g.limit} left`,
      });
  }
  const ga = w.github.actions;
  if (ga?.used != null && ga.limit && ga.used >= ga.limit * 0.9)
    out.push({
      group: "money",
      level: ga.used >= ga.limit ? "error" : "warn",
      text: `GitHub Actions: ${ga.used.toLocaleString()} of ${ga.limit.toLocaleString()} included minutes used this month${ga.used >= ga.limit ? " (each extra minute is billed)" : ""}`,
      url: "https://github.com/settings/billing",
      aside: `$${(ga.billed ?? 0).toFixed(2)} billed`,
    });
  for (const x of w.services)
    if (x.status === "down")
      out.push({ group: "cant-work", level: "error", text: `${x.name} is down: ${x.error} (${x.url})` });
  const here = w.machines.find((m) => m.local);
  const hereDown = !!here?.tailscale && here.tailscale !== "Running";
  for (const m of w.machines)
    if (m.error)
      out.push({
        group: "cant-work",
        level: "error",
        text: `Could not read ${m.name}: ${m.error}${!m.local && hereDown ? ` (Tailscale is ${String(here.tailscale).toLowerCase()} on ${here.name})` : ""}`,
        ...(!m.local && hereDown ? { action: START_TAILSCALE } : {}),
      });
  if (w.ticketsError)
    out.push({
      group: "cant-work",
      level: "warn",
      text: `Could not list tickets: ${w.ticketsError}`,
      ack: { key: `tickets|${w.ticketsError}`, next: null },
    });
  const watched = new Set((w.cfg.vendors || []).filter((v) => v.attention).map((v) => v.name));
  for (const v of w.vendors || [])
    if (watched.has(v.name) && v.incidents.length)
      out.push({
        group: "cant-work",
        level: v.state === "major" || v.state === "critical" ? "error" : "warn",
        text: `${v.name} incident: ${v.incidents.map((i) => `${i.name.replace(/\.\s*$/, "")} (${i.impact})`).join("; ")}${
          v.name === GITHUB ? waitText(waitingOnGithub) : ""
        }`,
        url: v.url,
        ack: {
          key: `vendor|${v.name}|${v.incidents.map((i) => i.name).join("|")}${
            v.name === GITHUB && waitingOnGithub.size ? `|waits:${[...waitingOnGithub.keys()].sort().join(",")}` : ""
          }`,
          next: null,
        },
        ...(oldest(v.incidents.map((i) => i.opened)) ? { since: oldest(v.incidents.map((i) => i.opened)) } : {}),
      });
  const xc = w.x?.credits?.total;
  if (typeof xc === "number" && xc < AI_LOW_USD)
    out.push({
      group: "money",
      level: "error",
      text: `X API: $${xc.toFixed(2)} of credits left (top up before Situation's X wire stops)`,
      url: "https://console.x.com",
    });
  const metered = w.ai.filter((a) => a.left != null || a.windows?.length);
  if (metered.length && metered.every((a) => a.out))
    out.push({
      group: "cant-work",
      level: "error",
      text: `Every AI plan is out: ${metered.map((a) => a.provider).join(", ")}. The lanes stop until one resets.`,
    });
  return priorityOrder(out);
}
