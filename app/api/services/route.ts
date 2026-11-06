import { guard } from "@/lib/server/guard";
import { json } from "@/lib/server/respond";
import { checkServices } from "@/lib/server/services";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) => guard(req) ?? json(await checkServices());
