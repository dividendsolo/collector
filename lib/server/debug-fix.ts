import { homedir } from "node:os";
import { runText } from "./run";

export interface DebugJob {
  id: string;
  name: string;
  last_status?: string | null;
  last_error?: string | null;
  last_run_at?: string | null;
  script_path?: string | null;
  profile?: string | null;
}

export interface DebugMachine {
  machine: string;
  ssh: string | null;
  local: boolean;
}

export const WORK_LOOP = "work-loop";

export const LOOP_GONE = "Foreman isn't looping any more (it ran once a minute since). Nothing to fix.";

export const TRIAGE_KEY = "triage";

export function workLoopPrompt(
  m: DebugMachine,
  work: { label?: string; name?: string; log?: string },
  row: string,
): string {
  const step = (name: (typeof FIX_STEPS)[number]) => `\`tmux set -p -t "$TMUX_PANE" ${STEP_OPTION} "${name}"\``;
  const label = work.label || "The work script";
  return [
    `Debug and fix: ${label}${work.name ? ` (${work.name})` : ""} is starting itself in a loop on ${m.machine}.`,
    "",
    `- Collector says: ${row}`,
    work.log ? `- Its log: ${work.log} on ${m.machine}` : "",
    m.local || !m.ssh ? "- The machine is this one." : `- Reach the machine with \`ssh ${m.ssh}\`.`,
    "",
    "James's Debug and fix button shows the step you are on. Run each step's command, word for word, as the first",
    "thing in that step. Use no other words.",
    "",
    "Do this, in order:",
    `1. ${step("finding the cause")} Find why it starts again and again: what starts it (cron, launchd, systemd, a job), and why each run ends at once. Read its log. Find the repo that holds its source.`,
    `2. ${step("writing the failing test")} Write a failing test that reproduces the cause (TDD). Run it and see it fail for that reason.`,
    `3. ${step("fixing")} Fix the code until that test passes. Then run the tests around it.`,
    `4. ${step("shipping")} Ship the fix with the shipit skill, in a worktree. Deploy it to the machine if the repo does not.`,
    `5. ${step("rerunning the job")} Watch it on the machine for a few minutes: it starts once per its schedule, not in a loop.`,
    `6. ${step("done: the job ran ok")} Report the proof: the test that failed before the fix and passes after, and the starts back to normal.`,
    "",
    `If you cannot go on (the fix needs James: a key, a login, a decision), run ${step("stuck")} and tell him why.`,
    "",
    "A cause you cannot prove with a test is a guess: say so.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export function triagePrompt(card: { repo: string; number: number }): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(card.repo) || !Number.isInteger(card.number) || card.number < 1)
    throw new Error(`not a card: ${card.repo}#${card.number}`);
  const ref = `${card.repo}#${card.number}`;
  return [
    `/skill:triage Triage ${ref} with James. It is the one card in needs-triage on the board.`,
    "",
    `1. Load the product-stage skill, and read the repo's CONTEXT.md \`## Stage\`. Then read the card: \`gh issue view ${card.number} -R ${card.repo} --comments\`.`,
    "2. Check every claim in the card against the code, the logs or the live system yourself before you propose anything.",
    "3. Propose the triage in a few lines: the type (bug, enhancement, tech-debt, security), the priority (P0, P1, P2), the status (ready-for-agent, ready-for-human, needs-info, or close), what is in scope, and why.",
    "4. Wait for James's answer. Change nothing on the card before he says so.",
    "5. When he agrees: set the labels and the priority, post the triage comment, and move the card with `~/.local/bin/status`.",
    "6. Then run the after-triage-sweep skill on the same repo.",
  ].join("\n");
}

export const mainKey = (fix: { machine: string; repo: string }) => `main/${fix.machine}/${fix.repo}`;

export function mainChecksPrompt(
  m: DebugMachine,
  b: { repo: string; step: string; sha: string; error?: string },
): string {
  if (!/^[\w.-]+$/.test(b.repo)) throw new Error(`not a repo: ${b.repo}`);
  const step = (name: (typeof FIX_STEPS)[number]) => `\`tmux set -p -t "$TMUX_PANE" ${STEP_OPTION} "${name}"\``;
  const on = (cmd: string) => (m.local || !m.ssh ? `\`${cmd}\`` : `\`ssh ${m.ssh} ${cmd}\``);
  return [
    `Debug and fix: ${b.repo}'s main fails its own checks on ${m.machine}, so the foreman there builds no ${b.repo} cards.`,
    "",
    "The foreman (agent-stack foreman/foreman.py, base_gate) runs the repo's checks on origin/main before it builds a",
    "card, so a red main is not blamed on the card. Two failures in a row write the marker that stops the builds.",
    "",
    `- Failed step: ${b.step || "unknown"}${b.sha ? ` at ${b.sha}` : ""}`,
    `- Error: ${b.error || "none recorded"}`,
    `- The failing output: ${on(`cat ~/.hermes/foreman/base-gate-${b.repo}.log`)}`,
    `- The marker: ${on(`cat ~/.hermes/foreman/host-broken-${b.repo}`)}`,
    "",
    "James's Debug and fix button shows the step you are on. Run each step's command, word for word, as the first",
    "thing in that step. Use no other words.",
    "",
    "Do this, in order:",
    `1. ${step("finding the cause")} Find why main fails: in the repo's code, on that machine only (its setup), or not our code at all. Check main's CI runs on GitHub too.`,
    `2. ${step("writing the failing test")} Write a failing test that reproduces the cause (TDD). Run it and see it fail for that reason.`,
    `3. ${step("fixing")} Fix the code until that test passes. Then run the tests around it.`,
    `4. ${step("shipping")} Ship the fix with the shipit skill, in a worktree.`,
    `5. ${step("rerunning the job")} The foreman rechecks main on its own (at most once an hour). To recheck now, run ${on(`rm -f ~/.hermes/foreman/base-gate-${b.repo}.json`)}; the next tick runs the checks again and removes the marker when main passes.`,
    `6. ${step("done: the job ran ok")} Report the proof: the test that failed before the fix and passes after, and the marker gone.`,
    "",
    `If you cannot go on (the fix needs James: a key, a login, a decision), run ${step("stuck")} and tell him why.`,
    "",
    "A cause you cannot prove with a test is a guess: say so.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export const unblockKey = (card: { repo: string; number: number }) => `unblock/${card.repo}#${card.number}`;

export function unblockPrompt(card: { repo: string; number: number; lane: string }): string {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(card.repo) ||
    !Number.isInteger(card.number) ||
    card.number < 1 ||
    !/^[a-z-]+$/.test(card.lane)
  )
    throw new Error(`not a card: ${card.repo}#${card.number} (${card.lane})`);
  const ref = `${card.repo}#${card.number}`;
  return [
    `Unblock ${ref}. It is a P0 card in ${card.lane}, waiting on James.`,
    "",
    `1. Read the card and why it waits: \`gh issue view ${card.number} -R ${card.repo} --comments\`. Load the product-stage skill and read the repo's CONTEXT.md.`,
    "2. Verify the blocker yourself, against the code, the logs or the live system. A blocker an agent can clear is not James's.",
    "3. Do every part an agent can. A fix in code starts with a failing test, run to see it fail; ship it through the shipit skill.",
    "4. Bring only what needs James: one decision or one step, in a few lines. Change nothing he must decide before he says so.",
    "5. When the card can move: post what was done on the card, and move it with `~/.local/bin/status`.",
  ].join("\n");
}

export const JOB_OPTION = "@collector_fix";
export const STEP_OPTION = "@collector_step";
export const SINCE_OPTION = "@collector_step_at";
export const STALL_S = 20 * 60;
const SEP = "|";

export const FIX_STEPS = [
  "finding the cause",
  "writing the failing test",
  "fixing",
  "shipping",
  "rerunning the job",
  "done: the job ran ok",
  "stuck",
] as const;

export type StepKind = "working" | "done" | "stuck" | "stalled";

export function stepState(step: string, since?: number, now?: number): { kind: StepKind; label: string } {
  if (step === "stuck") return { kind: "stuck", label: "Stuck: needs you" };
  if (step.startsWith("done")) return { kind: "done", label: "Done" };
  const age = since ? (now ?? Date.now() / 1000) - since : 0;
  if (age > STALL_S) return { kind: "stalled", label: `${step} (no change for ${Math.round(age / 60)} m)` };
  return { kind: "working", label: step };
}

export function debugPrompt(m: DebugMachine, j: DebugJob): string {
  const step = (name: (typeof FIX_STEPS)[number]) => `\`tmux set -p -t "$TMUX_PANE" ${STEP_OPTION} "${name}"\``;
  const on = (cmd: string) => (m.local || !m.ssh ? `\`${cmd}\`` : `\`ssh ${m.ssh} ${cmd}\``);
  return [
    `Debug and fix: the cron job "${j.name}" (Hermes job ${j.id}) failed on ${m.machine}.`,
    "",
    `- Last run: ${j.last_run_at ?? "unknown"}, status ${j.last_status ?? "unknown"}`,
    `- Error: ${j.last_error || "none recorded"}`,
    j.script_path ? `- Script: ${j.script_path} on ${m.machine}` : "- Script: none (an agent job)",
    j.profile ? `- Hermes profile: ${j.profile}` : "",
    `- The job and its runs: ${on(`hermes cron runs ${j.id}`)}; its logs are under ~/.hermes/logs on ${m.machine}.`,
    "",
    "James's Debug and fix button shows the step you are on. Run each step's command, word for word, as the first",
    "thing in that step. Use no other words.",
    "",
    "Do this, in order:",
    `1. ${step("finding the cause")} Find the cause. Read the run's output and the logs. Find the repo that holds the job's source.`,
    `2. ${step("writing the failing test")} Write a failing test that reproduces the failure (TDD). Run it and see it fail for that reason.`,
    `3. ${step("fixing")} Fix the code until that test passes. Then run the tests around it.`,
    `4. ${step("shipping")} Ship the fix with the shipit skill, in a worktree. Deploy it to the machine if the repo does not.`,
    `5. ${step("rerunning the job")} Run the job again: ${on(`hermes cron run ${j.id}`)}. It starts on the scheduler's next tick, so wait about a minute, then check its new run with ${on(`hermes cron runs ${j.id}`)}.`,
    `6. ${step("done: the job ran ok")} Report the proof: the test that failed before the fix and passes after, and the job's new run ending ok.`,
    "",
    `If you cannot go on (the fix needs James: a key, a login, a decision), run ${step("stuck")} and tell him why.`,
    "",
    "A cause you cannot prove with a test is a guess: say so.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export const FIX_MODEL = { provider: "claude-code", model: "claude-opus-5-5" } as const;

export function tmuxArgs(cwd: string, prompt: string): string[] {
  const pi = `PATH="$HOME/.local/bin:$PATH"; exec pi --provider ${FIX_MODEL.provider} --model ${FIX_MODEL.model} "$0"`;
  return ["split-window", "-h", "-c", cwd, "-P", "-F", "#{pane_id}", "/bin/zsh", "-lc", pi, prompt];
}

export const openDebugSession = (m: DebugMachine, j: DebugJob, run = runText) =>
  openFixPane(fixKey(m.machine, j.id), debugPrompt(m, j), `${j.name} · ${m.machine}`, run);

export const NAME_OPTION = "@collector_name";
export const BORDER_FORMAT = ` #{${NAME_OPTION}}: #{${STEP_OPTION}} `;

export async function openFixPane(
  key: string,
  prompt: string,
  name: string,
  run = runText,
): Promise<{ ok: true; pane: string } | { ok: false; why: string }> {
  const r = await run(["tmux", ...tmuxArgs(homedir(), prompt)], { timeout: 10 });
  if (r.error) {
    const none = /no server running|error connecting|no current client|no clients/i.test(r.error);
    return { ok: false, why: none ? "No tmux session is open on this machine: open one, then click again." : r.error };
  }
  const pane = r.stdout.trim();
  if (pane) {
    await run(["tmux", "set", "-p", "-t", pane, JOB_OPTION, key], { timeout: 5 });
    await run(["tmux", "set", "-p", "-t", pane, STEP_OPTION, "starting"], { timeout: 5 });
    await run(["tmux", "set", "-p", "-t", pane, NAME_OPTION, name], { timeout: 5 });
    await run(["tmux", "set", "-p", "-t", pane, "pane-border-format", BORDER_FORMAT], { timeout: 5 });
    await run(["tmux", "set", "-w", "-t", pane, "pane-border-format", ""], { timeout: 5 });
    await run(["tmux", "set", "-w", "-t", pane, "pane-border-status", "top"], { timeout: 5 });
  }
  return { ok: true, pane };
}

export const fixKey = (machine: string, id: string) => `${machine}/${id}`;

export async function closeFixPane(key: string, run = runText): Promise<{ ok: true } | { ok: false; why: string }> {
  const open = await openFixes(run);
  const fix = open[key];
  if (!fix) return { ok: false, why: "that session is not open any more" };
  const r = await run(["tmux", "kill-pane", "-t", fix.pane], { timeout: 5 });
  return r.error ? { ok: false, why: r.error } : { ok: true };
}

export interface OpenFix {
  pane: string;
  step: string;
  state: StepKind;
  since?: number;
  card?: { repo: string; number: number };
}

export async function openFixes(run = runText, now?: number): Promise<Record<string, OpenFix>> {
  const r = await run(
    [
      "tmux",
      "list-panes",
      "-a",
      "-F",
      `#{pane_id}${SEP}#{${JOB_OPTION}}${SEP}#{${STEP_OPTION}}${SEP}#{${NAME_OPTION}}${SEP}#{${SINCE_OPTION}}`,
    ],
    { timeout: 5 },
  );
  const at = now ?? Date.now() / 1000;
  const fixes = parseFixes(r.error ? "" : r.stdout, at);
  for (const fix of Object.values(fixes))
    if (!fix.since) {
      await run(["tmux", "set", "-p", "-t", fix.pane, SINCE_OPTION, stamp(fix.step, at)], { timeout: 5 });
      fix.since = Math.round(at);
    }
  return fixes;
}

function triageCard(name: string | undefined): { repo: string; number: number } | null {
  const m = (name ?? "").match(/^triage ([\w.-]+\/[\w.-]+)#(\d+)$/);
  return m ? { repo: m[1], number: Number(m[2]) } : null;
}

export function stamp(step: string, at: number): string {
  return `${Math.round(at)} ${step}`;
}

export function readStamp(value: string, step: string): number | undefined {
  const [at, ...rest] = (value || "").split(" ");
  const seconds = Number(at);
  return seconds && rest.join(" ") === step ? seconds : undefined;
}

export function parseFixes(out: string, now?: number): Record<string, OpenFix> {
  const fixes: Record<string, OpenFix> = {};
  for (const line of out.split("\n")) {
    const [pane, key, step, name, setAt] = line.split(SEP);
    if (!pane || !key) continue;
    const since = readStamp(setAt, (FIX_STEPS as readonly string[]).includes(step) ? step : "working");
    const at = (s: string) => ({ step: s, state: stepState(s, since, now).kind, ...(since ? { since } : {}) });
    if (key === TRIAGE_KEY) {
      const card = triageCard(name);
      fixes[key] = { pane, ...at("triaging"), ...(card ? { card } : {}) };
    } else fixes[key] = { pane, ...at((FIX_STEPS as readonly string[]).includes(step) ? step : "working") };
  }
  return fixes;
}
