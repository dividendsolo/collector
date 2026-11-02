# Collector — context

One local page showing every cron job and agent run across machines, live. Next.js (App Router) + TypeScript on
Bun, no database, no auth. It reads only, apart from the two buttons you click yourself — Start Tailscale and Start
Hermes, each acting on the machine it runs on — and the projects list it writes to `config.json`.
`AGENTS.md` holds the stack, the commands and the dangers; this file holds the code's layout, how the running one is
built, restarted and served, and how its features work.

## Installing it: one command, and what a clean machine needs (card #55)

A stranger with none of our files installs it with one line, from the README:

```bash
curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh
```

`install.sh` (repo root, POSIX `sh`, macOS and Linux) is that command, and the same file works in a checkout
(`./install.sh`). It decides where the source is by where it is: run as a file inside a Collector checkout it installs
that folder, piped in (`curl | sh`, where `$0` is not a path) it clones the repo — `$HOME/collector`, or
`COLLECTOR_DIR`/`--dir`, branch `COLLECTOR_REF` of `COLLECTOR_REPO_URL`. Then it installs Bun from bun.sh when the
machine has none, runs `bun install` and `bun run build`, picks the first free port from 4000 (or `COLLECTOR_PORT`,
or `--port`, which is refused when it is taken) and `exec`s `bun start`, printing the URL. A missing `python3` is a
note, not a failure: the page starts and every machine row stays empty until it is there. `--no-install-bun` and
`--help` are the other options.

Two rules shape the script. It writes `node_modules` and `.next` inside that folder and nothing else — no
`config.json`, no `.env`, nothing on any remote machine — and it holds no path, host name, user name or job label of
ours. Its usage text is `printf` lines rather than a heredoc, because `sh` reads a piped script from stdin and the
heredoc's body would have to come from the same stream. `tests/install.test.ts` holds both rules, runs `sh -n` over
it, and pipes it in as `sh -s -- --help` the way `curl | sh` does.

**A machine with none of the tools reads empty, not an error.** On 2026-11-02 a clean Debian container — no `ps`, no
`git`, no `docker`, no `gh`, no `~/.hermes` — answered `Could not read this machine: FileNotFoundError: 'ps'`: three
reads in `collect.py` called `subprocess.run` directly instead of `read_command` (the helper that returns nothing when
a tool is not installed), so one missing binary failed the whole snapshot. `running_agents`, `watch_rows` and
`verify_heads` use `read_command` now. `tests/clean-machine.test.ts` is that machine: the real `collect.py` run with
only `python3` on `PATH` and an empty `HOME`, asserting a clean exit and empty rows.

`docs/main-page.png` is the README's screenshot: the Dashboard of a clean install, taken from the container that
proved the install above, so it shows the empty states rather than any of James's machines. The README's own shape is
part of the card: the one-line what-it-is and who-it-is-for, that screenshot, the Install block, Requirements, What it
shows, Settings (`statuses` and `watch`, the two keys that change what the page reads), the full Configure it table,
and the line for a reader with no agent crew pointing at Hermes Agent (the agent stack is private, so there is no
public URL to point at).

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
- Build with `bun run build`, or `COLLECTOR_DIST_DIR=.next-rebuild` like the rebuild job: `next build` writes its
  `distDir` into `tsconfig.json`'s `include`, so any other folder (a `.next-check` used to keep the served build
  untouched) leaves a tracked `tsconfig.json` change behind for the next pull to trip on.
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

## The Hermes gateway row, with its Start button (card #48)

