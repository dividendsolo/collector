import { domains } from "@/lib/server/domains";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async () => json(await domains());
