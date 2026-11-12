import { homedir } from "node:os";
import { runText } from "./run";

/**
 * A failed cron row's "Debug and fix" button (James, 2026-11-11): a new pi session in a new tmux pane, split beside the
 * one James is looking at, so it never touches a session already at work. Its first message asks for the TDD flow (a failing test first), a ship, a rerun
 * of the job, and the proof (the test, and the job's next run ok). The row then leaves Priority tasks on its own:
 * a run that ends ok is no failed run.
 */

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
  /** The ssh target for a machine Collector reads over ssh; null for this one. */
  ssh: string | null;
  local: boolean;
}

/** The Debug and fix id of the work script's loop row ("Foreman on ezio started 5 times in 60 s"): one per machine. */
export const WORK_LOOP = "work-loop";

/** The refusal when the loop row is gone by the time James clicks (2026-11-11). */
export const LOOP_GONE = "Foreman isn't looping any more (it ran once a minute since). Nothing to fix.";

/** The pane key of a Triage session: one at a time. */
export const TRIAGE_KEY = "triage";

/** The first message for the work script's loop (James, 2026-11-11): the same flow as a failed job, with no job to
 * rerun; the proof is the test and the script starting once per its schedule again. */
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

/** The first message of a Triage session (James, 2026-11-11): one card in needs-triage, triaged with James the way
 * he triages in a session. The repo and number go into a shell command in the prompt, so only a card's own shape is
 * accepted. */
export function triagePrompt(card: { repo: string; number: number }): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(card.repo) || !Number.isInteger(card.number) || card.number < 1)
    throw new Error(`not a card: ${card.repo}#${card.number}`);
  const ref = `${card.repo}#${card.number}`;
  return [
    `Triage ${ref} with James. It is the one card in needs-triage on the board.`,
    "",
    `1. Load the product-stage skill, and read the repo's CONTEXT.md \`## Stage\`. Then read the card: \`gh issue view ${card.number} -R ${card.repo} --comments\`.`,
    "2. Check every claim in the card against the code, the logs or the live system yourself before you propose anything.",
    "3. Propose the triage in a few lines: the type (bug, enhancement, tech-debt, security), the priority (P0, P1, P2), the status (ready-for-agent, ready-for-human, needs-info, or close), what is in scope, and why.",
    "4. Wait for James's answer. Change nothing on the card before he says so.",
    "5. When he agrees: set the labels and the priority, post the triage comment, and move the card with `~/.local/bin/status`.",
    "6. Then run the after-triage-sweep skill on the same repo.",
  ].join("\n");
}

/** The pane key of a failing main's Debug and fix session: one per repo and machine. */
export const mainKey = (fix: { machine: string; repo: string }) => `main/${fix.machine}/${fix.repo}`;

/** The first message of a failing main's Debug and fix session (James, 2026-11-11: "There's no way to fix it. There's
 * no info on it."): the foreman tests a repo's main on a machine before it builds a card there, and main failed. The
 * repo goes into shell commands in the prompt, so only a repo name's own shape is accepted. */
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

/** The pane key of an Unblock session: one per card. */
export const unblockKey = (card: { repo: string; number: number }) => `unblock/${card.repo}#${card.number}`;

/** The first message of an Unblock session (James, 2026-11-11): a P0 card waiting on James. The session checks why it
 * waits, does every part an agent can, and brings James only what needs him. The repo, number and status go into
 * the prompt's commands, so only a card's own shape is accepted. */
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

/** The tmux pane options of a Debug and fix pane: the job it fixes (machine/id), and the step it is on, which the
 * session writes itself (James, 2026-11-11: the button "should show ... what it's currently doing"). */
export const JOB_OPTION = "@collector_fix";
export const STEP_OPTION = "@collector_step";
/** The field separator of the pane read. Not a tab: under launchd (no locale) tmux prints a tab in -F as "_". */
const SEP = "|";

/** The steps the button can say, in order: a fixed list (James, 2026-11-11: "just make it a static list"). The session
 * sets each one with its exact command; a word not on the list reads as "working". */
export const FIX_STEPS = [
  "finding the cause",
  "writing the failing test",
  "fixing",
  "shipping",
  "rerunning the job",
  "done: the job ran ok",
  "stuck",
] as const;

/** The first message of the new session. */
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

