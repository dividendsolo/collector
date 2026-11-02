import fs from "node:fs";
import { runText } from "./run";

/** The Tailscale CLI on this machine: on PATH, or inside the Mac app. A launchd job's PATH often lacks /usr/local/bin. */
export const TAILSCALE_BINS = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

export function tailscaleBin(exists: (p: string) => boolean = fs.existsSync): string | null {
  return TAILSCALE_BINS.find((p) => exists(p)) ?? null;
}

/** The tailnet's state ("Running", "Stopped", ...), or null when it could not be read. */
export async function tailnetState(bin: string): Promise<string | null> {
  const r = await runText([bin, "status", "--json"], { timeout: 5 });
  try {
    return JSON.parse(r.stdout).BackendState ?? null;
  } catch {
    return null;
  }
}

/** The Start Tailscale button: open the Mac app if it is closed, then `tailscale up`. Answers with the state after. */
export async function startTailscale(): Promise<{ ok: boolean; state: string | null; why?: string }> {
  const bin = tailscaleBin();
  if (!bin) return { ok: false, state: null, why: "no Tailscale on this machine" };
  if (process.platform === "darwin") await runText(["/usr/bin/open", "-g", "-a", "Tailscale"], { timeout: 10 });
  const up = await runText([bin, "up"], { timeout: 20 });
  const state = await tailnetState(bin);
  if (state === "Running") return { ok: true, state };
  return { ok: false, state, why: up.error || `Tailscale is ${state ?? "unreadable"} after tailscale up` };
}
