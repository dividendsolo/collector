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

- **internet** (red, and named in the machine's one error row in Needs attention): bound on a public address, or on
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

### What goes out, and what is new about it (collector#66)

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
and the seen-list counts it once per pid. Neither tool means no rows, not a failure. No content is read, ever: who
connects where, and how much. The process name is the full one `ps_details` gives for the pid, as on the ports.

Only what goes out is a row. A connection whose local port is a TCP port this machine listens on was accepted, not
made, so it is left out (a server's visitors are not destinations), and so is a loopback peer (127.0.0.0/8, ::1:
this machine talking to itself, a browser on its own dev server) — one quiet minute on ezio once raised 14 to 17
marks out of those two. The exception is `inbound`, the card's fourth mark: an accepted connection whose other end is
another device on this machine's own network. `is_lan_address` reads the private ranges (10/8, 172.16/12,
192.168/16), the link-local ones (169.254/16, fe80::/10) and unique-local IPv6 (fc00::/7), and puts loopback, the
tailnet (100.64/10, fd7a:115c:a1e0::/48) and anything public outside them, since a machine reached over Tailscale is
not a phone on the Wi-Fi.

The marks are the server's, not `collect.py`'s: the machine has no memory of the last read and no way to write one.
`lib/server/seen.ts` keeps the seen-list, one small JSON file next to `config.json` (`network-seen.json`, gitignored;
`COLLECTOR_SEEN` names the file, and `COLLECTOR_CONFIG`'s folder is what it is derived from, so a test points both at
a temp directory and the real one is never written). Per machine it holds the processes and the sites each has been
seen going to, the bytes each had sent at the last read, the local knocks already seen, the reverse-DNS cache
and the unseen marks. `foldRead` is pure and does the whole of it:

- the machine's **first read fills the list and marks nothing** — otherwise a fresh install would report every
  process on it as new;
