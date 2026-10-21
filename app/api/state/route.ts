import { json } from "@/lib/server/respond";
import { state } from "@/lib/server/state";

export const dynamic = "force-dynamic";
export const GET = async () => json(await state());
