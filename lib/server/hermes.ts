import { runText } from "./run";

/** This machine's Hermes gateway, the job the waiting crew runs on: `hermes gateway run` under launchd's
 * `ai.hermes.gateway` label (agent-stack#261). */
export const GATEWAY_LABEL = "ai.hermes.gateway";

/** How long the Hermes cron ticker may sit still before its crew counts as stopped: `collect.py` writes this on the
 * machine's own read and the page reads it back, so the two agree on one number. */
export const TICKER_STALE_S = 600;

/** The Start Hermes click, as one command: `launchctl kickstart -k` starts or restarts the job now, where launchd's
 * own throttle would wait out its interval first — the same reason the Start Tailscale button starts its failed ssh
 * jobs itself. The user's own launchd domain, so a click from the page acts on the machine Collector runs on. */
export const kickstartArgs = (uid = process.getuid?.() ?? 0) => [
  "/bin/launchctl",
  "kickstart",
  "-k",
  `gui/${uid}/${GATEWAY_LABEL}`,
];

/** The PID in `launchctl list <label>`'s own output: one `"PID" = 1064;` line among the job's dictionary. "" when
 * launchd knows the label but nothing runs (the dictionary has no PID line); null when launchd does not know it at
 * all (exit 113, `Could not find service`). */
export function parsePid(out: string, code: number): string | null {
  if (code !== 0) return null;
  return out.match(/"PID"\s*=\s*(\d+)\s*;/)?.[1] ?? "";
}

/** The same read, from a finished `launchctl list`: a PID, "" or null as `parsePid` says. A read that failed —
 * launchd has no such label, or did not answer in time — is null either way. */
export const pidFromRun = (r: { ok: boolean; stdout: string; error: string | null }) =>
  parsePid(r.stdout, r.ok ? 0 : 1);

/** Whether the gateway runs here now: its PID, "" when the job is loaded but stopped, null when launchd does not
 * know the label. */
export async function gatewayPid(): Promise<string | null> {
  return pidFromRun(await runText(["/bin/launchctl", "list", GATEWAY_LABEL], { timeout: 5 }));
}

export interface GatewayStart {
  ok: boolean;
  state: string | null;
  pid?: string;
  why?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A PID once launchd reports one, or as soon as the read answers without one: a kickstart starts a process a
 * moment after it returns. */
async function waitPid(read: () => Promise<string | null>, waitMs: number): Promise<string | null> {
  const until = Date.now() + waitMs;
  let pid = await read();
  while (!pid && Date.now() < until) {
    await sleep(250);
    pid = await read();
  }
  return pid;
}

/** The Start Hermes button: kickstart the gateway's launchd job, then answer with the state after — ok only once
 * launchd reports a PID, since that is what the page's row hides on. */
export async function startGateway({
  uid = process.getuid?.() ?? 0,
  run = runText,
  read = gatewayPid,
  waitMs = 5000,
}: {
  uid?: number;
  run?: typeof runText;
  read?: () => Promise<string | null>;
  waitMs?: number;
} = {}): Promise<GatewayStart> {
  const kick = await run(kickstartArgs(uid), { timeout: 20 });
  const pid = await waitPid(read, waitMs);
  if (pid) return { ok: true, state: "running", pid };
  const tail = kick.error ? ` (${kick.error})` : "";
  if (pid === null)
    return { ok: false, state: null, why: `launchd has no ${GATEWAY_LABEL} job on this machine${tail}` };
  return { ok: false, state: "stopped", why: kick.error || `${GATEWAY_LABEL} is not running after the kickstart` };
}
