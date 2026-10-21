import { boardStats } from "@/lib/server/board";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
/** How the board poll is doing: reads, GraphQL points (in all and in the last hour), and the last read's time. */
export const GET = () => json(boardStats());
