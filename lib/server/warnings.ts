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
  /** Its group on Priority tasks, which sets the order (lib/priority.ts, James 2026-11-11). */
  group?: PriorityGroup;
  url?: string;
  /** A value for the row's right side (GitHub Actions sets the dollars billed this month). */
  aside?: string;
  /** A one-click fix on the row's right side, posted to `post` (Start Tailscale on this machine). */
  action?: { label: string; post: string };
  /** The Debug and fix button (app/api/debug-fix, James 2026-11-11): a failed cron run, by machine and job id, or the
   * work script's loop on a machine (id WORK_LOOP). */
  debug?: { machine: string; id: string };
  /** The Debug and fix button of a main that fails its checks on a machine (James, 2026-11-11). */
  fixMain?: { machine: string; repo: string };
  /** A failed job's row can be acknowledged until its next run: `key` names that run, `next` is when the next one is. */
  ack?: { key: string; next: string | null };
  /** When the row first showed up, epoch seconds (state.ts adds it from first-seen.ts). */
  since?: number;
}

const START_TAILSCALE = { label: "Start Tailscale", post: "/api/tailscale" };
const START_HERMES = { label: "Start Hermes", post: "/api/hermes" };

/** A duration in the words a row reads it in: "12 min", "4 h". */
/** A time as Unix seconds, or undefined when there is none or it does not parse. */
const secs = (t: unknown): number | undefined => {
  const n = typeof t === "string" ? Date.parse(t) : Number.NaN;
  return Number.isNaN(n) ? undefined : n / 1000;
};
/** The earliest of these times, as Unix seconds. */
const oldest = (ts: unknown[]): number | undefined => {
  const n = ts.map(secs).filter((x): x is number => x !== undefined);
  return n.length ? Math.min(...n) : undefined;
};
const ageText = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** How many days before a renewal the row shows: a charge lands before it, not after (collector#78). */
export const RENEWS_WARN_DAYS = 7;

/** Whole calendar days until a renewal date (`subscriptions[].renews`, `YYYY-MM-DD`), or null for a date that is
 * not one. Local days, so a renewal at 23:50 is not the day after tomorrow (collector#78). */
export function renewalDays(renews: unknown, now = Date.now()): number | null {
  if (!isRenewsDate(renews)) return null;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  // Local noon: an hour of daylight saving never changes which day the date names.
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
/** The foreman's error when a CI run never started: GitHub kept no log for it. */
const NO_RUN_LOG = /failed to get run log|log not found/i;
/** The card the foreman filed for a red main, at the end of the marker line (`<step>: base <sha> card #<n>`,
 * agent-stack#398; agent-stack PR #401 writes it). */
const MARKER_CARD = / card #\d+\s*$/;
/** A preflight marker's line: the machine cannot run the check at all, and no card is filed for it. */
const PREFLIGHT = /^preflight:/;

/** True when a watched GitHub vendor row has an open incident that names Actions. */
function githubActionsDown(w: WarningInputs): boolean {
  const watched = (w.cfg.vendors || []).some((v) => v.name === GITHUB && v.attention);
  const gh = (w.vendors || []).find((v) => v.name === GITHUB);
  return watched && !!gh?.incidents.some((i) => !i.stale && (i.where || []).some((p) => /actions/i.test(p)));
}

/** ". omarchy4mac builds wait on it (altair, ezio)", one sentence per repo; nothing when none waits. */
function waitText(waiting: Map<string, string[]>): string {
  return [...waiting.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, hosts]) => `. ${repo} builds wait on it (${hosts.join(", ")})`)
    .join("");
}

/** A host-broken marker's line, "<step>: base <sha>", as its step and short SHA; a line without a base is the step.
 * The card the foreman filed for this red main is not part of the step (agent-stack#398). */
export function brokenStep(line?: string): { step: string; sha: string } {
  const rest = (line || "").replace(MARKER_CARD, "");
  const m = rest.match(/^(.*?):\s*base\s+([0-9a-f]{7,40})/);
  return m ? { step: m[1], sha: m[2].slice(0, 7) } : { step: rest, sha: "" };
}

/** The foreman's name for the repo's unit tests in GitHub Actions (agent-stack CI_LABEL, "Jog CI ci.yml"). */
const CI_STEP = /^Jog CI (\S+)$/;

/** One host-broken marker as a sentence (James, 2026-11-11: "what is causing the checks to fail on main? ... Why is
 * it getting triggered? And then why is it failing?"): what fails, what runs the check and why, what it stops, and the
 * step and error that failed. */
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

/** The page of main's CI runs for a repo, when the failed step is its GitHub Actions workflow; else undefined. */
function ciRunsUrl(cfg: Config, repo: string, line?: string): string | undefined {
  const ci = brokenStep(line).step.match(CI_STEP);
  if (!ci) return undefined;
  const projects = Array.isArray(cfg.projects) ? cfg.projects : Object.keys(cfg.projects || {});
  const full = projects.find((p: string) => p.split("/")[1] === repo) || `dividendsolo/${repo}`;
  return `https://github.com/${full}/actions/workflows/${ci[1]}?query=branch%3Amain`;
}

