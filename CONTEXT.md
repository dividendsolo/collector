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
`config.json`, no `.env`, nothing on any remote machine — apart from Bun when it installs it: Bun goes into `~/.bun`
and its installer adds itself to `PATH` in the shell's startup file (the README says so). And it holds no path, host name, user name or job label of
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
  A `needs-triage` card always goes first on the list, whatever its priority (James, 2026-11-11: a card triaged can
  go straight to an agent, so triage takes it off his plate at once); the rest keep priority, the order written, then
  oldest (`waitingOrder`).
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

The drawing itself is data, not markup: `lib/flow.ts` holds every status with the colour it wears (green ready,
amber waiting, blue working, grey parked), the two-line label the old picture broke by hand, its `tip`, and where it
sits; the paths a card moves along; and `MAIN_PATH`, the usual route from `needs-triage` to `closed`, which is what
the page draws brightest. `tests/flow.test.ts` holds that list and those paths to the Graphviz source the page used
to render from (commit 3021658), so the drawing cannot quietly lose a status or invent a path.

`components/flow.tsx` lays that out with React Flow (`@xyflow/react`, MIT; `app/layout.tsx` imports its stylesheet
once, and `.flow-canvas` in `app/globals.css` restates the page's own tokens over it). Three things are its own:

- **Tooltips**: the note boxes the Graphviz picture put beside six statuses are each status's `tip` now, opening on
  hover (or a tap, on a touch screen) above or below the box (`tipAbove`), running toward the middle from the outer
  columns (`tipAlign`), so the canvas never clips one. Each is a React Flow `NodeToolbar`, drawn outside the zoomed
  viewport, so it reads at 11px at any zoom: inside the node it shrank with the canvas to 3.6px text on a phone.
- **Light pulses**: every path carries three dots moved by SVG `animateMotion` along the very curve they travel
  (`pulseBegins` spreads them so one is always in flight), in the status's own colour, brightest down `MAIN_PATH`,
  with an arrowhead per path saying which way a card moves; a status glows as a pulse lands on it.
- **Hover**: hovering a status brightens its own paths, dims the rest and opens its tooltip (`neighbours` decides
  what stays lit).

Hover state reaches the boxes and the paths through a React context (`FlowHighlight`), never through the `nodes` and
`edges` arrays: a fresh array on every hover makes React Flow rebuild its own DOM under the pointer, which fires
`mouseleave` and `mouseenter` again, and the drawing empties itself.

`prefers-reduced-motion` is read twice — the CSS drops the boxes' glow, and `components/flow.tsx` stops drawing the
pulses at all (SMIL cannot be paused by a media query); the paths and their arrowheads stay. The canvas is as tall as
the drawing at its own size (about 970x1110) so the labels read. A window up to 700px wide (a phone) does not fit
the drawing to its width, which drew the labels at about 4px: it draws it at zoom 0.8 (labels 9.2px,
`narrowViewport`), on a canvas as big as the drawing at that zoom that scrolls sideways inside its panel, opened
on its middle where `needs-triage` sits. React Flow's own drag, pinch and `touch-action: none` are off there, so a
finger scrolls the page and the drawing natively, and the page itself never scrolls sideways.

`/api/tickets` carries `each` (the waiting set, under the name this view has always used), `working` and `done`.

## Priority tasks: groups, in James's order (2026-11-11)

Every Priority tasks row has a group (`lib/priority.ts`), and the panel lists the groups in this order. Inside a
group, the rows keep the order the server finds them in. An error no longer goes above a warning of an earlier group.

1. **Can't work**: a service or a vendor down, a domain or HTTPS certificate running out, every AI plan out, a repo's
   checks red on main, Tailscale or Hermes stopped, a script in a loop or started by two jobs, the tickets or a
   machine Collector cannot read, a config.json setting that does nothing.
2. **Security**: a port open to the internet, a risky sshd setting.
3. **P0 waiting on you**: one row per P0 card on Waiting on you, linking to the card. A P0 in needs-triage is left
   to the triage row, so no card shows twice. It sits above needs triage (James, 2026-11-11: "i was wrong i want p0 before the triage
   cards").
4. **Needs triage**: "N cards need triage", from the same board read as Waiting on you (cards the waiting crew is
   checking left out). Its link, `#/dashboard?to=waiting-panel&lane=needs-triage`, glides to Waiting on you and
   opens it on the needs-triage cards. A triaged card can go straight to an agent, so triage takes it off James's
   plate at once. No row when none waits.
5. **Jobs failing**: a failed job run, a watched agent failing or idle.
6. **Money and limits**: a renewal, a GitHub limit, X credits.
7. **Unread briefs**: "N unread briefs", linking to the Briefs page. No row when every brief is read.
8. **Good news**: a job's good news.

A row's age, the last column, is when its thing happened, not when Collector first saw the row (James, 2026-11-11:
"time ago since it showed on the board, that's useless"): a vendor incident shows the vendor's own open time (the
oldest open incident), a failed job its failed run's time, a P0 or needs-triage card its open time. Only a row with no
such time falls back to Collector's first sight of it (`.first-seen.json`).

The rows of types 3, 4 and 7 are built in the browser, from the same reads as Waiting on you and the Briefs page. The
Dashboard's sidebar count is the panel's open rows, these with them (`attentionTag`), so the two always agree; an
acknowledged row leaves both.

