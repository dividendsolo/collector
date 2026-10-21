import { json } from "@/lib/server/respond";
import { checkServices } from "@/lib/server/services";

export const dynamic = "force-dynamic";
export const GET = async () => json(await checkServices());
