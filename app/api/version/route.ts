import { servedSide } from "@/lib/update";

export const dynamic = "force-dynamic";
/**
 * The build this server process runs, read once at boot (`instrumentation.ts`). The page reloads itself when this
 * moves, which after the Update click (card #41) is when the new build is in service — not the moment the swap lands
 * on disk under the running process.
 */
export function GET() {
  return new Response(servedSide().id ?? "dev", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}
