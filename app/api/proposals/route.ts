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

/**
 * The Proposals page's read and its one write route (collector#77). Every field is parsed by the schema in
 * `lib/server/proposals.ts`, so nothing the page did not mean to send is ever stored, and every handler answers the
 * list and the open pipeline as they stand after the change, which is what the page renders.
 */

/** The first thing the schema did not like, said plainly enough for the form to show it. */
const issue = (e: z.ZodError) => {
  const [first] = e.issues;
  return first ? `${first.path.join(".") || "proposal"}: ${first.message}` : "bad request";
};

/** A body that is not JSON (a form post, an empty one) reads as nothing: the schema then refuses it. */
async function body(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** A file the route will not write over: the page shows why, and the file stays as it is (PR #79 review). */
function refused<T>(work: () => T): T | Response {
  try {
    return work();
  } catch (e) {
    if (e instanceof ProposalsFileError) return json({ why: e.message }, 409);
    throw e;
  }
}

/** The read answers the rows it can show, and why the file will not take a write, so the page never looks falsely empty. */
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
