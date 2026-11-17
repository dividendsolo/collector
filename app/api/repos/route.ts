import { config, projectRepos } from "@/lib/server/config";
import { guard } from "@/lib/server/guard";
import { allRepos } from "@/lib/server/projects";
import { json } from "@/lib/server/respond";

export const dynamic = "force-dynamic";
export const GET = async (req: Request) =>
  guard(req) ??
  json({
    repos: await allRepos.get({ force: new URL(req.url).searchParams.has("fresh"), wait: true }),
    chosen: projectRepos(config()),
  });
