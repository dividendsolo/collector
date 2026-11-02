import { json } from "@/lib/server/respond";
import { startTailscale } from "@/lib/server/tailscale";

export const dynamic = "force-dynamic";

/** Needs attention's Start Tailscale button: starts the tailnet on the machine Collector runs on (James, 2026-11-02:
 * a stopped tailnet broke signal-tunnel's ssh, and the row said only "exit 255"). */
export async function POST() {
  const r = await startTailscale();
  return json(r, r.ok ? 200 : 500);
}
