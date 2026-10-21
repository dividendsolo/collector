import fs from "node:fs";
import path from "node:path";
import { ROOT } from "@/lib/server/paths";

export const dynamic = "force-dynamic";
/** The build the server runs. The page reloads itself when this moves (after `bun run build` and a restart). */
export function GET() {
  let id = "dev";
  try {
    id = fs.readFileSync(path.join(ROOT, ".next", "BUILD_ID"), "utf8").trim();
  } catch {}
  return new Response(id, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
