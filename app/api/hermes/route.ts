import { startGateway } from "@/lib/server/hermes";
import { snapshot } from "@/lib/server/machines";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/** Needs attention's Start Hermes button: starts this machine's Hermes gateway, the job the waiting crew runs on
 * (agent-stack#261: if the gateway stops, the crew stops silently, and the row is the only place that says so).
 * Answers ok only once launchd reports the job's PID; the page then hides the rows it fixed. The machines are read
 * again now, so the page's next read has the gateway and its ticker fresh rather than at the next 10-second mark. */
export async function POST() {
  const r = await startGateway();
  if (!r.ok) return json(r, 500);
  snapshot.get({ force: true }).catch(() => {});
  return json(r);
}
