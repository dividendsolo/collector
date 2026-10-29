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
- An open page needs no manual refresh. Every page polls `/api/version` (the build id the server process booted on)
  every two seconds and reloads itself when it moves, which is what a restart on a new build makes it do.

That pair by hand is what takes the page down for a moment, and it is what altair's launchd log shows behind the
restarts of 2026-10-29: a shell running `git` twice and then `launchctl kickstart`, from a session working in this
checkout (card #41). Nothing after a merge needs it any more: the rebuild job builds and stages, and the page's
Update button applies it. An agent builds in its own worktree and leaves port 4000 alone.

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
  the build ran, and with none at all when it failed. **The job stops there** (card #41): the finished build stays in
  `.next-rebuild`, the served `.next` is never touched, and nothing restarts. The page offers the build as its Update
  button instead. `tsconfig.json` already lists `.next-rebuild/types`, so the build leaves no tracked file changed
  for the next pull to trip on;
- reads what the page would serve after a click — the staged build when one waits, else the served one — so a build
  already waiting for the click is not built again every five minutes, and a staged build of some other commit (a
  page restarted by hand onto main) is deleted rather than offered;
- is silent when the build is current, and writes one `[rebuild]` line per step it takes otherwise, both streams to
  `~/Library/Logs/collector.log` beside the server's own;
- refuses a checkout that is not on `main`, and logs and stops on a failed fetch, pull or build. A
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

## A push offers the update; the click applies it (card #41)

On 2026-10-29 the page went down 46 times in a day, and altair's launchd log shows a `launchctl kickstart` five
seconds before every one of them: seven from the rebuild job above, the rest from a session running the by-hand pair
of the section before. James's decision: a push must not restart the server by itself.

- `GET /api/update` answers what the button needs: the build this server process runs (its id, and the commit its
  stamp records), the finished build staged in `.next-rebuild`, and whether to offer the click. Two small file reads.
- The button is in the top bar (`components/update.tsx`), shown only while a build waits, and it is small: `Update`.
  It polls `GET /api/update` every 30 seconds, so a push shows up within one rebuild interval.
- `POST /api/update` hands the work to `scripts/apply-update.ts` **detached**, so the click's answer reaches the page
  before the restart takes the server away. The script swaps the staged build into `.next` (`swapIn`) and then runs
  `launchctl kickstart -k gui/$(id -u)/com.james.collector`, which is what makes every open page reload onto the new
  build. With nothing staged it says so and changes nothing, so a second click is harmless.
- The script needs Bun, which the route resolves with `bunPath()` rather than `process.execPath`: the plist runs
  `bun run start`, whose `next start` is a bin with a node shebang, so the server process itself is **node** (found by
  a real click, not by reading the code).
- `/api/version` reports the build this process **booted on**, recorded in `instrumentation.ts`, not the folder's.
  The swap leaves the new build on disk while the old one still runs, and a page that reloaded in that window would
  ask for chunks the server is not serving yet. It moves when the server really comes back, which is when the page
  should reload. (The record lives on `globalThis` — `lib/server/store.ts` — because Next bundles `instrumentation.ts`
  apart from the routes.)

The page stays up until the click; one click is a second of downtime, chosen.

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
| `/api/update` | The Update button: the build this server runs, the finished one staged for it, and whether to offer the click (`GET`); the click itself, which hands the swap and the restart to `scripts/apply-update.ts` (`POST`). |

The rest are one route per reader (`/api/ai`, `/api/services`, `/api/vendors`, `/api/domains`, `/api/projects`,
`/api/card`, `/api/repos`, `/api/work`, `/api/work-stats`, `/api/version`); the board's server-sent events are
`/api/events`.
The board poll costs 1 GraphQL point per read, about 360 an hour while a page is open, and the page sizes in
`lib/server/board.ts` are what keep the query under 100 connection requests. Keep it at 1.

`config.json` and `.env` are gitignored and stay that way: the repo is public and `config.json` holds real host
names, job names and board ids.
