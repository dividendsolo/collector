import { json } from "@/lib/server/respond";
import { vendors } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";
export const GET = async () => json(await vendors());
