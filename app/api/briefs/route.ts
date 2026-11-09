import { isBriefFile, keyOf } from "@/lib/briefs";
import { BriefsFileError, briefsView, setBriefState } from "@/lib/server/briefs";
import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/**
 * The Briefs page's read and its one write (collector#64). `GET` is the Inbox and the Archived section, worked out on
 * the server from the machine snapshot the rest of the page already reads — no extra ssh. `POST` is the page's two
 * clicks: opening a brief makes it Read, and the Archive button files it, both in `briefs.json` beside `config.json`.
 *
 * The brief's own Markdown is not here: `app/api/brief/route.ts` reads that one file.
 */

/** A body that is not JSON (a form post, an empty one) reads as nothing, which is refused below. */
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
  // Only the two clicks there are: opening a brief reads it, and archiving it files it.
  const change = {
    ...(typeof input.read === "boolean" ? { read: input.read } : {}),
    ...(typeof input.archived === "boolean" ? { archived: input.archived } : {}),
  };
  if (!("read" in change) && !("archived" in change)) return json({ why: "a write sets read or archived" }, 400);
  try {
    setBriefState(keyOf({ machine, file }), change);
  } catch (e) {
    if (e instanceof BriefsFileError) return json({ why: e.message }, 409);
    throw e;
  }
  return json(await briefsView());
}
