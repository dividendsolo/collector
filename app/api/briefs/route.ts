import { isBriefFile, keyOf } from "@/lib/briefs";
import { BriefsFileError, briefsView, setBriefState } from "@/lib/server/briefs";
import { guard, refusePhone } from "@/lib/server/guard";
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

export const GET = async (req: Request) => guard(req) ?? json(await briefsView());

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const input = await body(req);
  const machine = typeof input.machine === "string" ? input.machine : "";
  const file = input.file;
  if (!machine || !isBriefFile(file)) return json({ why: "a brief is a machine and one .md file name" }, 400);
  const change = {
    ...(typeof input.read === "boolean" ? { read: input.read } : {}),
    ...(typeof input.archived === "boolean" ? { archived: input.archived } : {}),
  };
  if (!("read" in change) && !("archived" in change)) return json({ why: "a write sets read or archived" }, 400);
  const archiving = "archived" in change ? refusePhone(req) : null;
  if (archiving) return archiving;
  try {
    setBriefState(keyOf({ machine, file }), change);
  } catch (e) {
    if (e instanceof BriefsFileError) return json({ why: e.message }, 409);
    throw e;
  }
  return json(await briefsView());
}
