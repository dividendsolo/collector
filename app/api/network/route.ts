import { guard } from "@/lib/server/guard";
import { network } from "@/lib/server/network";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await network());
