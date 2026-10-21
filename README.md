# Collector

One local page that shows every cron job and every agent run on all your machines, live.

Built for [Hermes Agent](https://github.com/NousResearch/hermes-agent) setups: a laptop and a VPS or two, each with
Hermes cron jobs, launchd jobs on the Mac, and coding agents that build and review cards in git worktrees.
The Dashboard answers these questions at a glance:

1. **Needs attention:** which job failed, which script starts itself in a loop, which GitHub limit is nearly gone.
2. **Running now:** which agent or script works on which card, in which repo, on which machine, and for how long. Hover a card number to read what the card is for.
   A build turns amber after 30 minutes and red after an hour.
   The table also shows the model each agent calls now (a fallback model shows too).
3. **Service health:** whether each of your sites is online, slow (over 3 s), or down, checked once a minute.
4. **AI credits:** one line per AI provider your Hermes profiles use (each profile's `config.yaml`), read from the
   provider. Plans (subscriptions with usage windows) show bars like the GitHub limit: the Claude subscription
   through Claude Code's own login in the macOS keychain (read only, never renewed), the MiniMax coding plan through
   `MINIMAX_API_KEY` in `~/.hermes/.env`, and Grok as a login check (xAI has no usage API for subscriptions).
   Pay-as-you-go credits (Nous, through Hermes's portal login) show the balance. Under $5, under 10% left, or a
   failed login goes to Needs attention. The Subscriptions page has both panels on top, then your subscriptions, with annual
   charges counted as a twelfth a month; every eye button blurs every amount, so you can share the screen.
5. **Cron jobs:** every scheduled job on every machine, with its status, machine, schedule, last run, and last result.
   Each job opens its own page: its setup (model, output, size in characters or lines and tokens), its schedule,
   its run counts, the agent's full prompt or the script's source, the last error, and its last 10 runs.

The **Agents** page shows Running now, then every Hermes profile on every machine, A to Z: a short note, the type,
the model, the machine, and how many cron jobs the profile runs. Each agent opens its own page with its model,
provider, last session, rules summary, and the cron jobs it runs.

The **Projects** page shows the repos you choose: product name, repo, type, status, hosting, live URL, and health.
Each project opens its own page with the last push, open issues and PRs, CI on the default branch, the card an
agent works on now, and the tech stack read from the repo's `package.json` and `Gemfile`. Hosting comes from the live site's headers, the last GitHub deployment, or a host file in the
repo (`.kamal`, `config/deploy.yml`, `fly.toml`, `vercel.json`, and others).

Each project page also shows a Stats card: monthly spend (subscriptions tagged with the project), MRR and ARR and
total revenue (from the project's payment providers, Stripe and Polar), and revenue and visitors over 30 days
(from DataFast). The Payment keys page (`#/keys`) shows how to make each read-only key and whether it works.

It reads only. It never changes a job or a card. Its one write is your repo choice, saved to `config.json`.

## Requirements

- Python 3.9 or later. No packages: the standard library only.
- SSH access (key-based) to each remote machine, with `python3` on it.
- Optional: the [GitHub CLI](https://cli.github.com) (`gh`), signed in, for the API limit and the Projects page.
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
| `work_script` | A script that picks up cards and starts agents. `jobs` are the cron jobs that start it, `log` is its log (each start writes `=== tick <time> ===`), `name` is the name shown when it runs a step itself, `steps` is an optional folder where it writes what it does on each card now (one JSON file per card: `repo`, `card`, `step`, `since`, `pid`; the step shows instead of "building"), and `max_starts_10m` is the loop alarm. |
| `verify_label` | The Docker label prefix your verify tool puts on its containers (`<prefix>.run`, `<prefix>.commit`). A running verify shows as the card's current task. |
| `services` | Sites to check once a minute: `[{"name": "My app", "url": "https://example.com"}]`. A project whose repo name matches a service name shows that service's status. |
| `vendors` | The outside services you depend on, by their public status page: `[{"name": "GitHub", "url": "https://www.githubstatus.com"}]`. The Collector reads the page's feed by its shape: Statuspage (`/api/v2/summary.json`), Datadog status pages (`/config.json`), Better Stack (`/index.json`) and Stripe (`/current`) are found from `url`; any other feed goes in `"feed"` (Google Cloud's `incidents.json` is read too; for example X: `{"name": "X API", "url": "https://docs.x.com/status", "feed": "https://developer.x.com/api/status"}`). Open incidents show on the APIs page, and the APIs item in the sidebar counts the vendors with one (red for a major or critical one); they never go to Needs attention, since there is nothing to do about them. A service with no status page can use `"probe"`: one GET of an API that answers without a key (Nous: `https://inference-api.nousresearch.com/v1/models`), slow over 3 seconds, an outage on an error. A page with no feed it can read shows as a link. Checked every 5 minutes. |
| `domains` | Domains for the Domains page: `["example.com"]`. Registrar and expiry come from the public registry (RDAP, or `whois` where the registry has no RDAP), plus the HTTPS certificate's expiry. Auto-renew is optional: Vercel domains use `VERCEL_TOKEN` in `.env` (or the Vercel CLI login), Cloudflare domains use `CLOUDFLARE_REGISTRAR_TOKEN` in `.env` (an API token with Account Registrar: Domains Read and Account Settings Read); the page shows the steps. Checked every 12 hours; Needs attention warns 30 days before a domain expires, 60 days before one with auto-renew off, and 14 days before a certificate runs out. |
| `tickets` | Tickets that wait on you, in the Waiting on you panel on the Dashboard: `{"each": ["needs-info"], "count": ["needs-triage"], "command": ["my-tracker", "list", "{lane}", "--json"]}`. An `each` lane shows one row per ticket, with the reason from the comment that moved it there; a `count` lane shows one row with the count. The command runs once per lane, with `{lane}` replaced, and prints a JSON list of tickets with `repo`, `number`, `title`, `url`, `priority`, `labels`, and `createdAt`. Checked every 2 minutes. |
| `subscriptions` | What you pay for: `[{"name": "Hosting", "amount": 20, "billing": "monthly", "currency": "USD"}]`. `billing` is `monthly` or `annual`. |
| `projects` | The repos on the Projects page, as `owner/repo`. The "Choose repos" button writes this key. |
| `agent_notes` | One short note per Hermes profile, shown in the Agents table: `{"builder": "Builds cards"}`. A profile with no note shows "No note yet". |
| `X_BEARER_TOKEN` (`.env`) | Optional: the X API app's bearer token. The APIs page then shows the credit balance (`/2/usage/credits`) and posts read against the monthly cap (`/2/usage/tweets`); under $5 of credit goes to Needs attention. |
| `billing` | Each project's payment providers: `{"owner/repo": [{"provider": "stripe", "key": "MYAPP_STRIPE_KEY"}]}`. `provider` is `stripe` or `polar`; `key` names a line in `.env` (gitignored) that holds a read-only key. |
| `repos_dir` | The folder that holds your repos (default `~/code`). |

## How it finds things

- **Cron jobs:** Hermes's `~/.hermes/cron/jobs.json` and each profile's `~/.hermes/profiles/<profile>/cron/jobs.json`,
  with run counts from the `executions.db` beside them. On macOS also `~/Library/LaunchAgents/*.plist`.
- **Agent runs:** processes that work in a card worktree, `<repo>/.worktrees/build-<card>` or `review-<card>`. A Hermes
  process (`hermes -p <profile> chat`) makes the row an agent; anything else is the work script.
- **Models:** the agent's open session in the profile's `state.db` (Hermes), read only.
- **Revenue:** Stripe charges and Polar orders (paid, less refunds) for total revenue; active subscriptions for MRR.
  Clerk Billing makes plain charges, so a charge named "(annual)" or "(monthly)" counts toward MRR until its term ends.
  DataFast (the token from `datafast login`) gives 30-day revenue and visitors.
- **Agents:** each folder in `~/.hermes/profiles`: the model and provider from its `config.yaml`, the first sentence of its `SOUL.md`, and the last session from its `state.db`.
- **Projects:** the GitHub REST API through `gh`, about seven calls per repo every five minutes.
- **Remote machines:** the server sends `collect.py` over SSH (`ssh <host> python3 -`) on each refresh, so nothing is
  installed there.

## License

MIT
