import { guard } from "@/lib/server/guard";
import { journey } from "@/lib/server/journey";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  const q = new URL(req.url).searchParams;
  const repo = q.get("repo") || "";
  const n = q.get("n") || "";
  if (!/^[\w.-]+$/.test(repo) || !/^\d+$/.test(n)) return new Response("Bad request", { status: 400 });
  return json(await journey(repo, Number(n)));
}
