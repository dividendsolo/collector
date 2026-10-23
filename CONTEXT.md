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

Agents do not run the kickstart: it restarts James's live Collector. Restarting it is his.

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
