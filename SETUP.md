# Set up Collector with one prompt

Collector reads one settings file, `config.json`, which is yours, gitignored, and until now written by hand: a long
list of keys, most of them shaped like one person's setup, so a new user saw a page that knew nothing about them.

This page fixes that. Paste the prompt below into your coding agent — Claude Code, Codex, Hermes, anything that reads
files and runs commands — and it looks around your machine read-only, writes `config.json` from what it finds, starts
Collector, and reports what it found and what it skipped. Everything it writes is a key Collector reads; nothing else
on the machine changes.

## Run it

```bash
git clone https://github.com/dividendsolo/collector.git
cd collector
bun install
```

Start your agent in that folder and paste this in:

```text
Set up Collector, the app in this folder, for the person whose machine you are on. Collector shows the cron jobs,
agent runs, sites and spend of their machines on one local page. Its only settings file is `config.json`, which does
not exist yet; `config.example.json` shows the shape and the "Configure it" table in `README.md` explains every key.
Fill `config.json` in from what is already on this machine, start the app, and tell me what you found and what you
skipped.

Rules
1. Read-only, with exactly one exception: the only file you may create or change is `config.json` in this folder. Do
   not write, move, rename or delete anything else, do not install a package, and do not change a job, a service, an
   account, a repo or any file outside `config.json`. Look, do not touch.
2. Never put a secret in `config.json`: no API key, token, password, connection string or private URL. Secrets live in
   `.env` (also gitignored); `config.json` only names the `.env` line that holds one, which is `billing`'s `key`. If
   you read a key while looking around, do not copy it and do not print it.
3. Write only keys Collector reads: the `Config` interface in `lib/server/config.ts` and that README table are the
   whole list. Never invent a key, however sensible it sounds: a key Collector does not read is a setting that does
   nothing. `bun run check:config` fails on one, so run it once you have written the file.
4. Skip what you cannot confirm. An empty key beats a guess: a guessed machine sits on the page as a red row forever,
   a guessed status page as a link that never loads, a guessed amount as a wrong number in the spend. Every key is
   optional, and Collector runs with `config.json` empty.
5. Keep a list of what you skipped and why from the first minute. You report it at the end.

What to look at — read-only, and only what exists on this machine

- Hermes, if `~/.hermes` exists: `~/.hermes/cron/jobs.json` and each `~/.hermes/profiles/*/cron/jobs.json` hold the
  scheduled jobs. In `jobs`, one plain-words line each for the "What it does" column, read from the job's prompt or
  script. In `agent_notes`, one short line per profile, from its `config.yaml` (model, provider) and the first line of
  its `SOUL.md`. If the person runs a script that picks up cards and starts agents — a `pickup.py`, a `foreman.py`, a
  cron job whose command runs one of those — describe it in `work_script`: `label`, `name`, the `jobs` that start it,
  its `log`, and `steps` if it writes one file per card somewhere.
- macOS launchd, if `~/Library/LaunchAgents/*.plist` holds the person's own jobs: `launchd_prefixes` takes the label
  prefix those jobs share, one entry that covers them (never `com.apple.`). `ok_exits` takes an exit code that means
  success for a job that exits non-zero when it worked: `{"<label>": {"3": "ok (opened a PR)"}}`. Read the plists'
  paths and their `StartInterval` or `StartCalendarInterval`. If several jobs do not share a prefix, leave
  `launchd_prefixes` out and say so. Not macOS, or no plists: leave both keys out.
- Plain cron and systemd timers: Collector reads this user's `crontab -l` lines and its own and the system's
  systemd timers (`systemctl list-timers --all`, with each timer's service read by `systemctl show`) by itself on
  every refresh, so write no key for them — only a plain-words line in `jobs` for one whose command or unit name
  does not say what it does.
- The repos, usually under `~/code`: list that folder (or `repos_dir`, or wherever they are). In each repo read the
  dependency manifests (`package.json`, `Gemfile`, `requirements.txt`, `go.mod`, `pyproject.toml`) and the deploy files
  (`vercel.json`, `fly.toml`, `netlify.toml`, `wrangler.toml`, `.kamal`, `config/deploy.yml`, `Dockerfile`,
  `docker-compose.yml`, `Procfile`); they name the sites and the vendors.
  - `services`: the live sites and APIs of this person, `{"name": "My app", "url": "https://example.com"}` — a URL that
    answers without a login. Check that it answers before you write it (`curl -s -o /dev/null -w '%{http_code}' <url>`
    should print 200 or 308) and leave out anything that does not.
  - `domains`: the domains those sites serve, one string each (`["example.com"]`). The Domains page reads the
    registrar, the expiry date and the certificate from there.
  - `vendors`: the outside services the repos depend on, `{"name": "Stripe", "url": "https://status.stripe.com"}` — the
    vendor's public status page, which you can confirm with one GET. Add `"attention": true` only on the ones whose
    outage the person would want at the top of the page, the ones the product cannot live without; the rest stay
    listed without it.
  - `projects`: the repos worth a row on the Projects page, as `owner/repo`: the ones the person runs, not every clone.
    Get the exact name from inside the repo: `gh repo view --json nameWithOwner`.
  - `subscriptions`: what the person pays for, `{"name": "Vercel", "amount": 20, "billing": "monthly"}` — only from
    something you can read on this machine (an invoice, a receipts folder, a billing note in a repo). Never guess an
    amount: leave the key out and say what you would need to fill it.
  - `billing`: a payment provider of one of those repos whose read-only key the person already keeps in `.env`:
    `{"owner/repo": [{"provider": "stripe", "key": "MYAPP_STRIPE_KEY"}]}`. `provider` is `stripe` or `polar`, and `key`
    is the name of the `.env` line, never its value. Nothing in `.env`: leave it out.
- The GitHub CLI, if `gh auth status` says you are signed in: `gh api user --jq .login`, then `gh project list --owner
  <login>` and `gh repo list <login> --limit 200`. If the person keeps their cards on a GitHub Projects (v2) board,
  that is the `board` key: `project_id`, the `PVT_…` node id (`gh project view <number> --owner <login> --format json`
  has it), plus the option ids of the board's Status and Priority fields in `lanes` and `priorities` (`gh api graphql`
  with the project's `fieldValues` will give them). In `tickets`, name the lanes the page should watch: `each` for the
  ones that wait on the person, `count` for the ones worth a number, `all` for every lane in board order. `label_repos`
  is for a repo that keeps its lane in an issue label instead of on the board. No board or no `gh`: leave `board` and
  `tickets` out, and in `actions_minutes` put the Actions minutes a month the person's GitHub plan includes
  (`gh api user --jq .plan.name` says which plan) only if the page does not read it right; otherwise leave it out.
- `machines`: this machine as `{"name": "<what the person calls it>"}`, plus any other machine the person works on that
  you can read right now, `{"name": "vps", "ssh": "user@host"}`. Confirm each remote before you write it:
  `ssh -o BatchMode=yes -o ConnectTimeout=5 <host> 'python3 -c "print(1)"'` must print 1. A host you cannot read would
  sit on the page as a red row forever, so leave it out and name it in your report.
- `repos_dir`: the folder that holds the repos, if it is not `~/code`. `verify_label`: only if the person has a verify
  tool that labels the Docker containers it runs (`<prefix>.run`, `<prefix>.commit`); otherwise leave it out.

Then
1. Write `config.json` in this folder: JSON, two-space indent, only the keys you found, in the order the README table
   lists them. Run `bun run check:config` and fix every key it names.
2. Start it: `bun install` if `node_modules` is missing, then `bun run build`, then `bun start` (or
   `COLLECTOR_PORT=<a free port> bun start` if 4000 is taken). Run it in the background and leave it running.
3. Look at what the page found, through its API: `curl -s http://127.0.0.1:<port>/api/state`, then `/api/tickets` if
   you wrote a board and `/api/projects` if you wrote `projects`. Check that the keys you wrote are the ones doing the
   work: each machine answered, the jobs you named show with their last run, the services are up or down as you found
   them, the vendors read, the board's lanes match the board. If a key you wrote returns nothing, fix it or take it
   out.
4. Report in a few lines: what each key found, what is empty and why, every key you left out with what you would need
   to fill it, and the URL to open. That report is the point of the exercise: the person should be able to see exactly
   what the page knows and what it does not.
```

## Check what it wrote

```bash
bun run check:config          # names any key Collector does not read; exits 1 on one
```

That is the same list the app checks: an unknown key in `config.json` also shows as a row in Needs attention, so a
typo cannot hide. The whole list of keys is the `Config` interface in `lib/server/config.ts`, and the README's
"Configure it" table explains each one.

## What the prompt touches

`config.json` and nothing else. No secret goes in it: keys stay in `.env` (gitignored), and `config.json` only names
the `.env` line that holds one. Nothing else on the machine is read for writing, and nothing is installed, restarted
or changed — after the prompt your machine holds one more file, its Collector settings, and a page showing it.

## If you would rather do it by hand

```bash
cp config.example.json config.json   # then edit it
```

Every key is optional and the README table documents them all. With no `config.json` at all Collector still runs: it
shows the Hermes cron jobs of the machine it is on.