## The three hand-kept fields Mission Control had (card #78)

Mission Control is retired and Collector took the three small fields of it James missed (James, 2026-11-08). Each is a
setting in `config.json`, the way Collector holds its other hand-kept facts, and each is refused rather than obeyed
when it holds a value Collector does not know: `bun run check:config` exits 1 over it and Priority tasks carries a
row, the same as an unknown key.

| Field | In `config.json` | Where it shows |
|---|---|---|
| A project's stage | `projects["owner/repo"].stage` — `idea`, `development`, `testing`, `production` or `archived` | The Stage column on the Projects page; a project with no stage shows nothing |
| A vendor's criticality | `vendors[].criticality` — `low`, `medium`, `high` or `critical` | A pill beside the vendor's name on the APIs page |
| A subscription's renewal | `subscriptions[].renews` — a `YYYY-MM-DD` day | The Renews column on the Subscriptions page, and a `warn` row in Priority tasks inside the week before it |

`lib/server/config.ts` holds the vocabularies (`PROJECT_STAGES`, `API_CRITICALITIES`), the one check both callers read
(`badConfigValues`), and the two readers of the `projects` key. `projects` keeps both shapes: the map above, which the
repo picker's Save writes (each repo keeping the stage it already had, so choosing repos never drops one), and the
plain list of `owner/repo` strings a config may already hold — `projectRepos` and `projectStage` read either, so an
older config.json loses nothing. `lib/server/projects.ts` puts each project's `stage` on its row for the page.

The renewal row reads whole local calendar days (`renewalDays` in `lib/server/warnings.ts`, counted in
`RENEWS_WARN_DAYS`, 7, at local noon so an hour of daylight saving never shifts the day): a renewal 3 days out makes
the row, one 30 days out does not, and a past date is not a renewal still to come. Only an active subscription warns,
the same reading the Subscriptions page has of "active".

The APIs page's order is `vendorOrder` in `lib/vendors.ts`, with `vendorHit` beside it (both moved off the page so
they can be tested): a vendor whose `criticality` is `high` or `critical` and whose status page lists an incident
comes first, then the vendors with the worst state, then by name. `tests/config-values.test.ts` holds a test per
field.

## The Network page: every open port, who can connect to it, and what each machine sends out (cards #65, #66)

Slices 1 and 2 of the same check: what is open, and what goes out. The Network page (`#/network`) shows one block
per machine Collector already reads. Read only, no `sudo`, nothing installed anywhere, and no port scanned from
outside: `collect.py` asks each machine what it listens on and what it is connected to.

### What is open (collector#65)

Each machine's block lists every listening TCP and UDP port: the port, who it is accessible to, the protocol, the
addresses it is bound on, and the process and pid that own it.

