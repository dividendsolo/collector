import { guard } from "@/lib/server/guard";
import { servedSide } from "@/lib/update";

export const dynamic = "force-dynamic";
export function GET(req: Request) {
  const refusal = guard(req);
  if (refusal) return refusal;
  return new Response(servedSide().id ?? "dev", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}