The waiting crew (agent-stack#261) runs as a Hermes cron on the Hermes gateway's own ticker, so a gateway that stops
stops the crew silently. Every machine's read carries `hermes_gateway`, from `collect.py`:

- `launchctl list ai.hermes.gateway` for a PID — a job launchd knows with no PID is installed and not running;
- `~/.hermes/cron/ticker_last_success`, the epoch second of the last successful tick, for the ticker's age;
- `null` on a machine with no such job (no plist, and launchd does not know the label): a machine without Hermes, and
  the page draws no row for it. A ticker file that was never written reads as no age, not as a stopped ticker.

`lib/server/warnings.ts` turns that into "Hermes gateway is down on <machine>" (an error: nothing of the crew runs)
or "Hermes cron ticker stopped <age> ago on <machine>" (a warning: the process is up, its work is not; ten minutes
without a tick is `TICKER_STALE_S` in `lib/server/hermes.ts`, which `collect.py` writes onto the read so the two agree
on one number). One row per machine, the gateway's when both are wrong.

On the machine Collector runs on the row carries the Start Hermes button (`POST /api/hermes`), the way Start Tailscale
does: `launchctl kickstart -k gui/<uid>/ai.hermes.gateway` — launchd's throttle would otherwise wait out its interval
before the next try — then the state after, ok only once launchd reports a PID, on which the page hides the rows at
once. A machine read over ssh gets no button: the click would act here, never there.

## The card statuses are settings (card #53)

`lib/statuses.ts` holds the three sets of card statuses the page reads, and `config.json`'s `statuses` sets them:

```json
"statuses": {
  "waiting": ["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage"],
  "working": ["agent-in-progress", "verify-in-progress"],
  "done": ["closed"]
}
```

- `waiting` is the Waiting on you list: only those lanes are on it, in the order written. The set is also what has its
  reason read (the comment that moved the card there), what Current work leaves out, and what a card leaving the board
  is not: it waited on you, it did not close.
- `working` is the statuses that say a machine or a session holds the card. A card there with no run in the page's
  read shows how old the data is (`stale 4 min`) instead of its status, since the claim and the read disagree.
- `done` is the statuses that mean the card is finished: those cards are not open work (`workCards` leaves them out of
  the Work page and the open-card count) and not a wait.

**With no setting, the agent stack's own statuses are used**: `waiting` falls back to `tickets.each` when that is set
(the older name for the same lanes; it only ever chose which lanes appear, so they are sorted by the agent stack's
order, with a lane the agent stack does not name after those, and a config that already set it shows the same list card
for card; only an explicit `statuses.waiting` sets its own order), then
to the four above; `working` and `done` fall back to the two and the one above. The four and the two come from the
agent stack's own lane list (`agent-stack/vps/scripts/lane.py`: `ASK_LANES` plus `needs-triage`, and the two lanes a
machine claims a card in), so Collector leads a stranger toward the agent stack and changes nothing for James.

The Card flow page (`components/flow.tsx`) lists the three sets it is reading, in their own order, under its drawing
of the agent stack's flow — the setting is the page's own answer for "which statuses does Collector read here", and
with a set of the user's own it says the drawing is the agent stack's, not theirs.

`/api/tickets` carries `each` (the waiting set, under the name this view has always used), `working` and `done`.

## The Sponsor button (card #52)

Collector stays free and open source, and its own revenue starts with GitHub Sponsors. The button on the repo
page is a file and nothing else: `.github/FUNDING.yml` holds one key, `github: dividendsolo`, and GitHub parses
that file from the default branch. No code in this repo reads or renders it.

Check it through the API, which is what the card's Done-when asks for:

```bash
gh api graphql -f query='query{ repository(owner:"dividendsolo", name:"collector"){ fundingLinks{ platform url } } }'
```

One `GITHUB` link — `https://github.com/dividendsolo` — means the button is there. An empty list means the file
is missing, off the default branch, or does not parse. The `github:` name works only while that account has a
Sponsors profile (`user(login:"dividendsolo"){ hasSponsorsListing }`); with none, GitHub shows no button whatever
the file says.

## The agents and jobs Collector watches (card #54)

The jobs and agents the page already reads — Hermes's cron jobs, launchd's, `crontab -l`'s lines, the systemd timers,
the Hermes gateway and its ticker, and the running Claude Code and Codex sessions — are the default list, and they are
read with no setting at all. `config.json`'s `watch` adds a user's own agent or job, each one thing and the signal
that says how it is doing:

