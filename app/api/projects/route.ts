import { ConfigFileError } from "@/lib/server/config";
import { guard, refusePhone } from "@/lib/server/guard";
import { projects, saveProjects } from "@/lib/server/projects";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await projects());

export async function POST(req: Request) {
  const refusal = guard(req) ?? refusePhone(req);
  if (refusal) return refusal;
  if (req.headers.get("content-type") !== "application/json") return new Response("Not found", { status: 404 });
  let repos: unknown;
  try {
    repos = (await req.json()).repos;
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  if (!Array.isArray(repos)) return new Response("Bad request", { status: 400 });
  try {
    saveProjects(repos);
  } catch (e) {
    if (e instanceof ConfigFileError) return json({ why: e.message }, 409);
    throw e;
  }
  return json(await projects(true));
}