`collect.py`'s `network_read` is the reader. `listen_sockets` reads `ss -tulnp` on Linux and `lsof -nP -iTCP
-sTCP:LISTEN` plus `lsof -nP -iUDP` elsewhere, both through `read_command`, so a machine with neither tool reads
empty rather than failing. `-iUDP` also lists connected UDP sockets (`local->remote`, a browser's QUIC);
`parse_lsof` skips any socket name with `->`, so an outbound connection never reads as an open port. `parse_ss`
and `parse_lsof` turn the two tools' own lines into the same rows — one per socket, with its owner where this user
may read one (`-p` shows only the user's own processes without `sudo`, so a root socket keeps its address and port
and no name), reading past the zone `ss` appends (`203.0.113.10%eth0:68`) and the brackets around an IPv6 address.

`interface_addresses` reads the machine's own addresses (`ip -o addr show` on Linux, `ifconfig` on a Mac), and
`machine_networks` sorts them into `{lan, internet, tailnet}`: the private networks it is on (RFC 1918, `fc00::/7`),
its public addresses, and its Tailscale address. Loopback, link-local and the bridges inside the machine (Docker,
VMs) are no network another machine is on. `reach_of` then says who can connect to each socket:

- **internet** (red, and named in the machine's one error row in Priority tasks): bound on a public address, or on
  every address (`*`, `0.0.0.0`, `::`) of a machine with a public address. An address that cannot be placed, and a
  wildcard on a machine whose addresses were not read, read as the internet: the flag is the safe direction.
- **lan** (grey, and no warning): bound on a private or link-local address, or on every
  address of a machine with only private ones — a Mac on a home network. Its router keeps the internet out.
- **tailnet** (green): bound on a Tailscale address (100.64.0.0/10, fd7a:115c:a1e0::/48).
- **machine**: a loopback address (127.0.0.0/8, ::1).

A port on every address also carries `tailnet: true` when the machine has a Tailscale address, and the page gives it
a second badge, "Tailnet".

The firewall: on Linux `firewall_read` reads `sudo -n ufw status verbose` (`-n` fails at once rather than ask for a
password; no ufw or no passwordless sudo reads null, and the page says the firewall was not read). `parse_ufw` keeps
the default for incoming traffic and the incoming ALLOW and LIMIT rules from anywhere (a rule for one address opens
nothing for the internet as a whole). `apply_firewall` then corrects each port bound beyond the machine: one the
firewall blocks keeps only what it lets in (the tailnet when `Anywhere on tailscale0` is allowed, else the machine
alone); one a rule opens on a firewall that denies by default is **firewalled** (blue): reachable from the internet,
but by a rule someone wrote, so no warning, no toast and no count. A port open to the internet with the firewall off,
or allowing by default, stays **internet** (red). `sudo -n ss -tulnp` reads the owner of every socket, root's
included. The macOS firewall is not read yet.  There is no allow list: a port is not safe because a
list names it, so a port meant to be public still shows as open to the internet.

`network_rows` merges the sockets into one row per port and who can reach it: `ss` and `lsof` print a socket bound on
IPv4 and IPv6 twice, and a browser opens a UDP socket per interface. The row keeps every address it is bound on.

Hovering a process name shows a tooltip (the shared `data-tip` one, with `data-tip-lines` to keep one fact per
line). `ps_details` reads `ps -axo pid=,ppid=,user=,etime=,comm=` once per read (and `ps -axo pid=,args=` on Linux,
whose `comm` is cut to 15 letters), and `process_info` gives each port's process its full name (lsof cuts a name to
nine letters, `ControlCe`), what it is when `KNOWN_PROGRAMS` names it, how long it has run, what started it (its
parent's name; pid 1 is launchd or systemd), its user and its path or command. A program not in `KNOWN_PROGRAMS`
shows its facts alone. A socket with no process (another user's, which `ss` shows without one) has no tooltip.

The page groups the ports one process listens on with the same reach into one row: `5000, 7000` for ControlCenter.
When the ports of a row have different protocols, each port carries its own (`22/tcp, 5353/udp`).

`sshd_read` and `sshd_flags` read the two settings that should not be on — `passwordauthentication yes` and
`permitrootlogin yes` — from `sudo -n sshd -T`, the settings sshd really uses with every drop-in applied. Only that
reading raises a warning or a red toast: the config file alone (the last resort) can be overridden by a drop-in, so
the page says it could not read sshd's own settings instead (ezio, 2026-11-06: the main file said yes,
`sshd_config.d/00-hardening.conf` said no). A Mac is not asked at all.

The tailnet: `tailnet_acl_read` reads Tailscale's access rules for this machine (`tailscale debug netmap`'s packet
filter, with `sudo -n` on Linux) and `tailnet_peers` names the devices. A port keeps its Tailnet badge only where a
rule lets a device reach it, and the Tailnet card names those devices; an empty filter means no tailnet device can
connect (altair, 2026-11-06), and the badge goes. Rules that could not be read leave the badge as the address gives
it.

One machine's section is `{networks, sockets, ssh}` on its snapshot; `lib/server/network.ts`'s `network()` turns the
machines read into `/api/network` — `{at, machines: [{name, local, read_at, stale, error, network}]}` — from the same
10-second read the rest of the page uses, so it costs no extra ssh. `exposedSockets` is the view the warnings use: the
ports open to the internet.

The page draws the most exposed ports first. Every machine's table has the same fixed column widths, so "Accessible
to" lines up from one panel to the next; a long port list wraps in its own column, and under 900px the table scrolls
sideways inside its panel. A machine's addresses are not on the page (a screenshot or a screen share would carry
them): they are in the tooltip on "addresses" beside its name. Under the table sit the firewall line and the ssh
verdict.

### What goes out (collector#66)

`collect.py`'s second reader is `connections_read`, and each connection row carries the remote end, the local end,
the process and pid that own it, and the bytes the OS counted. `established_sockets` picks the platform's tools
through `read_command`: `ss -tnpi` on Linux, whose indented info line under a socket holds `bytes_sent` and
`bytes_received` for that socket (`bytes_scope: "socket"`; `parse_ss_established` skips every state but `ESTAB`, so a
`TIME-WAIT` is not a connection); on a Mac, `lsof -nP -iTCP -sTCP:ESTABLISHED` for the ends, and `nettop -P -L 1 -n
-J bytes_in,bytes_out` for the bytes. Real nettop prints a header `,bytes_in,bytes_out,` and then one
`name.pid,<in>,<out>,` row per process, with no clock column; the pid is what follows the name's last dot
(`python3.14.5696`), and nettop cuts the name to 15 letters while lsof cuts COMMAND to 9, so `join_nettop` joins on
the pid, never the name. A Mac counts bytes per process, not per socket: each of the process's rows carries its total
with `bytes_scope: "process"`, the page shows that total once (on the process's first row, labelled "process total"),
and the page counts it once per pid. Neither tool means no rows, not a failure. No content is read, ever: who
connects where, and how much. The process name is the full one `ps_details` gives for the pid, as on the ports.

Only what goes out is a row. A connection whose local port is a TCP port this machine listens on was accepted, not
made, so it is left out (a server's visitors are not destinations), and so is a loopback peer (127.0.0.0/8, ::1:
this machine talking to itself, a browser on its own dev server) — one quiet minute on ezio once raised 14 to 17
rows out of those two. The exception is `inbound`: an accepted connection whose other end is another device on this
machine's own network. `is_lan_address` reads the private ranges (10/8, 172.16/12,
192.168/16), the link-local ones (169.254/16, fe80::/10) and unique-local IPv6 (fc00::/7), and puts loopback, the
tailnet (100.64/10, fd7a:115c:a1e0::/48) and anything public outside them, since a machine reached over Tailscale is
not a phone on the Wi-Fi.

The host name a connection shows comes from reverse DNS done here, not on the machine: the machine has no memory of
anything and no way to write one. `lib/server/names.ts`'s `withHostNames` fills each connection's `host` on every
read (the same 10-second read, no extra ssh) from a cache in this process's memory: each address is asked once ever,
`DNS_TIMEOUT_MS` (700 ms) on the answer, an empty answer kept so the address is not asked again, and this machine's
own loopback never asked. Nothing else about a connection is remembered. collector#66 also kept a list of what was
new about a machine's network — a process never seen on it, a new destination, an upload over a configurable size
between two reads, a knock on a listening port from the local network, each a "mark" with a Seen click that stayed in
Priority tasks until it was clicked — and that was noise James never asked for: 80 rows of ordinary traffic (Brave,
Todoist, gh, Docker reaching GitHub, Google, AWS) in two days, and wrong on its own terms, since one site's many
load-balancer names (`lb-140-82-113-5`, `lb-140-82-114-5`, …) each counted as somewhere new. It is gone
(collector#75), and so is the file it kept beside `config.json` (`network-seen.json`) and the config.json setting
that sized an upload.

`lib/server/network.ts`'s `network()` is what `/api/network` answers, so a machine's section is
`{networks, sockets, ssh, connections}`. The page draws the Going out table of that machine's connections (remote
address and port, the host name — "no name" when reverse DNS had none — the process, and the bytes sent and
received), then the Listening table of slice 1. It reads them off the same snapshot the Dashboard uses, so a
connection costs nothing extra.

The only network rows in **Priority tasks** are the ports open to the internet and the two sshd settings
(collector#65); nothing about a connection is a row (collector#75).

## Security checks (each machine's rubric)

Above each machine's ports sits its Security checks (`lib/checks.ts`, `securityChecks`): one row per check with a
dot (green good, amber a weak setting, red a real exposure, grey not read; an unread check is never green), a line
that says where the machine stands, and a card on hover with what the check means and its fix. The Mac reads its
application firewall with `socketfilterfw` (no password): on, block all, stealth mode, downloaded signed apps
allowed automatically, and the allow list, where node, python3, ruby and other runners are flagged (they run any
dev server). The Mac firewall allows programs, not ports, so it changes no port's reach. Linux reads ufw (on,
incoming default). Both read SSH (`sshd -T` only), the tailnet devices the access rules let in, and the ports open to
the internet. A red check raises a toast that stays until it is green; an amber one raises a toast with Dismiss,
kept per value in localStorage (`collector.toasts`), so a new value shows again. A check that turns green forgets
its dismissal (`forgetFixed`), so the next time it breaks the toast shows, even with the same value.

## The toasts (card #67)

A small card bottom right on every page (`components/toasts.tsx`, mounted in `components/app.tsx`) when a service
turns Slow or Down, or a machine has ports open to the internet, so nobody has to scroll to the Service health panel
or open the Network page to learn it. Down and the open ports are red, Slow is amber; errors stack first. The title
links to the page with the details.

`lib/toasts.ts` holds the rules as pure functions. A toast has no Dismiss: it stays while its problem lasts and goes
away by itself when the problem is resolved (James, 2026-11-06). Each toast has a `key` (`service:<url>`,
`network:<machine>`) and a `state` (the status and error, or the sorted list of open ports).

A toast makes no sound (James, 2026-11-11: "remove the alert sound on the dashboard, don't need it"). The two-tone
Web Audio alarm a new red toast played is gone, and `tests/toasts.test.ts` fails if page code makes a sound again.

Every toast's title links to its page and the thing on it, the same way for every toast (James, 2026-11-06):
`#/<page>?to=<element id>` (`jumpHref` in `lib/jump.ts`). `useJump` (`components/jump.tsx`, mounted in the Shell)
takes `?to=` off the address, waits up to 8 seconds for the element, glides to it (centered, instant under reduced
motion) and flashes it once (`.jump-flash`). It works the same when the page is already open. The targets: a service
toast goes to its row on Services (`service:<url>`), a Security check to its row on Network (`check:<machine>:<check>`),
the open-ports check to the machine's first port open to the internet (`ports:<machine>:internet`), and a GitHub
limit to the GitHub limits panel on APIs (`github-limit`).

