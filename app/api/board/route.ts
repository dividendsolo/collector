import { boardStats } from "@/lib/server/board";
import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => guard(req) ?? json(boardStats());
