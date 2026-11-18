import { guard } from "@/lib/server/guard";
import { snapshot } from "@/lib/server/machines";
import { json } from "@/lib/server/respond";
import { restartSshJobs, startTailscale } from "@/lib/server/tailscale";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const r = await startTailscale();
  if (!r.ok) return json(r, 500);
  const local = snapshot.peek()?.machines.find((m: any) => m.local);
  await restartSshJobs(local?.jobs || []);
  snapshot.get({ force: true }).catch(() => {});
  return json(r);
}
