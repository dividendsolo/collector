import { domains } from "@/lib/server/domains";
import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await domains());
