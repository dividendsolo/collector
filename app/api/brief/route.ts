import { isBriefFile } from "@/lib/briefs";
import { briefBody } from "@/lib/server/briefs";
import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/**
 * One brief, read whole (collector#64): its front matter, its Markdown, and whether it is read or archived on this
 * machine. The file is read on the machine that keeps it, over the same ssh Collector's snapshot uses, because the
 * folder only ever grows and the list must not carry every brief's body on every 10-second read.
 */
export async function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const q = new URL(req.url).searchParams;
  const machine = q.get("machine") || "";
  const file = q.get("file") || "";
  if (!machine || !isBriefFile(file)) return json({ why: "a brief is a machine and one .md file name" }, 400);
  const { brief, why } = await briefBody(machine, file);
  return brief ? json({ brief }) : json({ why }, 404);
}
