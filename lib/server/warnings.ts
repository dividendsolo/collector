import type { AiRow } from "./ai";
import { AI_LOW_USD } from "./ai";
import type { Config } from "./config";
import type { Domain } from "./domains";
import type { GithubLimit } from "./machines";
import type { Checked } from "./services";
import type { XUsage } from "./x";

export interface Warning {
  level: "error" | "warn";
  text: string;
  url?: string;
}

export interface WarningInputs {
  machines: any[];
  github: GithubLimit;
  cfg: Config;
  services: Checked[];
  domains: Domain[];
  ticketsError: string | null;
  x: XUsage | null;
  ai: AiRow[];
}

/** Needs attention: failed jobs, a work script in a loop, one script started from two jobs, domains and certificates
 * near expiry, the GitHub GraphQL limit, sites down, machines that could not be read, tickets that did not list, and
 * low AI or X credit. Errors first. Adds `machine` and `what` to each job. */
export function warnings(w: WarningInputs): Warning[] {
  const out: Warning[] = [];
  const byScript = new Map<string, string[]>();
  const what = w.cfg.jobs || {};
  const work = w.cfg.work_script || {};
  const workJobs = new Set(work.jobs || []);
  const workLabel = work.label || "The work script";
  for (const m of w.machines) {
    for (const j of m.jobs || []) {
      j.machine = m.name;
      j.what = what[j.name] ?? (j.script || "");
      if (!j.enabled) continue;
      if (j.last_status && !j.last_status.startsWith("ok"))
        out.push({
          level: "error",
          text: `${j.name} on ${m.name}: last run ${j.last_status}${j.last_error ? ` (${j.last_error.slice(0, 140)})` : ""}`,
        });
      const key = workJobs.has(j.name) ? workLabel : j.script;
      if (key) {
        const k = JSON.stringify([key, m.name]);
        byScript.set(k, [...(byScript.get(k) || []), j.name]);
      }
    }
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
    });
  for (const x of w.services)
    if (x.status === "down") out.push({ level: "error", text: `${x.name} is down: ${x.error} (${x.url})` });
  for (const m of w.machines) if (m.error) out.push({ level: "error", text: `Could not read ${m.name}: ${m.error}` });
  if (w.ticketsError) out.push({ level: "warn", text: `Could not list tickets: ${w.ticketsError}` });
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
