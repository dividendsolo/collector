import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";
import { workStats } from "@/lib/server/workstats";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await workStats());
