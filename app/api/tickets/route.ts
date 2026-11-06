import { ready, ticketsView } from "@/lib/server/board";
import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  await ready();
  return json(ticketsView());
}
