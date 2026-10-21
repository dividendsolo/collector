import { card } from "@/lib/server/card";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const repo = q.get("repo") || "";
  const n = q.get("n") || "";
  if (!/^[\w.-]+$/.test(repo) || !/^\d+$/.test(n)) return new Response("Bad request", { status: 400 });
  return json(await card(repo, Number(n)));
}
