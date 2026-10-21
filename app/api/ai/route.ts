import { ai } from "@/lib/server/ai";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async () => json(await ai.get());
