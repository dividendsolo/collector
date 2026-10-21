import { ready, ticketsView } from "@/lib/server/board";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export async function GET() {
  await ready();
  return json(ticketsView());
}
