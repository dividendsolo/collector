import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";
import { vendors } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await vendors());
