import { closedRows } from "../work";
import { boardRows, ready, workView } from "./board";
import { swr } from "./cache";
import { config, projectRepos } from "./config";
import { isoLocal, isoUtc, localMidnight, ymdLocal } from "./dates";
import { run } from "./run";

/** Production deploys of one repo since `since` (local midnight, UTC): GitHub deployments to a production environment
 * (Vercel makes these), else successful CI jobs named "deploy" on pushes to main (Kamal from Actions). */
async function deploysToday(repo: string, since: string): Promise<number> {
  const [deps] = await run(["gh", "api", `repos/${repo}/deployments?per_page=50`], { timeout: 15 });
  if (deps?.length)
    return deps.filter((d: any) => (d.environment || "").toLowerCase() === "production" && d.created_at >= since)
      .length;
  const [runs] = await run(
    ["gh", "api", `repos/${repo}/actions/runs?event=push&created=>=${since.slice(0, 10)}&per_page=50`],
    { timeout: 15 },
  );
  let n = 0;
  for (const r of runs?.workflow_runs || []) {
    if (r.created_at < since || !["main", "master"].includes(r.head_branch)) continue;
    const [jobs] = await run(["gh", "api", `repos/${repo}/actions/runs/${r.id}/jobs`], { timeout: 15 });
    n += (jobs?.jobs || []).filter(
      (j: any) => j.name.toLowerCase().includes("deploy") && j.conclusion === "success",
    ).length;
  }
  return n;
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
  const search = async (day: string, perPage: number) => {
    const q = `is:issue is:closed reason:completed closed:>=${day} ${owners.map((o) => `user:${o}`).join(" ")}`;
    const [data] = await run(
      ["gh", "api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-f", `per_page=${perPage}`, "-f", "sort=updated"],
      { timeout: 20 },
    );
    return data;
  };
  const closed = async (day: string) => ((await search(day, 1))?.total_count as number | undefined) ?? null;
  const names = [...repos].sort();
  const month = new Date(midnight);
  month.setDate(month.getDate() - 30);
  const [todays, thirty, counts, [cal]] = await Promise.all([
    search(isoLocal(midnight), 100),
    closed(ymdLocal(month)),
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
    contributions: c
      ? {
          total: c.totalContributions,
          weeks: c.weeks.map((w: any) =>
            w.contributionDays.map((d: any) => [d.date, d.contributionCount, d.contributionLevel]),
          ),
        }
      : null,
    deploys: names
      .map((r, i) => ({ repo: r.split("/").pop() as string, n: counts[i] }))
      .filter((x) => x.n)
      .sort((a, b) => b.n - a.n),
  };
});

/** The open-card count comes from the live board, not from the five-minute stats. */
export async function workStats() {
  const s = await cache.get();
  return { ...s, open: workView().cards.length };
}
