import { isInboxId, keyOf } from "@/lib/inbox";
import { guard } from "@/lib/server/guard";
import { InboxFileError, inboxView, setInboxHandled } from "@/lib/server/inbox";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const raw = await req.json();
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const GET = async (req: Request) => guard(req) ?? json(await inboxView());

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const input = await body(req);
  const machine = typeof input.machine === "string" ? input.machine : "";
  const id = input.id;
  if (!machine || !isInboxId(id)) return json({ why: "a row is a machine and one message id" }, 400);
  if (typeof input.handled !== "boolean") return json({ why: "a write sets handled" }, 400);
  try {
    await setInboxHandled(keyOf({ machine, id }), input.handled);
  } catch (e) {
    if (e instanceof InboxFileError) return json({ why: e.message }, 409);
    throw e;
  }
  return json(await inboxView());
}
