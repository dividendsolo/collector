# Collector — context

One local page showing every cron job and agent run across machines, live. Next.js (App Router) + TypeScript on
Bun, no database, no auth. It reads only: the one thing it writes is the projects list in `config.json`.
`AGENTS.md` holds the stack, the commands and the dangers; this file holds how the running one is built, restarted
and served.

## How it runs

The live Collector is a production Next build served by the launchd job `com.james.collector`
(`~/Library/LaunchAgents/com.james.collector.plist`, `RunAtLoad` and `KeepAlive`). The job runs `bun start` with
its working directory set to the checkout at `/Users/james/code/collector`, which is
`next start -H 127.0.0.1 -p ${COLLECTOR_PORT:-4000}`. The plist sets neither `COLLECTOR_PORT` nor
`COLLECTOR_CONFIG`, so it serves port 4000 and the checkout's own `config.json`. The page is
http://127.0.0.1:4000. The job's stdout and stderr are both `~/Library/Logs/collector.log`.

Remote machines are read the same way in the request: the server sends `collect.py` over SSH
(`ssh <host> python3 -`), standard library only, read only, nothing installed there.

## A change shows only after a build and a restart

```bash
cd /Users/james/code/collector
bun run build
launchctl kickstart -k gui/$(id -u)/com.james.collector
```

`bun start` serves the `.next` build in that checkout, never the source: editing a file changes nothing on port
4000 until the build runs again and the job restarts. Two things follow from that:

- The build has to run in the folder the plist serves, `/Users/james/code/collector`. A build in a worktree writes
  that worktree's `.next` and changes nothing on port 4000.
- An open page needs no manual refresh. Every page polls `/api/version` (the `.next` build id) every two seconds
  and reloads itself when it moves, which is what a build plus a restart makes it do.

That pair is what the job below runs after a merge. By hand it is James's: an agent builds in its own worktree and
leaves port 4000 alone.

## The live Collector rebuilds itself after a merge (card #29)

On 2026-10-25 the page served a build from two days before, while `collect.py` — which runs from source on every
request — sent it the Claude Code and Codex session rows #24 had added, and the old page drew them wrong. The job
that keeps it current is `com.james.collector-rebuild`
(`~/Library/LaunchAgents/com.james.collector-rebuild.plist`, `StartInterval` 300, no `KeepAlive`). It runs

```bash
bun scripts/rebuild-if-stale.ts
```

in the checkout every five minutes, and that script:

- fetches `origin/main` and compares it with the commit the served build was made from. `bun run build` records that
  commit in `.next/collector-build.json` (`scripts/build-stamp.ts`, run as `postbuild`); a build that fails writes
  nothing, so the old stamp stands and the next run tries again;
- when the two differ: `git pull --ff-only origin main` if the checkout is behind, then `bun run build` with
  `COLLECTOR_DIST_DIR=.next-rebuild`, so the build goes into `.next-rebuild` beside the served `.next`
  (`next.config.ts` reads that variable as its `distDir`; `postbuild` stamps the same folder). `next build` empties
  its own folder before it compiles, so a build in `.next` itself would leave the page with no build for as long as
  the build ran, and with none at all when it failed. Only once the build succeeded does the script move `.next`
  aside, rename `.next-rebuild` to `.next`, delete the old one, and run
  `launchctl kickstart -k gui/$(id -u)/com.james.collector` — the restart that makes every open page reload onto the
  new build. `tsconfig.json` already lists `.next-rebuild/types`, so the build leaves no tracked file changed for the
  next pull to trip on;
- is silent when the build is current, and writes one `[rebuild]` line per step it takes otherwise, both streams to
  `~/Library/Logs/collector.log` beside the server's own;
- refuses a checkout that is not on `main`, and logs and stops on a failed fetch, pull, build, swap or restart. A
  failed build deletes `.next-rebuild` and never touches `.next`: its BUILD_ID, its chunks and its stamp stay as they
  were, and the page keeps serving them. It always names what it did in the log, so a main that will not
  build shows up as one `build failed` line every five minutes, not as a silent old page.

`bun scripts/rebuild-if-stale.ts --check` is the read-only form — no fetch, no pull, no build, no restart — and says
what a run would do from the last fetch.

Install it once, after this card's code has landed in the checkout:

```bash
cp launchd/com.example.collector-rebuild.plist ~/Library/LaunchAgents/com.james.collector-rebuild.plist
# set the two paths to /Users/james/.bun/bin/bun and /Users/james/code/collector, the label to com.james.collector,
# and both log paths to /Users/james/Library/Logs/collector.log, the log the serving job already writes
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.james.collector-rebuild.plist
```

`RunAtLoad` means bootstrapping runs it at once, so the first build it finds stale — the one serving today, which
has no stamp — is rebuilt and the page restarted straight away.

To work on the code without touching the live one, use `bun dev` for hot reload on another port, since the live
Collector holds 4000:

```bash
COLLECTOR_PORT=4001 bun dev
```

## The data endpoints

| Endpoint | What it answers |
|---|---|
| `/api/state` | The page's main read: machines and their jobs, the GitHub limit, X usage, subscriptions, agent notes, and the Needs attention warnings worked out from the newest result of each reader. |
| `/api/tickets` | The board's lanes and the tickets in them, each waiting ticket with the reason it waits (the Work page and the Waiting on you panel). |
| `/api/board` | How the board poll is doing: reads, GraphQL points spent in all and in the last hour, the last read's time, open clients and the current interval. |

The rest are one route per reader (`/api/ai`, `/api/services`, `/api/vendors`, `/api/domains`, `/api/projects`,
`/api/card`, `/api/repos`, `/api/work`, `/api/work-stats`, `/api/version`); the board's server-sent events are
`/api/events`.
The board poll costs 1 GraphQL point per read, about 360 an hour while a page is open, and the page sizes in
`lib/server/board.ts` are what keep the query under 100 connection requests. Keep it at 1.

`config.json` and `.env` are gitignored and stay that way: the repo is public and `config.json` holds real host
names, job names and board ids.
