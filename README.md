# Collector

One local page that shows every cron job and every agent run on all your machines, live.

Built for [Hermes Agent](https://github.com/NousResearch/hermes-agent) setups: a laptop and a VPS or two, each with
Hermes cron jobs, launchd jobs on the Mac, and coding agents that build and review cards in git worktrees.
Collector answers three questions at a glance:

1. **Needs attention:** which job failed, which script starts itself in a loop, which GitHub limit is nearly gone.
2. **Running now:** which agent or script works on which card, in which repo, on which machine, and for how long.
   A build turns amber after 30 minutes and red after an hour.
3. **Cron jobs:** every scheduled job on every machine, with its schedule, last run, result, and runs in the last hour.

It reads only. It never changes a job, a file, or a card.

## Requirements

- Python 3.9 or later. No packages: the standard library only.
- SSH access (key-based) to each remote machine, with `python3` on it.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`), signed in, for the API limit section.
- Optional: Docker, for verify runs in the Running now table.

## Run it

```bash
git clone https://github.com/dividendsolo/collector.git
cd collector
cp config.example.json config.json   # then edit it
python3 server.py
```

Open http://localhost:4000. The page refreshes every 15 seconds and reloads itself when a file in the folder changes.
Set `COLLECTOR_PORT` for another port and `COLLECTOR_CONFIG` for a config file somewhere else.

With no `config.json`, Collector shows the Hermes cron jobs of the machine it runs on.

To start it at login on macOS, copy `launchd/com.example.collector.plist` to `~/Library/LaunchAgents/`, set the path
to `server.py`, and run `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.collector.plist`.

## Configure it

`config.json` is yours and stays out of git. Every key is optional.

| Key | What it does |
|---|---|
| `machines` | The machines to read, in table order: `{"name": "laptop"}` for this machine, `{"name": "vps", "ssh": "user@host"}` for one over SSH. |
| `jobs` | One plain-words line per job name, shown in the "What it does" column. |
| `launchd_prefixes` | macOS: launchd jobs whose label starts with one of these show in the table. |
| `ok_exits` | launchd exit codes that mean success for one job: `{"<label>": {"<code>": "<text>"}}`. |
| `work_script` | A script that picks up cards and starts agents. `jobs` are the cron jobs that start it, `log` is its log (each start writes `=== tick <time> ===`), `name` is the name shown when it runs a step itself, and `max_starts_10m` is the loop alarm. |
| `verify_label` | The Docker label prefix your verify tool puts on its containers (`<prefix>.run`, `<prefix>.commit`). A running verify shows as the card's current task. |
| `repos_dir` | The folder that holds your repos (default `~/code`). |

## How it finds things

- **Cron jobs:** Hermes's `~/.hermes/cron/jobs.json` and each profile's `~/.hermes/profiles/<profile>/cron/jobs.json`,
  with run counts from the `executions.db` beside them. On macOS also `~/Library/LaunchAgents/*.plist`.
- **Agent runs:** processes that work in a card worktree, `<repo>/.worktrees/build-<card>` or `review-<card>`. A Hermes
  process (`hermes -p <profile> chat`) makes the row an agent; anything else is the work script.
- **Remote machines:** the server sends `collect.py` over SSH (`ssh <host> python3 -`) on each refresh, so nothing is
  installed there.

## License

MIT
