import { closedRows } from "../work";
import { boardRows, ready, workView } from "./board";
import { swr } from "./cache";
import { config, projectRepos } from "./config";
import { isoLocal, isoUtc, localMidnight, ymdLocal } from "./dates";
import { snapshot } from "./machines";
import { run } from "./run";

/** A deploy the machines made themselves: pull-deploy's Kamal deploys (collect.py `pull_deploys`). */
export interface MachineDeploy {
  app: string;
  sha: string;
  at: string;
}

/** Deploys today per repo, most first: GitHub's (the commit of each) plus the machines' own Kamal deploys since `since`,
 * a commit once per repo, so zero-phase's Vercel and Kamal deploy of one commit is one (James, 2026-11-11). A Kamal
 * app is matched to its repo by its name. */
export function countDeploys(
  repos: string[],
  github: Record<string, string[]>,
  machine: MachineDeploy[],
  since: string,
): { repo: string; n: number }[] {
  const shas = new Map<string, Set<string>>();
  const add = (repo: string, sha: string) => {
    const name = repo.split("/").pop() as string;
    if (!shas.has(name)) shas.set(name, new Set());
    shas.get(name)?.add(sha);
  };
  for (const r of repos) for (const sha of github[r] || []) add(r, sha);
  for (const d of machine) if (d.at >= since) add(d.app, d.sha);
  return [...shas.entries()]
    .map(([repo, s]) => ({ repo, n: s.size }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n);
}

/** The commit of each production deploy of one repo since `since` (local midnight, UTC): GitHub deployments to a
 * production environment (Vercel makes these), else successful CI jobs named "deploy" on pushes to main (Kamal from
 * Actions). */
async function deploysToday(repo: string, since: string): Promise<string[]> {
  const [deps] = await run(["gh", "api", `repos/${repo}/deployments?per_page=50`], { timeout: 15 });
  if (deps?.length)
    return deps
      .filter((d: any) => (d.environment || "").toLowerCase() === "production" && d.created_at >= since)
      .map((d: any) => d.sha);
  const [runs] = await run(
    ["gh", "api", `repos/${repo}/actions/runs?event=push&created=>=${since.slice(0, 10)}&per_page=50`],
    { timeout: 15 },
  );
  const out: string[] = [];
  for (const r of runs?.workflow_runs || []) {
    if (r.created_at < since || !["main", "master"].includes(r.head_branch)) continue;
    const [jobs] = await run(["gh", "api", `repos/${repo}/actions/runs/${r.id}/jobs`], { timeout: 15 });
    for (const j of jobs?.jobs || [])
      if (j.name.toLowerCase().includes("deploy") && j.conclusion === "success") out.push(`${r.head_sha}/${j.id}`);
  }
  return out;
}

/** The GitHub search behind a Work panel number: cards closed as done, or PRs merged (James, 2026-11-11), since `day`
 * (a date or a local timestamp), across every owner. */
export function searchQuery(kind: "closed" | "merged", day: string, owners: string[]): string {
  const what =
    kind === "merged" ? `is:pr is:merged merged:>=${day}` : `is:issue is:closed reason:completed closed:>=${day}`;
  return `${what} ${owners.map((o) => `user:${o}`).join(" ")}`;
}

const CAL =
  "query={viewer{contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}";

/** Cards closed as done (today, 30 days), deploys today per repo, and the signed-in user's contribution calendar.
 * The repos are the chosen projects plus every repo with a card on the board. Read every five minutes. */
const cache = swr("work-stats", 300_000, async () => {
  await ready();
  const midnight = localMidnight();
  const since = isoUtc(midnight);
  const repos = new Set(projectRepos(config()));
  for (const t of boardRows() || []) {
    const m = (t.url || "").match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//);
    if (m) repos.add(m[1]);
  }
  const owners = [...new Set([...repos].map((r) => r.split("/")[0]))].sort();
  const search = async (day: string, perPage: number, kind: "closed" | "merged" = "closed") => {
    const q = searchQuery(kind, day, owners);
    const [data] = await run(
      ["gh", "api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-f", `per_page=${perPage}`, "-f", "sort=updated"],
      { timeout: 20 },
    );
    return data;
  };
  const count = async (day: string, kind: "closed" | "merged") =>
    ((await search(day, 1, kind))?.total_count as number | undefined) ?? null;
  const names = [...repos].sort();
  const month = new Date(midnight);
  month.setDate(month.getDate() - 30);
  const [todays, thirty, mergedToday, merged30, counts, [cal]] = await Promise.all([
    search(isoLocal(midnight), 100),
    count(ymdLocal(month), "closed"),
    count(isoLocal(midnight), "merged"),
    count(ymdLocal(month), "merged"),
    Promise.all(names.map((r) => deploysToday(r, since))),
    run(["gh", "api", "graphql", "-f", CAL], { timeout: 20 }),
  ]);
  const c = cal?.data?.viewer?.contributionsCollection?.contributionCalendar;
  return {
    at: Date.now() / 1000,
    closed_today: (todays?.total_count as number | undefined) ?? null,
    // The cards behind that number, for the Closed today page (James, 2026-11-10). Search answers 100 at most.
    closed_today_cards: closedRows(todays?.items || []),
    closed_30d: thirty,
    merged_today: mergedToday,
    merged_30d: merged30,
    contributions: c
      ? {
          total: c.totalContributions,
          weeks: c.weeks.map((w: any) =>
            w.contributionDays.map((d: any) => [d.date, d.contributionCount, d.contributionLevel]),
          ),
        }
      : null,
    deploys: countDeploys(
      names,
      Object.fromEntries(names.map((r, i) => [r, counts[i]])),
      ((await snapshot.get()).machines || []).flatMap((m: any) => m.pull_deploys || []),
      since,
    ),
  };
});

/** The open-card count comes from the live board, not from the five-minute stats. */
export async function workStats() {
  const s = await cache.get();
  return { ...s, open: workView().cards.length };
}
