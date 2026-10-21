import { config } from "@/lib/server/config";
import { allRepos } from "@/lib/server/projects";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async () => json({ repos: await allRepos.get(), chosen: config().projects || [] });