| Entry | The signal | How it reads |
|---|---|---|
| `{"process": "backup-agent.py"}` | a process | text its command line carries: running is busy, gone is idle |
| `{"session": "claude"}` | a coding-agent session | `claude` or `codex`, read by the same helper the Current work rows use, so Claude Code's own helper processes are not a session |
| `{"launchd": "com.example.backup"}` | a launchd label | its last exit code — launchd reports the raw wait status, so 256 reads as exit 1 — non-zero failed unless `ok_exits` for that label calls it a success; a job with a PID is busy, one launchd does not know is a failure |
| `{"log": "~/.logs/sync.log", "fail_on": "error"}` | a log file | its last line carrying `fail_on` failed the run; older than `idle_after` (default 900 s) is idle |
| `{"heartbeat": "~/.work/crew.beat", "idle_after": 900}` | a heartbeat file | the epoch second the file holds, else its mtime: older than `idle_after` is idle |

`name` is what the warning calls it, and `machine` names the machine it lives on, by the name in `machines`; an entry
that names none is read where Collector runs, since a process, a launchd label and a file each belong to one machine —
`lib/server/machines.ts`'s `watchFor` sends each machine only its own entries, in `collect.py`'s `REMOTE_KEYS`, so
another machine's entry never invents an idle row here.

`collect.py`'s `watch_rows` reads them beside the Hermes gateway read on every machine refresh (15 seconds) and puts
one row per entry on the machine's snapshot: `busy` (a process or a session running, a launchd job with a PID), `ok`
(nothing running, nothing wrong), `idle` (no process, no session, no file, or a file older than its limit), or
`failed`. `lib/server/warnings.ts` turns `failed` into an error row in Needs attention and `idle` into a warning, and
says nothing for `busy` and `ok` — the words are `<name> on <machine>: <detail>`. An entry Collector cannot read (no
signal, an unknown one, a `session` that is not `claude` or `codex`, an `idle_after` that is not a positive number of
seconds, an entry that is not an object, a `watch` that is not a list) is a warning rather than a dropped setting,
since a setting that does nothing should not be silent. None of them stops a machine's read: `watchFor` sends a
`watch` that is not a list, and an entry that is not an object, to the machine Collector runs on as they are, so
`collect.py` says each once there, and a bad `idle_after` is that one row's `unknown`, not an exception.

## Layout

- `lib/server/`: every reader (machines, board, AI, vendors, domains, projects, revenue, DataFast) and its cache.
  Server state lives on `globalThis` (`store.ts`), so every route shares one cache and one board poller.
- `app/api/*/route.ts`: one JSON route per reader; `app/api/events` is the board's server-sent events.
- `components/`: the page (one client app with a hash router, as before).
- `instrumentation.ts`: starts the board poll and warms the readers at boot.

## The data endpoints

| Endpoint | What it answers |
|---|---|
| `/api/state` | The page's main read: machines and their jobs, the GitHub limit, Jog's runner minutes this month, X usage, subscriptions, agent notes, and the Needs attention warnings worked out from the newest result of each reader. |
| `/api/tickets` | The board's lanes and the tickets in them, each waiting ticket with the reason it waits (the Work page and the Waiting on you panel), and the three status sets the page reads (`each`, `working`, `done`). |
| `/api/board` | How the board poll is doing: reads, GraphQL points spent in all and in the last hour, the last read's time, open clients and the current interval. |
| `/api/update` | The Update button: the build this server runs, the finished one staged for it, and whether to offer the click (`GET`); the click itself, which hands the swap and the restart to `scripts/apply-update.ts` (`POST`). |

The rest are one route per reader (`/api/ai`, `/api/services`, `/api/vendors`, `/api/domains`, `/api/projects`,
`/api/card`, `/api/repos`, `/api/work`, `/api/work-stats`, `/api/version`); the board's server-sent events are
`/api/events`. The one-click fixes are `POST /api/tailscale` (Start Tailscale) and `POST /api/hermes` (Start Hermes),
each answering with the state after the click.
The board poll costs 1 GraphQL point per read, about 360 an hour while a page is open, and the page sizes in
`lib/server/board.ts` are what keep the query under 100 connection requests. Keep it at 1.

`config.json` and `.env` are gitignored and stay that way: the repo is public and `config.json` holds real host
names, job names and board ids.
