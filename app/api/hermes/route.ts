import { guard } from "@/lib/server/guard";
import { startGateway } from "@/lib/server/hermes";
import { snapshot } from "@/lib/server/machines";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const r = await startGateway();
  if (!r.ok) return json(r, 500);
  snapshot.get({ force: true }).catch(() => {});
  return json(r);
}