Every Slow or Down check also writes one line to `collector.log` (`serviceLogLines` in `lib/server/services.ts`):
`[services] <time> <name> <status> <ms> ms [<error>]` (no url: one may carry a key in its query), so how many checks were slow and when is in the log
(`grep '\[services\]' ~/Library/Logs/collector.log`), not only the newest check the page shows. An online check
writes nothing. On 2026-11-10 (collector#94) the two Slow toasts were the sites themselves, not the check: a quiet
process timing the same GET beside the live server's own check read the same numbers (Situation 1.95 s against
1.95 s, RepSheet 1.0 s against 1.0 s), so the check stays one plain GET with no second chance.

A GitHub API limit (REST or GraphQL) with under 500 calls left raises an amber toast with Dismiss, since nobody can
fix it but wait for the reset; it shows again when the limit runs out. Priority tasks lists both limits too.

The sidebar's Network item counts the ports open to the internet across every machine (`internetPortCount`), the
same number the toast and Priority tasks name.

## A job's notices (card #82)

A job's good news has a path into the page now. The weekly `directory-listings` check (agent-stack#306) appends one
JSON line per newly live listing to `~/.hermes/notices/directory-listings.jsonl` on the machine it runs on, and each
line shows once: one toast and one Priority tasks row, linking to the listing, gone when it is acknowledged.
Collector had no such path — toasts came only from services and the network, and Priority tasks only from failures
and watch entries.

