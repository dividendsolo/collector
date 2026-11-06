import { network } from "@/lib/server/network";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async () => json(await network());
