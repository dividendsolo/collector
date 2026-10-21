import { config } from "@/lib/server/config";
import { allRepos } from "@/lib/server/projects";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
// ?fresh=1 (the picker opening) reads GitHub again, so a renamed or deleted repo never shows its old name.
export const GET = async (req: Request) =>
  json({
    repos: await allRepos.get({ force: new URL(req.url).searchParams.has("fresh"), wait: true }),
    chosen: config().projects || [],
  });