/** `tmux split-window` beside the pane James is looking at (James, 2026-11-11: "I would actually prefer if it split
 * my current terminal"): with no target, tmux splits the active pane of the client used last. -h splits it left and
 * right; the new pane takes the focus, so the fix is in view at once. -P -F prints the new pane's id. */
/** Every Debug and fix session runs on Claude Opus 5.5 (James, 2026-11-11: "just statically assign it to Claude
 * every time because we want to use Opus 5.5 on these"). No fallback to another plan. */
export const FIX_MODEL = { provider: "claude-code", model: "claude-opus-5-5" } as const;

/** `tmux split-window` beside the pane James is looking at (James, 2026-11-11: "I would actually prefer if it split
 * my current terminal"): with no target, tmux splits the active pane of the client used last. -h splits it left and
 * right; the new pane takes the focus, so the fix is in view at once. -P -F prints the new pane's id.
 *
 * The command is a login shell, so pi gets James's own PATH: Collector's is /usr/bin:/bin, where pi cannot reach
 * Claude Code and picks the first model with a key (MiniMax, out of plan, 2026-11-11). It names the model, so pi
 * never picks one by itself. The prompt goes in as $0, never into the shell's text. */
export function tmuxArgs(cwd: string, prompt: string): string[] {
  // Collector runs under launchd with a bare PATH, and a login zsh does not read ~/.zshrc, where ~/.local/bin is
  // added: pi was "command not found" and the pane closed at once (James, 2026-11-11: "my debug and fix button isn't
  // doing anything"). ~/.local/bin is where pi's installer links pi.
  const pi = `PATH="$HOME/.local/bin:$PATH"; exec pi --provider ${FIX_MODEL.provider} --model ${FIX_MODEL.model} "$0"`;
  return ["split-window", "-h", "-c", cwd, "-P", "-F", "#{pane_id}", "/bin/zsh", "-lc", pi, prompt];
}

/** Open the session for a failed job. Fails, with the reason, when no tmux session is open on this machine. */
export const openDebugSession = (m: DebugMachine, j: DebugJob, run = runText) =>
  openFixPane(fixKey(m.machine, j.id), debugPrompt(m, j), `${j.name} · ${m.machine}`, run);

/** The fix pane's top border: its name and the step its session wrote (James, 2026-11-12: "name the window ... so
 * it's very easy to see which one it's actually working on"). A pane option, so James's own panes keep theirs. */
export const NAME_OPTION = "@collector_name";
export const BORDER_FORMAT = ` #{${NAME_OPTION}}: #{${STEP_OPTION}} `;

/** Split James's pane, start pi on the prompt, and tag the pane with its key, its name and first step. */
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
    // The border line is a window setting. The window's format is blank, so James's own panes there show an empty
    // line, and only a fix pane, with its own format, shows a name.
    await run(["tmux", "set", "-w", "-t", pane, "pane-border-format", ""], { timeout: 5 });
    await run(["tmux", "set", "-w", "-t", pane, "pane-border-status", "top"], { timeout: 5 });
  }
  return { ok: true, pane };
}

export const fixKey = (machine: string, id: string) => `${machine}/${id}`;

/** The Debug and fix panes open now, by job (machine/id): each one's step. A pane closed is gone from tmux, so the
 * button comes back by itself. No tmux running reads as none open. */
export async function openFixes(run = runText): Promise<Record<string, { pane: string; step: string }>> {
  const r = await run(["tmux", "list-panes", "-a", "-F", `#{pane_id}${SEP}#{${JOB_OPTION}}${SEP}#{${STEP_OPTION}}`], {
    timeout: 5,
  });
  return parseFixes(r.error ? "" : r.stdout);
}

export function parseFixes(out: string): Record<string, { pane: string; step: string }> {
  const fixes: Record<string, { pane: string; step: string }> = {};
  for (const line of out.split("\n")) {
    const [pane, key, step] = line.split(SEP);
    if (!pane || !key) continue;
    // A Triage session writes no steps: it is a talk with James, so its button says so.
    if (key === TRIAGE_KEY) fixes[key] = { pane, step: "triaging" };
    else fixes[key] = { pane, step: (FIX_STEPS as readonly string[]).includes(step) ? step : "working" };
  }
  return fixes;
}
