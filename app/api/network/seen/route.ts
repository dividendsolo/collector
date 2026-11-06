import { json } from "@/lib/server/respond";
import { clearMark } from "@/lib/server/seen";

export const dynamic = "force-dynamic";

/** The one write the Network check adds (collector#66): Seen drops one mark from a machine's seen-list, so it leaves
 * Needs attention and does not come back — the fact behind it stays in the list, which is what keeps it from being
 * reported again.
 *
 * The click carries the mark's own id, so it lives in the query (`?machine=ezio&id=process%3Acurl`), which is what
 * a Needs attention row can post with no body; a JSON body with `machine` and `id` is answered the same way, for a
 * shell or an agent. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let machine = url.searchParams.get("machine");
  let id = url.searchParams.get("id");
  if ((!machine || !id) && req.headers.get("content-type") === "application/json") {
    const body = await req.json().catch(() => ({}) as any);
    machine = machine || (typeof body?.machine === "string" ? body.machine : null);
    id = id || (typeof body?.id === "string" ? body.id : null);
  }
  if (!machine || !id) return json({ why: "machine and id are required" }, 400);
  const { cleared, marks } = clearMark(machine, id);
  return json({ machine, id, cleared, marks });
}