- after that, a **process never seen** on that machine marks once (its destinations are recorded with it, since "a
  new destination for a known process" says nothing about a process nobody has seen);
- a **destination** — a site, from the host name reverse DNS gave — a known process has not been seen reaching.
  Names are compared by site (`domainOf`: the last two labels, three under `co.uk`-style suffixes), so a new
  load-balancer name of a site already reached (`lb-140-82-112-3-iad.github.com` after `lb-140-82-114-3-iad…`) is
  not new. An address with no reverse name is never a destination mark: most CDN and cloud addresses have none, and
  three minutes on a Mac once made 29 marks of one dev server reaching Cloudflare's unnamed 104.x and 172.67.x. A new
  process and an upload still mark whatever the address. A loopback address is never a destination;
- an **upload**: the bytes a process sent over what it had sent at the last read, past `network.uploadWarnMB`
  (default 50 MB, decimal, `network_upload_mb`), so it is the jump and not the total. A socket's own bytes add up
  across the process's sockets; a process total (a Mac) counts once per pid, so a process's connection count
  changing between two reads cannot raise an upload;
- a **local knock**: an `inbound` connection to a port this machine listens on from another device on its network.

A mark stays in the state until Seen drops it, and the fact behind it stays in the list, which is what makes a
cleared mark stay cleared; an upload that keeps going earns a fresh mark, because that is what "since the last read"
means. A connection of another user's has no name to mark by and is left out of the process rows. Only the
destination marks are capped, at 50 a machine (the newest kept), so the file cannot grow without end; a process,
upload or knock mark leaves only through Seen (`capDestinations`). The one exception is a ceiling of 500 knock marks
(`MAX_MARKS_CEILING`, the oldest knocks go), there so a local device knocking from address after address cannot grow
the file without end; process and upload marks are one per process name, so they never need a cap.

Reverse DNS happens here, not on the machine: `resolveNames` asks once per address ever, from the cache in the state,
with 700 ms on it (a name that takes longer is no name), keeps an empty answer so the address is not asked again, and
skips this machine's own loopback. `observeAll` folds every machine's read into the list once per snapshot read (the
same 10-second read, no extra ssh) and writes the file back only when it changed; a machine whose read failed keeps
its last good read and its marks rather than folding an empty one. The file is read, changed and written whole, so
those steps run one at a time (`seen.ts`'s one-at-a-time tail): a Seen click that lands while a read is folding is
not undone by that read writing back the state it read before the click (2026-11-06, the one race this page's one
write had).

`lib/server/network.ts`'s `network()` is what `/api/network` answers, so a machine's section is
`{networks, sockets, ssh, connections, upload_warn_mb, marks}`. The page draws the marks at the top of the machine's
panel (each with a Seen button; under 600px the pill and Seen share a line and the words take the one under it, so
Seen is never pushed off the panel) and the Going out table under them (remote address and port, the host name — "no
name" when reverse DNS had none — the process, and the bytes sent and received), then the Listening table of slice 1.
It reads the marks off the same snapshot the Dashboard uses, so a mark costs nothing extra.

The marks are rows in **Needs attention** — `warn` level, since nothing is broken and they are things to look at,
which is the card's own question ("what looks weird on my network right now?"). `lib/network.ts`'s `markText` writes
the words, with the machine's name in the Dashboard row and without it on the page, and each row's Seen click posts
`/api/network/seen?machine=<name>&id=<mark id>` — the id in the query is what lets one click clear one row (`a
warning's action is a URL, not a body`). `app/api/network/seen/route.ts` is the one write this page adds, and it
takes the same two values from a JSON body too, for a shell or an agent. The route answers `{machine, id, cleared,
marks}` — the list that machine now carries.

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

A red toast this page has not sounded for yet (a key and state it has not seen) plays a short two-tone alarm made
with Web Audio; Slow makes no sound, and one problem sounds once. A browser plays no sound before the first click or
key on the page, so the red toasts showing at load sound on that first click or key; after it, a new one sounds at
once.

Every toast's title links to its page and the thing on it, the same way for every toast (James, 2026-11-06):
`#/<page>?to=<element id>` (`jumpHref` in `lib/jump.ts`). `useJump` (`components/jump.tsx`, mounted in the Shell)
takes `?to=` off the address, waits up to 8 seconds for the element, glides to it (centered, instant under reduced
motion) and flashes it once (`.jump-flash`). It works the same when the page is already open. The targets: a service
toast goes to its row on Services (`service:<url>`), a Security check to its row on Network (`check:<machine>:<check>`),
the open-ports check to the machine's first port open to the internet (`ports:<machine>:internet`), and a GitHub
limit to the GitHub limits panel on APIs (`github-limit`).

A GitHub API limit (REST or GraphQL) with under 500 calls left raises an amber toast with Dismiss, since nobody can
fix it but wait for the reset; it shows again when the limit runs out. Needs attention lists both limits too.

The sidebar's Network item counts the ports open to the internet across every machine (`internetPortCount`), the
same number the toast and Needs attention name.

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

## The AI credits rows

- The Dashboard's AI credits panel lists Anthropic, then Nous, then Grok (`AI_ORDER` in `components/ai.tsx`).
- Each provider's bars use its own color: Anthropic is Claude's orange (`--claude`, `#d97757`), Nous is the
  dark blue of nousresearch.com (`--nous`, `#000091`, its `--marketing-dark-blue`). Any bar turns red when the
  provider runs low.
- Nous has two bars. **Plan credits** is the share of the month's plan credits used (Hermes's
  `subscription_credits_remaining` against `monthly_credits`), with the renewal date. **Top-up ($25)** is the
  share of the current $25 top-up used, because James always tops up $25 (`NOUS_TOPUP_USD` in
  `lib/server/ai.ts`); a balance over $25 says how many more full top-ups wait behind it. The Nous API has no
  top-up history, so the count of top-ups this month is not shown.

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
| `/api/network` | Every listening port on each machine with who it is accessible to (the internet, the local network, the tailnet, the machine alone), the networks that machine is on and its sshd's password and root settings; every connection it has going out (remote end, host name, process, bytes sent and received, and whether those bytes are the socket's or the process's) and the knocks from its local network; and what is new about them (a process never seen there, a new destination, an upload over `network.uploadWarnMB`, a local knock) — the read an agent asks to answer "is anything open that should not be, and what looks weird on my network right now?" |
| `/api/update` | The Update button: the build this server runs, the finished one staged for it, and whether to offer the click (`GET`); the click itself, which hands the swap and the restart to `scripts/apply-update.ts` (`POST`). |

The rest are one route per reader (`/api/ai`, `/api/services`, `/api/vendors`, `/api/domains`, `/api/projects`,
`/api/card`, `/api/repos`, `/api/work`, `/api/work-stats`, `/api/version`); the board's server-sent events are
`/api/events`. The one-click fixes are `POST /api/tailscale` (Start Tailscale), `POST /api/hermes` (Start Hermes) and
`POST /api/network/seen` (a mark's Seen click), each answering with the state after the click.
The board poll costs 1 GraphQL point per read, about 360 an hour while a page is open, and the page sizes in
`lib/server/board.ts` are what keep the query under 100 connection requests. Keep it at 1.

`config.json` and `.env` are gitignored and stay that way: the repo is public and `config.json` holds real host
names, job names and board ids.