The line is `{"at": "<ISO time>", "key": "<what an acknowledgement names>", "level": "info", "text": "<the news>",
"href": "<the listing>"}`. `collect.py`'s `notices_rows` reads every `<home>/.hermes/notices/*.jsonl` on every
machine, on the same read as everything else, so it costs no extra ssh: the newest 64 KB of each file
(`NOTICE_TAIL`), oldest first, as `{key, level, text, href, at}` (the `key` falls back to the text, and `href` is null
when the line has none or is not a web address — a `javascript:` or `data:` URL from outside data would run in the
page's own origin, whose routes restart the server and write `config.json`, so only `http://`/`https://` is kept as a
link; the news still shows, without one). A line older than three weeks (`NOTICE_KEEP_S`) is the file's own record of a
listing, not news; a line that is not JSON, that is not an object, or that carries no `text` is skipped, so another
job's file cannot take a machine's whole read down (the clean-machine rule of card #55). A line with no readable `at`
is kept: a job that wrote one meant it.

`lib/server/warnings.ts` turns each row into a `warn` row naming what it read, linked to `href` (an info level is
never an error, so it draws no red), with the existing Acknowledge: `ack.key` is the line's
own key, so acknowledging a listing covers it however many times the machine is read again. An acknowledged row with
no next run reads `Acknowledged.` — the Dashboard only says "Waiting for the next run" when `ack.next` names one.

`lib/toasts.ts`'s `noticeToasts(machines, acks)` is the toast: the line's text is the title and the link (a notice
with no `href` leads to the Priority tasks panel instead), the address is the body, and a `key` already in the
browser's acknowledgements (`components/acks.ts`) is left out. One Acknowledge on the row clears both, since they
read the same list; there is no Dismiss, because the news is not a problem that has to wait for a run to clear.
`tests/notices.test.ts` and `tests/notices.driver.py` drive the real `collect.py` on a fixture home.

## Only a web address is an href (collector#84, #86)

The page takes a few links from outside data — a vendor's status feed gives an incident's own link, a machine's notice
line gives its listing, a project's row gives the repo's GitHub `homepage` — and puts them in an `<a href>` on
Collector's own origin, whose routes restart the server, start the tailnet or the Hermes gateway and write
`config.json`. React does not help: it writes a known attribute straight through, so a `javascript:` or `data:` URL
would run there when it is clicked. `lib/links.ts`'s `webUrl` is the one allowlist — only `http://`/`https://` is a
link (the same rule `collect.py`'s notices read keeps on the machine). A feed's incident link that is not one falls
back to the vendor's own status page (`lib/server/vendors.ts`); a notice line's href is dropped rather than obeyed in
the row and in the toast (`lib/server/warnings.ts`, `lib/toasts.ts`), and the news still shows.

A project's live site is the fourth (collector#86): `lib/server/projects.ts` reads the repo's `homepage` through
`webUrl` where the gh api answer comes in and the service's own url beside it, so `homepage` and `live` on the row are
a web address or empty — the value a repo with no homepage already had — and `components/projects.tsx`'s `liveSite`
(the href's `p.live || p.homepage` fallback) has nothing left to obey. A homepage is a field of a repo the user may
not own, so it is outside data whatever `config.json` says.

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
`failed`. `lib/server/warnings.ts` turns `failed` into an error row in Priority tasks and `idle` into a warning, and
says nothing for `busy` and `ok` — the words are `<name> on <machine>: <detail>`. An entry Collector cannot read (no
signal, an unknown one, a `session` that is not `claude` or `codex`, an `idle_after` that is not a positive number of
seconds, an entry that is not an object, a `watch` that is not a list) is a warning rather than a dropped setting,
since a setting that does nothing should not be silent. None of them stops a machine's read: `watchFor` sends a
`watch` that is not a list, and an entry that is not an object, to the machine Collector runs on as they are, so
`collect.py` says each once there, and a bad `idle_after` is that one row's `unknown`, not an exception.

## A scheduled card's date says why it waits, on hover (card #50)

A scheduled card's body carries the line `Not before: <date> -> <status> (why: <reason>)`, and James's rule is that
every scheduled date says why. `lib/server/board.ts`'s `parseHold` reads the date and the reason off that one line —
the reason is the text between `(why: ` and that line's first `)` — and the row's `hold` carries it as `why`
(`null` when the line gives none).

Current work (the Dashboard) draws a scheduled row's date as `from <date>` in its Status cell. When the line gives a
reason, that date carries the page's own hover card (`components/card-tip.tsx`, over `data-tip` and
`data-tip-title`): "Why it waits" above the reason, with the dotted underline that says the date can be hovered.
`lib/work.ts`'s `holdTip` is what decides the text, and it is null when the line has no reason, so an older card's
date stays plain — no reason, no tooltip. Read the two facts apart: `holdText` is the date the row shows,
`holdTip` is the reason hovering it shows.

## The AI usage rows

- The Dashboard's AI usage panel lists Anthropic, then Nous, then Grok (`AI_ORDER` in `components/ai.tsx`).
- Each provider's bars use its own color: Anthropic is Claude's orange (`--claude`, `#d97757`), Nous is the
  dark blue of nousresearch.com (`--nous`, `#000091`, its `--marketing-dark-blue`). Any bar turns red when the
  provider runs low.
- Nous has two bars. **Plan credits** is the share of the month's plan credits used (Hermes's
  `subscription_credits_remaining` against `monthly_credits`), with the renewal date. **Top-up ($25)** is the
  share of the current $25 top-up used, because James always tops up $25 (`NOUS_TOPUP_USD` in
  `lib/server/ai.ts`); a balance over $25 says how many more full top-ups wait behind it. The Nous API has no
  top-up history, so the count of top-ups this month is not shown.

## Proposals, and the open pipeline (card #77)

Mission Control is retired, so Collector took the one page it was still missing: proposals. Its own data was demo
data, so nothing was imported — the page starts empty. The records come from what Mission Control's `lib/types.ts`
(`Proposal`, `ProposalStatus`) and `lib/repo/proposals.ts` (`pipelineValue`) had; the SQLite store and its server
actions did not come across.

- The rows live in `proposals.json`, **beside `config.json`** — `PROPOSALS_PATH` in `lib/server/paths.ts` is
  `path.dirname(CONFIG_PATH)` plus that name, so a test that points `COLLECTOR_CONFIG` at a temp folder writes its
  proposals there too, and the repo's own `proposals.json` (gitignored, like `config.json`) never holds real clients.
- `lib/proposals.ts` is the shared rule set: the five statuses (`draft`, `pending`, `approved`, `rejected`, `signed`),
  `pipelineValue` (draft + pending + approved, added up per currency: a rejected or signed proposal is already lost or
  won, so it is not in the number) and `newestFirst` (the newest that went out first, the unsent after them). It is
  client-safe, so the page and the server read the same list.
- `lib/server/proposals.ts` is the file, and the zod schema every field is parsed with before anything is stored — the
  input audit of 2026-11 (mission-control#1) is the rule set: client and title 1..100 characters, notes up to 1000,
  none of them carrying `<`, `>` or a link; amount a number 0..10,000,000; currency three letters (stored upper case);
  status one of the five; both dates a real day as `YYYY-MM-DD`, so `2026-02-31` is refused. The same schema reads the
  file back, so a row a hand edit broke is left out rather than shown or crashed on. The file is the only copy, so a
  write never starts from a guess: only a missing file reads as empty; a file that does not parse, or holds a row the
  schema refuses, makes every write a 409 whose `why` names the file, the file is left byte for byte, and the page
  shows that `why` above the table until it is fixed by hand. Writes go through a temp file and a rename.
- `app/api/proposals/route.ts` is the page's read **and** its one write route, all four handlers behind
  `guard(req)`: `GET` the list (what the route answers, the page renders as text — no `dangerouslySetInnerHTML`),
  `POST` to add, `PUT` to edit, `DELETE ?id=` to remove, each answering the list and the pipeline as they stand after
  the change. A refused field is a 400 with the reason in `why`, and an id that is not there is a 404.
- The page (`ProposalsPage` in `components/pages.tsx`) shows the open pipeline at the top, the table under it (client,
  title, amount, status, sent, decided, notes), and one **Add proposal** / Edit form, keyed by the draft's id so Edit
  on another row (or Add) mounts a fresh form instead of keeping the last one's values: the `.fields` grid in
  `app/globals.css` is the only CSS the feature added, and Delete asks first, since the file is the only copy.

## The Briefs inbox (card #64)

Every brief a cron job emails is also kept as one Markdown file in `~/.hermes/briefs/` on the machine that sent it
(agent-stack's own `## Briefs folder`; the terms are in `GLOSSARY.md`: Brief, Inbox, Read, Archived). The Briefs page
is that folder, worked the way an email inbox works.

- `collect.py`'s `briefs_read` reads the folder's front matter on every machine read (the same 10-second one, so the
  list costs no extra ssh) and puts one row per file on the snapshot: the file, the brief's name, its subject, when it
  went out. The file name starts with the UTC stamp the writer saved it at, so sorting the names is sorting by time; a
  dot-file is one being written (the writer renames into place) and anything that is not `.md` is not a brief, so both
  are skipped. No folder is no briefs rather than an error, as every other read here is without its file.
- The date column shows the day a brief went out in the viewer's own time zone (`briefDay`), the day their mail
  app shows. Never UTC: an evening send fell on the next UTC day (James, 2026-11-11). Collector is public, so the
  day is the viewer's, not one zone's. A brief's subject carries no date; this column is the reference.
- One brief's Markdown is read on demand: `collect(machine, cfg, file)` runs the same script over the same ssh with
  one more argument — `python3 - '<config>' brief '<file>'` — which `collect.py`'s `brief_file` answers with that one
  file (front matter and body), or `null` for a name that is not a plain file name or a file that is gone. The folder
  only ever grows, so a snapshot never carries every brief's body.
- `lib/briefs.ts` is the shared rule set: `inbox()` is every brief that is not archived, oldest first by the file
  name; `archived()` is newest first (the last one he filed on top); `keyOf` is the machine and the file, which is one
  brief's whole identity; and `isBriefFile` refuses anything that is not the writer's own file name, so a name off the
  page never reaches a path.
- Read and Archived live on this machine, in `briefs.json` beside `config.json` (`BRIEFS_PATH`; the proposals file's
  pattern, a temp file then a rename), so a browser reset and a Collector restart both leave them in place — and
  nothing prunes it, since the file it names stays in the folder. A file that does not parse refuses a write with a
  409 whose `why` names it and stays byte for byte; a file it cannot read loses the flags rather than the briefs, and
  a key the page does not know is kept, because its machine may simply not have answered this read.
- `briefsView()` works the two together from the cached snapshot — no extra ssh — and adds one plain `why` line when a
  machine could not be read, so an empty Inbox is never a lie. `briefBody()` is the one-file read, with its state.
- The page (`components/briefs.tsx`) is `#/briefs`: the Inbox oldest first, unread bold with its dot and read in the
  normal weight, dimmed where it stands, then the Archived rows under a full-width Archived row of the same table (so
  they share the Inbox's columns), newest first. The dot's cell is `td.unread-dot`: the global `.mark` class is a blue
  box and must not be reused there. `#/briefs/<machine>/<file>` opens one brief as
  Markdown, and the Archive button sits at its top — the Acknowledge toggle's own button; there is no unarchive in this
  pass. Opening a brief is what makes it Read, and an archived brief still opens. The sidebar's Briefs link carries the
  Inbox count as a number; both clicks go through `postBrief`, which hands the POST's answer (the whole view) to SWR's
  `/api/briefs`, so the count changes on the click and not at the next minute's refresh.
- A brief's Markdown is read as data, never as HTML: `lib/markdown.ts` parses headings, tables, lists, fenced code,
  rules and paragraphs with inline code, bold, italics and links, and `components/markdown.tsx` draws those as React
  nodes. Nothing goes near `dangerouslySetInnerHTML`, so raw HTML in a quoted post prints as the characters it is, and
  the only link that exists is an `http`/`https` one. Two deliberate simplifications, both reading better for these
  briefs: a line break inside a paragraph or a list item is drawn as a line break (the briefs write one fact per line),
  and a list nested inside an item is read as a list of its own.

## Layout

- `lib/server/`: every reader (machines, board, AI, vendors, domains, projects, revenue, DataFast) and its cache.
  Server state lives on `globalThis` (`store.ts`), so every route shares one cache and one board poller.
- `app/api/*/route.ts`: one JSON route per reader; `app/api/events` is the board's server-sent events.
- `components/`: the page (one client app with a hash router, as before).
- `instrumentation.ts`: starts the board poll and warms the readers at boot.

## The data endpoints

| Endpoint | What it answers |
|---|---|
| `/api/state` | The page's main read: machines and their jobs, the GitHub limit, Jog's runner minutes this month, X usage, subscriptions, agent notes, and the Priority tasks warnings worked out from the newest result of each reader. |
| `/api/tickets` | The board's lanes and the tickets in them, each waiting ticket with the reason it waits (the Work page and the Waiting on you panel), and the three status sets the page reads (`each`, `working`, `done`). |
| `/api/board` | How the board poll is doing: reads, GraphQL points spent in all and in the last hour, the last read's time, open clients and the current interval. |
| `/api/network` | Every listening port on each machine with who it is accessible to (the internet, the local network, the tailnet, the machine alone), the networks that machine is on and its sshd's password and root settings; and every connection it has going out (remote end, host name, process, bytes sent and received, and whether those bytes are the socket's or the process's), the knocks from its local network among them — the read an agent asks to answer "is anything open that should not be?" |
| `/api/update` | The Update button: the build this server runs, the finished one staged for it, and whether to offer the click (`GET`); the click itself, which hands the swap and the restart to `scripts/apply-update.ts` (`POST`). |
| `/api/proposals` | The client proposals, newest first, and the open pipeline per currency worked out from them (`GET`); the page's one write route adds (`POST`), edits (`PUT`) and removes (`DELETE ?id=`) one, every field parsed on the server, and answers the list and the pipeline as they stand after the change. |
| `/api/briefs` | The Briefs page: the Inbox (every brief that is not archived, oldest first) and the Archived section (newest first), read off the machine snapshot every other page already reads (`GET`); the page's one write (`POST`) sets one brief's read or archived state, on this machine, and answers both lists as they stand after it. |
| `/api/brief` | One brief read whole, over the ssh the snapshot uses (`GET ?machine=&file=`): its front matter, its Markdown and whether it is read or archived here. |

The rest are one route per reader (`/api/ai`, `/api/services`, `/api/vendors`, `/api/domains`, `/api/projects`,
`/api/card`, `/api/repos`, `/api/work`, `/api/work-stats`, `/api/version`); the board's server-sent events are
`/api/events`. The one-click fixes are `POST /api/tailscale` (Start Tailscale) and `POST /api/hermes` (Start Hermes),
each answering with the state after the click.
The board poll costs 1 GraphQL point per read, about 360 an hour while a page is open, and the page sizes in
`lib/server/board.ts` are what keep the query under 100 connection requests. Keep it at 1.

## A route answers this page only (card #69)

Collector listens on loopback, which keeps other machines out but not the browser James already has open. A page from
any site can post to it: `/api/update`, `/api/hermes` and `/api/tailscale` take no body, so a form post needs no
preflight, and one applied a staged update and restarted the server. No `Host` check meant a page whose own name
resolves to 127.0.0.1 (DNS rebinding) could read the GET routes too. The input audit of 2026-11-06 (agent-stack#291)
found both; `lib/server/guard.ts` is the fix.

`guard(req)` answers `null` to let a request through, or the 403 to return instead, and every route in
`app/api/**/route.ts` calls it first (`guard(req) ?? json(...)`, or the refusal at the top of a longer handler). It
reads the method itself, so one function covers both rules:

- the `Host` — or, for a `Request` that carries none, the URL it goes to — must be a loopback name (`localhost`,
  `*.localhost`, any 127/8 address, `::1`) on every route: a browser sends the name it was given, and Collector is
  only ever reached at one of those;
- anything but `GET`/`HEAD` must come from this page: `Sec-Fetch-Site: same-origin`, or, where the browser sends no
  such header, an `Origin` whose host is this one. No such header at all is not a browser: a shell or an agent is
  answered as before, the way a one-click route already did (that route had its own copy of this check; the shared
  guard is the one copy now).

`tests/request-guard.test.ts` holds the behaviour — a cross-site `POST /api/update` is 403 while the page's own click
and a curl get the click's own answer, and a foreign `Host` is 403 on a GET route — and the rules that every route
file calls the guard and that the five state-changing routes are the list (`/api/hermes`, `/api/projects`,
`/api/proposals` — the fifth, added by collector#77 — `/api/tailscale`, `/api/update`), so a new one has to be guarded
on purpose.
The two one-click routes are driven through their own handlers as well (collector#71), their work mocked: a
cross-site post to `/api/tailscale` or `/api/hermes` is 403 and starts nothing, and the page's own click still starts
the tailnet or kickstarts the Hermes gateway.

`config.json` and `.env` are gitignored and stay that way: the repo is public and `config.json` holds real host
names, job names and board ids.

## Every outbound call has a deadline, and a bounded retry (repo standard S2)

Collector is a local, read-only page, so "outbound" is narrow and known: the HTTP GETs its readers make, the
`gh api` calls and the `ssh` machine reads it runs as subprocesses, reverse DNS, the rebuild job's own `git`
commands, and the one health-check GET. Each one now has a time on it, and the ones where a second try is safe have
a few tries with a growing, jittered wait between them (collector#73).

The retry policy is one function, `lib/server/retry.ts`: `withRetry` runs a call up to `attempts` times (three by
default, never more than `MAX_ATTEMPTS`), and `backoffDelay` gives the wait before each retry — exponential from
250 ms, capped at 2 s, with half jitter, so two readers that fail together do not come back together. Nothing
retries forever: `attempts` is finite and capped whatever a caller asks for.

- **HTTP.** `lib/server/http.ts`'s `getJson` (every vendor, API, billing, domain, Jog, DataFast and AI-usage read)
  fetches through `fetchWithTimeout`, which aborts at the timeout and throws a `TimeoutError` naming the limit —
  our own error rather than `AbortSignal.timeout`, whose rejection is named differently on Node and Bun. A network
  error, a timeout, a 5xx or a 429 gets another try; any other 4xx does not, because the answer would be the same.
- **Subprocess reads.** `lib/server/run.ts`'s `runText` kills a hung command with SIGKILL at its timeout (20 s
  unless the caller names another). `run` — the JSON reads: `gh api`, a machine read over ssh, the Nous portal
  script — takes one retry by default, since every call through it is a read. The timeout is the important half
  here: a machine that stops answering ssh used to leave a read open, and the page already handles a failed read by
  keeping the last good one (stale), so the read failing at 20 s is what it wants.
- **The health check is not retried, on purpose.** `lib/server/services.ts`'s `check` measures the service; a
  second try would report a service that just timed out as online and hide exactly the slowness the panel exists
  to show. It keeps its 10 s timeout.
- **Nothing that starts something is retried.** `tailscale up`, `launchctl kickstart`, `open -a`, the update
  restart: each has a timeout and no second try, because a retry would start it twice.
- **The rebuild job.** `lib/rebuild.ts` gives every `git` command a 60 s ceiling (a hung `fetch` or `pull` used to
  hold the job open forever) and retries `git fetch origin main` up to three times with backoff; `bun install`
  (5 min) and `bun run build` (15 min) in `scripts/rebuild-if-stale.ts`, and the restart in
  `scripts/apply-update.ts` (1 min), all carry their own ceiling.
- **`collect.py` needs no change**: every `subprocess.run` in it already passes a `timeout=` (10 s, 5 s for
  `launchctl`), and it makes no HTTP call — it is sent over ssh and runs local, read-only commands.

Concurrency, since the standard asks about pool sizes: there is no database, no queue and no worker pool — one
Next server process on loopback. Bun's `fetch` has no per-origin pool to size; what bounds concurrent requests is
the fan-out (2-3 machines, one request per configured service, one per configured domain), each with its own
deadline. ssh multiplexes (`ControlMaster=auto`, `ControlPersist=300`), so there is one reused connection per
machine whatever the read interval does. `tests/outbound.test.ts` holds the behaviour: a stub server that never
answers and the call that times out, a 5xx that is retried until it recovers, a 404 that is not, the cap and the
jitter, and a hung command under `runText`.

