import { json } from "@/lib/server/respond";
import { workStats } from "@/lib/server/workstats";

export const dynamic = "force-dynamic";
export const GET = async () => json(await workStats());
