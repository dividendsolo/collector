import type { z } from "zod";
import { guard } from "@/lib/server/guard";
import {
  addProposal,
  addSchema,
  deleteProposal,
  editProposal,
  editSchema,
  ProposalsFileError,
  proposalsRead,
  proposalsView,
} from "@/lib/server/proposals";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

const issue = (e: z.ZodError) => {
  const [first] = e.issues;
  return first ? `${first.path.join(".") || "proposal"}: ${first.message}` : "bad request";
};

async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function refused<T>(work: () => T): T | Response {
  try {
    return work();
  } catch (e) {
    if (e instanceof ProposalsFileError) return json({ why: e.message }, 409);
    throw e;
  }
}

export const GET = async (req: Request) => guard(req) ?? json(proposalsRead());

export async function POST(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const parsed = addSchema.safeParse(await body(req));
  if (!parsed.success) return json({ why: issue(parsed.error) }, 400);
  const next = refused(() => addProposal(parsed.data));
  return next instanceof Response ? next : json(proposalsView(next));
}

export async function PUT(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const parsed = editSchema.safeParse(await body(req));
  if (!parsed.success) return json({ why: issue(parsed.error) }, 400);
  const { id, ...input } = parsed.data;
  const next = refused(() => editProposal(id, input));
  if (next instanceof Response) return next;
  return next ? json(proposalsView(next)) : json({ why: `no proposal with the id ${id}` }, 404);
}

export async function DELETE(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const id = new URL(req.url).searchParams.get("id") || "";
  const next = refused(() => deleteProposal(id));
  if (next instanceof Response) return next;
  return next ? json(proposalsView(next)) : json({ why: `no proposal with the id ${id}` }, 404);
}
