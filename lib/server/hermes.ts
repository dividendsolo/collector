import { runText } from "./run";

export const GATEWAY_LABEL = "ai.hermes.gateway";

export const TICKER_STALE_S = 600;

export const kickstartArgs = (uid = process.getuid?.() ?? 0) => [
  "/bin/launchctl",
  "kickstart",
  "-k",
  `gui/${uid}/${GATEWAY_LABEL}`,
];

export function parsePid(out: string, code: number): string | null {
  if (code !== 0) return null;
  return out.match(/"PID"\s*=\s*(\d+)\s*;/)?.[1] ?? "";
}

export const pidFromRun = (r: { ok: boolean; stdout: string; error: string | null }) =>
  parsePid(r.stdout, r.ok ? 0 : 1);

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

async function waitPid(read: () => Promise<string | null>, waitMs: number): Promise<string | null> {
  const until = Date.now() + waitMs;
  let pid = await read();
  while (!pid && Date.now() < until) {
    await sleep(250);
    pid = await read();
  }
  return pid;
}

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