/** Needs attention: failed jobs, a work script in a loop, one script started from two jobs, domains and certificates
 * near expiry, the GitHub GraphQL limit, sites down, machines that could not be read, the Hermes gateway or its cron
 * ticker on a machine that has one, the agents and jobs the user's own `watch` entries name, the good news a machine's
 * own job wrote a notice for, tickets that did not list, low AI or X credit, open incidents of the vendors marked
 * "attention" in config.json, and a config.json key Collector does not read. Errors first. Adds `machine` and `what`
 * to each job. */
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
  // A value Collector would not use (a project's stage, a vendor's criticality, a renewal date: collector#78) is
  // the same kind of setting that does nothing, so it is named here too, and by `bun run check:config`.
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
  // GitHub's own Actions outage (James, 2026-11-11): a main whose CI run has no log at all is GitHub's, not ours, and
  // James can do nothing about it: "if there's nothing I can do except wait ... then they shouldn't be in there."
  // No row. During an incident naming Actions the GitHub incident row names the builds that wait on it.
  const actionsDown = githubActionsDown(w);
  const waitingOnGithub = new Map<string, string[]>();
  for (const m of w.machines) {
    // The foreman's host-broken-<repo> marker: the repo's checks fail on its main branch at this machine, so no
    // card of that repo is built here. The row says what failed, not whose fault it is (James, 2026-11-11: "It's not
    // a great error"): the step and short SHA from the marker's line, and the first error line of the foreman's log.
    for (const b of m.host_broken || []) {
      if (!b?.repo) continue;
      if (NO_RUN_LOG.test(b.error || "")) {
        if (actionsDown) waitingOnGithub.set(b.repo, [...(waitingOnGithub.get(b.repo) || []), m.name]);
        continue;
      }
      // agent-stack#398: the foreman filed a card for this red main, so the card on the board is the work. A
      // preflight marker names a machine that cannot run the check at all (no card is filed for it), so it keeps its
      // row whatever its line says.
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
    // collect.py's tailnet state; null with no Tailscale on that machine. A stopped tailnet breaks every ssh job
    // there, so the jobs' rows carry the reason and, on this machine, the button that starts it again.
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
          // No Acknowledge: a failed run is fixed, not acknowledged (James, 2026-11-11).
          ...(j.id ? { debug: { machine: m.name, id: String(j.id) } } : {}),
          // The age is the failed run's own time, not when Collector first saw the row (James, 2026-11-11).
          ...(secs(j.last_run_at) ? { since: secs(j.last_run_at) } : {}),
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
          group: "jobs",
          level: x.state === "failed" ? "error" : "warn",
          text: `${x.name} on ${m.name}: ${x.detail || x.state}`,
        });
    // A job's good news (collector#82): each line of the machine's `~/.hermes/notices/*.jsonl` is one row —
    // "Situation is listed on App Rater" — linking to the listing and acknowledged by the line's own key, so it
    // shows once and goes away when acknowledged rather than waiting for a run that will never clear it. Info is a
    // warning, not an error: nothing is wrong, and the row draws no red.
    for (const n of m.notices || []) {
      // The line's href is outside data, like a feed's incident link: only a web address goes in the row's href
      // (collector#84).
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
    // The ports anyone on the internet can connect to (collector#65), one error row per machine naming the first ten:
    // a machine can have twenty, and a row each would bury every other warning on the Dashboard. A port only the
    // local network, the tailnet or the machine itself can reach is no warning. The Network page has each port with
    // its addresses and its process. The firewall is not read, so a port listed here may still be blocked there.
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
    // The two sshd settings that should not be on, read on the same machine read (collector#65).
    // Only from `sshd -T`, the settings sshd really uses: the config file alone can be overridden by a drop-in
    // (ezio, 2026-11-06: the file said yes, sshd_config.d/00-hardening.conf said no, and this row was false).
    const ssh = m.network?.ssh;
    if (ssh?.source === "sshd -T" && ssh.passwordauthentication)
      out.push({ group: "security", level: "error", text: `SSH on ${m.name}: password authentication is on` });
    if (ssh?.source === "sshd -T" && ssh.permitrootlogin)
      out.push({ group: "security", level: "error", text: `SSH on ${m.name}: root login is on` });
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
  // A subscription that renews inside the week (collector#78): the row names the day and the amount, so the charge
  // is not a surprise. Only an active one, the same reading the Subscriptions page has of "active": an ended
  // subscription renews nothing.
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
        // Acknowledged once renewed (James, 2026-11-09): the key holds the expiry date, so a new date asks again.
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
  // A machine read over ssh fails while this machine's tailnet is down: the row says so and carries the same button.
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
    out.push({ group: "cant-work", level: "warn", text: `Could not list tickets: ${w.ticketsError}` });
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
        // Nothing to fix on our side: acknowledged, it stays faded until the vendor's incidents change (James,
        // 2026-11-11). A new build waiting on GitHub changes the key, so it shows again.
        ack: {
          key: `vendor|${v.name}|${v.incidents.map((i) => i.name).join("|")}${
            v.name === GITHUB && waitingOnGithub.size ? `|waits:${[...waitingOnGithub.keys()].sort().join(",")}` : ""
          }`,
          next: null,
        },
        // The age is when the vendor opened its oldest open incident (James, 2026-11-11: "time ago since it showed on
        // the board, that's useless").
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
  // One row only when every provider with a usage reading is out: a fallback still answers otherwise (James,
  // 2026-11-09: "one message that says that we are completely out when ... all the fallbacks are drained"). Out, not
  // low: the row showed with Claude at 13% left (2026-11-11). Nous and Claude running low are toasts (lib/toasts.ts,
  // aiToasts).
  const metered = w.ai.filter((a) => a.left != null || a.windows?.length);
  if (metered.length && metered.every((a) => a.out))
    out.push({
      group: "cant-work",
      level: "error",
      text: `Every AI plan is out: ${metered.map((a) => a.provider).join(", ")}. The lanes stop until one resets.`,
    });
  // James's group order (lib/priority.ts), not errors first: a security warning goes above a failed job.
  return priorityOrder(out);
}
