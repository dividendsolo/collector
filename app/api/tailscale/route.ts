import { guard } from "@/lib/server/guard";
import { snapshot } from "@/lib/server/machines";
import { json } from "@/lib/server/respond";
import { restartSshJobs, startTailscale } from "@/lib/server/tailscale";

export const dynamic = "force-dynamic";

/** Needs attention's Start Tailscale button: starts the tailnet on the machine Collector runs on (James, 2026-11-02:
 * a stopped tailnet broke signal-tunnel's ssh, and the row said only "exit 255"). Answers ok only once Tailscale
 * reads Running; the page then hides the rows. The ssh jobs that failed on it start again at once (not after
 * launchd's throttle), and the machines are read again now, so the page's next read has them fixed. */
export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const r = await startTailscale();
  if (!r.ok) return json(r, 500);
  const local = snapshot.peek()?.machines.find((m: any) => m.local);
  await restartSshJobs(local?.jobs || []);
  snapshot.get({ force: true }).catch(() => {}); // read the machines again now, not at the next 10-second mark
  return json(r);
}
