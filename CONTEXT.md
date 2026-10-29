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

## A change reaches port 4000 only through the Update button

`bun start` serves the `.next` build in `/Users/james/code/collector`, never the source: editing a file changes
nothing on port 4000 until a new build is swapped in and the job restarts. The one way to do that is the page's
**Update** button, or the same step from a shell:

```bash
cd /Users/james/code/collector && bun scripts/apply-update.ts
```

Both apply the build the rebuild job staged from `main` (next section); with none staged they change nothing.

**An agent never kickstarts, stops or kills `com.james.collector`**, and never runs `bun run build` in that
checkout. The by-hand pair this file used to give (`bun run build`, then `launchctl kickstart -k`) is what sat
behind most of the restarts of 2026-10-29: altair's launchd log shows a shell running `git` twice and then
`launchctl kickstart`, from a session working in this checkout (card #41). An agent builds and serves in its own
worktree, on its own port (`COLLECTOR_PORT=4001 bun dev`), and leaves port 4000 alone; its change reaches port 4000
after the merge, through the button.

- A build in a worktree writes that worktree's `.next` and changes nothing on port 4000.
- An open page needs no manual refresh. Every page polls `/api/version` (the build id the server process booted on)
  every two seconds and reloads itself when it moves, which is what a restart on a new build makes it do.

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
has no stamp — is built and staged straight away, and the page offers it as the Update button.

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

While a build waits for the click, the checkout has already been pulled to it, and `collect.py` runs from that
source on every read: the served page can draw rows a newer `collect.py` sends (the #29 mismatch) for as long as
nobody clicks. The cure is the click.

## How a start and a stop show in the log (card #41)

`collector.log` stamps both, from `lib/server/lifecycle.ts`:

- `[server] start <time> pid <pid> parent <pid> build <id> (<commit>)` at every start;
- `[server] SIGTERM <time> pid <pid> parent <pid>; ending N open event streams ...` at every SIGTERM, followed by
  one `[server]   ` line per process started in the 15 seconds before it, credentials masked. macOS records no
  sender for a plain `kill`, so those lines are the nearest thing to one; a `launchctl kickstart` also shows in
  launchd's own log (`log show --predicate 'eventMessage CONTAINS "kickstart"'`).

The SIGTERM handler also ends every open `/api/events` stream and exits (code 143) two seconds later at the
latest, since a foreground page polling `/api/version` over a kept-alive connection would hold Next's own shutdown
open as well. Without that, `next start` closes its port on a
SIGTERM and then waits for the open connections, and a page's event stream never finishes: on 2026-10-29 the live
server sat for ten minutes with its port shut, every new request refused, the open page frozen on its last machine
snapshot, until a reload closed the stream and it exited (`exit(143)`, 16:33:03). A `kickstart -k` cut the same wait
short: launchd logs `Service did not exit 5 seconds after SIGTERM. Sending SIGKILL.`, which is the five seconds
between every kickstart and its restart, and why a restart with a page open left nothing in the log and one without
left `code 143`.

The page says when its run data is old instead of guessing: a claim with no run reads `stale 3 min` when the page's
snapshot is past 45 seconds, or `ezio stale 4 min` when that machine's last read failed (the server keeps the last
good read, marked stale, rather than an empty machine).

To work on the code without touching the live one, use `bun dev` for hot reload on another port, since the live
Collector holds 4000:

```bash
COLLECTOR_PORT=4001 bun dev
```

## The data endpoints

| Endpoint | What it answers |
|---|---|
| `/api/state` | The page's main read: machines and their jobs, the GitHub limit, Jog's runner minutes this month, X usage, subscriptions, agent notes, and the Needs attention warnings worked out from the newest result of each reader. |
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
