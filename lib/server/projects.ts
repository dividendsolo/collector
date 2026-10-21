import { billing } from "./billing";
import { swr } from "./cache";
import { accountsOf, config, writeConfig } from "./config";
import { datafast } from "./datafast";
import { envFile } from "./env";
import { ENV_PATH } from "./paths";
import { run } from "./run";
import { gemsOf, near, type StackGroup, stackChips } from "./stack";

/** Files at a repo's root that name its host. */
const HOST_FILES: [string, string][] = [
  [".kamal", "Self-hosted (Kamal)"],
  ["fly.toml", "Fly.io"],
  ["vercel.json", "Vercel"],
  ["netlify.toml", "Netlify"],
  ["railway.json", "Railway"],
  ["railway.toml", "Railway"],
  ["render.yaml", "Render"],
];

async function readFile(repo: string, p: string): Promise<string> {
  const [data] = await run(["gh", "api", `repos/${repo}/contents/${p}`], { timeout: 15 });
  try {
    return data?.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
  } catch {
    return "";
  }
}

async function techStack(repo: string, paths: string[], hosting: string | null): Promise<StackGroup[]> {
  const deps = new Set<string>();
  const gems = new Set<string>();
  for (const p of near(paths, "package.json").slice(0, 3)) {
    try {
      const pkg = JSON.parse((await readFile(repo, p)) || "{}");
      for (const k of ["dependencies", "devDependencies"]) for (const d of Object.keys(pkg[k] || {})) deps.add(d);
    } catch {}
  }
  for (const p of near(paths, "Gemfile").slice(0, 2)) for (const g of gemsOf(await readFile(repo, p))) gems.add(g);
  return stackChips(paths, deps, gems, hosting);
}

/** Hosting: the bot that made the newest deployment (vercel[bot]), else a host's file anywhere in the repo. */
export function hostingOf(bot: string, paths: string[]): string | null {
  if (bot.endsWith("[bot]") && bot !== "github-actions[bot]") {
    const name = bot.slice(0, -5);
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }
  const names = new Set(paths.map((p) => p.split("/").pop() as string));
  if (paths.some((p) => p === "config/deploy.yml" || p.endsWith("/config/deploy.yml"))) names.add(".kamal");
  return HOST_FILES.find(([n]) => names.has(n))?.[1] ?? null;
}

async function project(repo: string): Promise<any> {
  const [info, err] = await run(["gh", "api", `repos/${repo}`], { timeout: 15 });
  if (!info) return { repo, error: err };
  const branch = info.default_branch;
  const [[pulls], [runs], [deploys], [tree]] = await Promise.all([
    run(["gh", "api", `repos/${repo}/pulls?state=open&per_page=100`], { timeout: 15 }),
    run(["gh", "api", `repos/${repo}/actions/runs?branch=${branch}&event=push&per_page=1`], { timeout: 15 }),
    run(["gh", "api", `repos/${repo}/deployments?per_page=1`], { timeout: 15 }),
    run(["gh", "api", `repos/${repo}/git/trees/${branch}?recursive=1`], { timeout: 20 }),
  ]);
  const last = (runs?.workflow_runs || [])[0];
  const bot = deploys?.length ? deploys[0]?.creator?.login || "" : "";
  const paths: string[] = (tree?.tree || []).map((x: any) => x.path);
  const hosting = hostingOf(bot, paths);
  const prs = (pulls || []).length;
  return {
    repo,
    name: info.name,
    url: info.html_url,
    description: info.description || "",
    homepage: info.homepage || "",
    private: info.private,
    pushed_at: info.pushed_at,
    archived: info.archived,
    hosting,
    issues: info.open_issues_count - prs,
    prs,
    ci: last ? { status: last.status, conclusion: last.conclusion, name: last.name, url: last.html_url } : null,
    stack: await techStack(repo, paths, hosting),
  };
}

/** Project details use about seven REST calls per repo; five minutes keeps that small. */
const cache = swr<{ at: number; list: any[] }>("projects", 300_000, async () => {
  const list = await Promise.all((config().projects || []).map(project));
  return { at: Math.floor(Date.now() / 1000), list };
});

export const flat = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function projects(force = false) {
  const cfg = config();
  const chosen = cfg.projects || [];
  const [{ at, list }, df, mrr] = await Promise.all([
    cache.get({ key: chosen.join(","), force, wait: force }),
    datafast.get(),
    billing(),
  ]);
  // A project's live site: the service with the repo's name (zero-phase = ZeroPhase), else its GitHub homepage.
  const sites = new Map((cfg.services || []).map((x) => [flat(x.name), x]));
  const subs = cfg.subscriptions || [];
  const out = list.map((p) => {
    if (!("name" in p)) return p;
    const site = sites.get(flat(p.name));
    const live = site?.url || p.homepage;
    const host = (live || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    return {
      ...p,
      live,
      title: site?.name || p.name.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      traffic: df.sites[host] || { error: df.error || "not on DataFast" },
      subscriptions: subs.filter((x) => x.project === p.name || x.project === p.repo),
      billing: mrr[p.repo] ?? null,
    };
  });
  // The keys the payment providers need, and whether .env has each one. Never the key itself.
  const keys = envFile();
  const titles = new Map(out.map((p) => [p.repo, p.title || p.repo]));
  const needed = Object.entries(cfg.billing || {}).flatMap(([repo, accounts]) =>
    accountsOf(accounts).map((b) => {
      const text = JSON.stringify(mrr[repo] || {});
      return {
        repo,
        project: titles.get(repo) ?? repo,
        provider: b.provider,
        key: b.key,
        note: b.note || "",
        present: Boolean(process.env[b.key] || keys[b.key]),
        refused: text.includes(b.key) && text.includes("refused"),
      };
    }),
  );
  return { at, projects: out, keys: needed, env_path: ENV_PATH };
}

/** The repo picker's one write: the chosen repos go into config.json under "projects". */
export function saveProjects(repos: unknown[]) {
  const cfg = config();
  const next = {
    ...cfg,
    projects: repos.filter((r): r is string => typeof r === "string" && /^[\w.-]+\/[\w.-]+$/.test(r)),
  };
  writeConfig(next);
  return next.projects;
}

/** Every repo the gh login can see (own and orgs), for the repo picker. Cached ten minutes. */
export const allRepos = swr<any[]>("repos", 600_000, async () => {
  const [orgs] = await run(["gh", "api", "user/orgs"], { timeout: 15 });
  const owners: (string | null)[] = [null, ...(orgs || []).map((o: any) => o.login)];
  const lists = await Promise.all(
    owners.map((owner) =>
      run(
        [
          "gh",
          "repo",
          "list",
          ...(owner ? [owner] : []),
          "--limit",
          "300",
          "--json",
          "nameWithOwner,description,isPrivate,isArchived,pushedAt",
        ],
        { timeout: 30 },
      ),
    ),
  );
  return lists
    .flatMap(([d]) => d || [])
    .filter((r: any) => !r.isArchived)
    .sort((a: any, b: any) => (b.pushedAt || "").localeCompare(a.pushedAt || ""));
});
