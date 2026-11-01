# Lookout, Mission Control and Collector: what overlaps, what is worth porting

Investigation for collector#44 (James, 2026-11-01). Lookout lives at `dividendsolo/lookout` and Mission Control at
`dividendsolo/mission-control`; this is a read-only comparison of each with Collector, one section per app, each with
a feature table, a port list and one recommendation line. No code changed in any of the three repos.

## Lookout

Two things to know before the table:

- **Lookout is pre-code.** At `main` it is a single commit (`a087009`, pushed 2026-09-30) of docs: no
  `package.json`, no source. Its own `AGENTS.md` says "This repo is pre-code: the architecture is decided in ADRs but
  not yet implemented." So every Lookout row below is read out of its `CONTEXT.md`, `AGENTS.md`, `docs/adr/`,
  `research/` and `docs/repo-standard.md` — there is no Lookout code to compare, and the hour estimates are
  estimates against its ADRs, not against a codebase.
- **Lookout is a private repo and Collector's is public.** Every row therefore cites the Lookout file it came from
  and states the decision in summary; this doc quotes nothing verbatim beyond a term or a knob name.

### Every Lookout feature, against Collector

"In Collector" is `yes` (Collector already does this), `partly` (Collector does part of it, or the thing exists in
another shape), or `no`.

| Feature | In Collector | What it would add to Collector | Lookout source |
|---|---|---|---|
| Tenancy: one Deployment per Org, every Session visible Org-wide | no | A second viewer. Collector is one person's local page with no user and no login (`AGENTS.md`: "no database, no auth"), so there is nobody to share a session with. | `docs/adr/0001-org-scoped-deployment.md` |
| Users and sign-in: email + password, an admin creates each User, per-User bearer tokens minted in the UI | no | A login and per-person attribution. Same reason: Collector has no Users at all. | `research/v2-architecture-decisions.md` (parked Q7a); `CONTEXT.md` (User) |
| Author and Spectator as distinct roles on one Session | no | Naming who ran a session and who is watching it. With one person both roles are one person, which is what Collector's rows already assume. | `CONTEXT.md` |
| Collector Install identity: an id, hostname, collector version, last seen | partly | A record of the reader side. Collector names its machines in `config.json` and keeps a `stale` flag with the error when a machine's last read failed or aged out (`lib/server/machines.ts:97-110`), but there is no install id and no reader version. | `research/v2-architecture-decisions.md` (`collector_installs` schema) |
| Agent Run and Session as first-class records, Session identified as `<agent>:<native_session_id>` | partly | A session identity that outlives the process. Collector names the tool and the folder of a *running* session (`collect.py` `tool_sessions()`), and keeps nothing once it exits. | `CONTEXT.md` |
| Hooks + Relay: an installer writes hook entries into each agent's settings file, idempotent, dry-run, clean uninstall | no | Nothing to install. Collector's whole premise is that it changes nothing on a machine: one `curl`-less `ssh <host> python3 -` per refresh, and its only write is the projects key in `config.json`. | `docs/adr/0002-hook-spawned-daemon.md`; `research/v2-architecture-decisions.md` (Hook-installer safety) |
| A long-lived per-machine Collector daemon, spawned lazily by the agent's own hooks (no launchd/systemd unit) | no | A process on each machine to keep alive. Collector has the opposite design on purpose: no install, no daemon, `collect.py` runs from source over ssh on every read. | `docs/adr/0002-hook-spawned-daemon.md` |
| Outbox: local SQLite queue of Events, survives restarts, retries while offline | no | Buffering so a read is never lost. Collector does the same job with less: it keeps each reader's last good answer and serves it marked `stale` (`lib/server/machines.ts:102-110`). | `CONTEXT.md`; `docs/adr/0005-postgres-only-server-storage.md` |
| Per-Agent adapters converging on one normalized Event schema | partly | Copilot CLI and opencode rows. Collector reads Claude Code and Codex only, and reads the process and the model out of the session file, not events. | `research/coding-agent-ingestion.md` |
| Claude Code capture: ~25 hooks per-event, plus transcript backfill for tokens | partly | The session's actual timeline. Collector opens the newest transcript line for the model name and keeps nothing else out of that file, by design (README: "Only the model name is taken out of those files; their content is never kept"). | `research/coding-agent-ingestion.md` (Claude Code) |
| Codex capture: 6 hooks per-event, plus rollout-file backfill | partly | Same gap as Claude Code: model name only. | `research/coding-agent-ingestion.md` (Codex CLI) |
| Copilot CLI capture: file-tail of `~/.copilot/session-state/*/events.jsonl`, because its hooks are too thin for a session model | no | A third agent in the Running now table, plus the gotchas that come with it (no session id in the hook payload, checkpoint rewrites). | `research/coding-agent-ingestion.md` (GitHub Copilot CLI) |
| opencode capture: HTTP/SSE pull from its own local server (`127.0.0.1:4096/event`) with REST backfill | no | A reader over an agent's API rather than its files. | `research/coding-agent-ingestion.md` (opencode) |
| OTel scrape for cost and token metrics (Claude Code first-class; opencode opt-in) | no | A run's real dollars. Collector shows plan balances and subscriptions on its AI page and never a run's cost. | `research/coding-agent-ingestion.md` (Claude Code, opencode tables) |
| The per-file gotchas: `/compact` rewriting Claude's JSONL, Codex `--ephemeral`, Copilot checkpoints, opencode's mutable `tool` part | no | The knowledge, not the code: any future Collector reader of these files needs these five rules or it double-counts. | `research/coding-agent-ingestion.md` (each agent's Gotchas) |
| Next.js App Router monolith: UI, ingest, SSE fan-out and query in one process | yes | Nothing. Collector is the same shape: one Next process, one JSON route per reader under `app/api/`, one client app in `components/`. | `docs/adr/0004-nextjs-monolith.md`; collector `AGENTS.md` |
| In-process pub/sub, no external broker at one-container scale | yes | Nothing. Collector keeps one cache on `globalThis` shared by every route (`lib/server/store.ts`), which is the same idea with a different transport. | `docs/adr/0003-live-spectate-via-sse.md`; `docs/adr/0004-nextjs-monolith.md` |
| Postgres-only server storage, `JSONB` + `TSVECTOR`, operator brings their own | no | A database. Collector has none and wants none; every reader holds its own in-memory cache (`lib/server/cache.ts`). | `docs/adr/0005-postgres-only-server-storage.md` |
| Session / Event / Turn schema: per-session monotonic sequence, `ts` informational, token columns, denormalized rollups | no | Any history of a run. Collector's only run history is a cron job's last 10 executions, from Hermes's own `executions.db`. | `research/v2-architecture-decisions.md` (Tower storage schema); `CONTEXT.md` (Turn) |
| Tree-aware Sessions: `parent_session_id`, recursive descendant queries | no | Subagent rows. A Claude Code `Task` subagent is invisible on Collector's page today, which is the run most worth watching. | `docs/adr/0006-tree-aware-sessions.md` |
| Live-Spectate: per-Event push, SSE fan-out to spectator browsers, sub-second, `?include=descendants` | partly | Watching a run instead of a process. Collector already runs one SSE route (`app/api/events`, board lane changes) and one poller (`lib/server/board.ts`), so the fan-out half exists; nothing streams an agent's own events. | `docs/adr/0003-live-spectate-via-sse.md` |
| Session list and per-session drill-down: turns, tool calls, per-session metrics | no | The cron-job treatment for agent runs. Collector gives a cron job its own page (schedule, prompt, last 10 runs, last error — `components/cron.tsx`) and gives a session a single live row. | `research/v2-architecture-decisions.md` (Tower routes and UI) |
| Review: one free-text note per Session, overwritten on edit | no | A place to say "I read this run". Collector writes nothing but the projects key in `config.json`. | `CONTEXT.md` (Review); `research/v2-architecture-decisions.md` (`reviews` table) |
| Review Inbox: each User's queue of Sessions where they are the DRI and no Review has been left | no | Collector's nearest thing is the Waiting on you panel, which is the board's cards, not agent runs. | `CONTEXT.md` (Review Inbox); `docs/adr/0007-dri-assignment-policy.md` |
| DRI: the author is the DRI by default, anyone may reassign, children inherit from the parent, every move audited | no | One named reader per run, and the audit row answering "why is this in my queue". With one user this is the author on every row. | `docs/adr/0007-dri-assignment-policy.md` |
| Full-text search over prompts and assistant text (`TSVECTOR` + GIN) | no | Searching what an agent was asked. Collector's only search box filters the repo picker (`components/projects.tsx:77`). | `research/v2-architecture-decisions.md` (Search parked; `sessions.search`) |
| Retention policy for stored Events | no | A rule, not a feature. Collector stores no Events, so it has nothing to expire. | `research/v2-architecture-decisions.md` (Retention) |
| Cost normalization: recompute Tower-side from a price table, keep the client's number for diffing | no | An honest dollar per run, rather than a plan balance. | `research/v2-architecture-decisions.md` (Cost / token normalization) |
| A human CLI: `lookout-agent install/forward/status/doctor`, `lookout login`, `lookout sessions tail` | no | Nothing Collector wants. Its one CLI-shaped thing is `collect.py`, a snapshot script written for `ssh`, with no subcommands and no state. | `research/v2-architecture-decisions.md` (parked Q8); `CONTEXT.md` (Spectator) |
| One artifact, one port, one container; a BYO Postgres URL is the deploy | partly | One process on one port, yes; Docker, deploy and a container image, no. Collector is local only and its README says so. | `docs/adr/0001-org-scoped-deployment.md`; `docs/adr/0005-postgres-only-server-storage.md` |
| Co-presence: who else is watching this Session right now | no (deferred in Lookout too) | Nothing until there is a second viewer, which is the same answer Lookout gave itself. | `docs/adr/0003-live-spectate-via-sse.md` (deferred) |

#### Repo process, not product features

Named for completeness, since they are in Lookout's docs and would otherwise look like an omission. None of them
is something to port into a product.

| Item | In Collector | What it would add | Lookout source |
|---|---|---|---|
| Single-context domain docs: a `CONTEXT.md` glossary plus `docs/adr/` decisions | partly | Collector has a `CONTEXT.md` and an `AGENTS.md`, and no ADRs and no glossary of its own; the reasoning sits in code comments and PR bodies. | `docs/agents/domain.md`; `CONTEXT.md`; `docs/adr/` |
| An Obsidian knowledge vault as the first source of truth | no | Nothing Collector wants: its docs are four files, and it is not maintained by a team. | `AGENTS.md` (Knowledge vault); `docs/lookout-vault/_index.md` |
| Work tracked as GitHub issues with the Big Board lanes as state | yes | Nothing. Both repos run the same habit, `lane` plus issues; Collector's own page reads it. | `docs/agents/issue-tracker.md`; `docs/agents/triage-labels.md` |
| The repo standard audit | no | Nothing: Lookout is opted out ("preview prototype", `docs/repo-standard.md`). | `docs/repo-standard.md` |

### Lookout: worth porting, smallest first

Five items. Each fits Collector's read-only, no-database, no-install design; the hours are working hours for one
agent including tests, and they assume the collector#44 investigation is what they start from.

1. **Per-session tokens and cost on the Running now row — 3–5 h.** Read the newest `usage` block out of the
   transcript `collect.py` already opens for the model name (`claude_model()`, `codex_model()`), show
   input/output/cache tokens on the row, and price them from a small local rate card. Lookout's source:
   `research/coding-agent-ingestion.md` (Claude Code `usage` blocks and OTel; the normalized `tokens` and
   `cost_usd` fields). What it buys: the AI page shows a plan's balance, this shows *which session* is spending it,
   which is the question the page is actually asked.
2. **Subagent rows under their parent session — 4–6 h.** A `Task` subagent gets its own row under the session
   that spawned it, the way a worktree process gets its own row today. Linkage comes from the transcript's
   `parentUuid` chain or Claude Code's `SubagentStart` payload. Lookout's source:
   `docs/adr/0006-tree-aware-sessions.md`. What it buys: the autonomous twenty minutes is where an agent goes
   wrong, and it is the one thing currently invisible.
3. **A reviewed / unreviewed mark on a session row — 5–8 h.** The smallest honest form of Lookout's Review: one
   note per session, kept in a JSON file beside `config.json` (not a database), with a filter for the ones nobody
   has read. Lookout's source: `CONTEXT.md` (Review) and `docs/adr/0007-dri-assignment-policy.md`. **This one
   breaks a rule on purpose** — Collector's only write today is the projects key — so it needs James's yes before
   anyone builds it; it is listed because it is the cheapest half of the half of Lookout that Collector does not
   have.
4. **One agent session's own page — 10–14 h.** Turns, tool calls, tokens and the last N sessions in that folder,
   on a page reached from the Running now row. Lookout's source: `research/v2-architecture-decisions.md` (the
   Tower query API and UI over the `sessions`/`events` schema). The model is already in Collector: a cron job's
   own page does exactly this for jobs (`components/cron.tsx`), so this is a new reader in `lib/server/` plus a
   page, not new architecture.
5. **Live-Spectate one running session — 14–20 h.** An SSE tail of the session's own events onto that page, the
   thing Lookout calls its v1 requirement. Lookout's source: `docs/adr/0003-live-spectate-via-sse.md` (per-Event
   push plus server fan-out; SSE chosen over WebSockets because it is one-way). Collector already has the SSE
   route, the poller and the self-reloading page, so the new part is tailing a transcript and fanning its events
   out.

**Not worth porting, and why.** The Org / Users / DRI / Review Inbox half needs a server, a database and auth for a
team of one, and Collector's value is that it has none of those. The Tower's Postgres storage, the hook installer
and per-machine daemon with its Outbox, the OTel scrape, full-text search and the container deploy all buy
guarantees that a local page read over `ssh` gets more cheaply (`stale` marks instead of a queue, the transcript
instead of an OTLP endpoint). Co-presence was deferred by Lookout itself. Copilot CLI and opencode capture are
worth only what a machine of James's runs of those agents, and today none does — `collect.py` recognises `claude`
and `codex` and nothing else.

### Lookout: recommendation

Port the five items above into Collector (3–20 hours each, about 40 hours for all of them, and each one shippable
on its own) and leave Lookout as it is: its docs stay the reference for the session model, and none of its server
half is built.

## Mission Control

Three things to know before the table:

- **Collector already took Mission Control's shape.** Collector's sidebar has the same six pages under the same
  names — Projects, Domains, Services, APIs, Subscriptions, Proposals (`components/app.tsx:22-27`; Mission Control's
  `components/nav.tsx`) — and most of them read the real thing where Mission Control has a form to type it into. So
  this table is mostly about the fields Mission Control keeps that Collector does not.
- **Mission Control is a prototype nobody maintains.** At `main` it is one commit (`6880e83`, pushed 2026-09-30), its
  `docs/repo-standard.md` opts it out of the repo standard as a preview build that is not maintained, and its issue
  tracker holds no issues and no pull requests, open or closed. It has no `CONTEXT.md`, and its `AGENTS.md` holds only
  the Next.js notice, so every row is read from its `README.md`, its one ADR and its code.
- **Mission Control is a private repo and Collector's is public.** As in the Lookout section, every row cites the file
  it came from and states what it does in summary. Its committed `data/seed.db` and `scripts/seed.ts` hold sample
  rows; this doc names none of them.

### Every Mission Control feature, against Collector

| Feature | In Collector | What it would add to Collector | Mission Control source |
|---|---|---|---|
| Projects: name, description, hosting, repo URL, live URL | yes | Nothing. Collector reads each of these from GitHub (description, homepage, archived) and works the host out from the deploy bot or the repo's files (`lib/server/projects.ts:44-83`), where Mission Control has them typed in. | `lib/types.ts` (`Project`); `app/projects/project-form.tsx` |
| Project stage set by hand: idea, development, testing, production, archived | partly | An `idea` and a `testing` stage. Collector derives Production, Preview, Development or Archived from the live site and the repo (`components/projects.tsx:34-40`), so a project with no repo yet cannot appear at all, and testing reads as Development. | `lib/types.ts` (`PROJECT_STATUSES`); `components/status.tsx` |
| A notes line on every record (projects, domains, services, APIs, subscriptions, proposals) | no | Free text beside a row. Collector's records live in `config.json`, which has no notes field on any of them (`lib/server/config.ts:4-26`). | `lib/db.ts` (every table has `notes`) |
| Domains: registrar, expiry date, auto-renew | yes | Nothing. Collector reads registrar and expiry from RDAP or whois, auto-renew from Cloudflare and Vercel, and the certificate's expiry too (`lib/server/domains.ts`); Mission Control has each typed in. | `lib/types.ts` (`Domain`); `app/domains/domain-form.tsx` |
| Domain status set by hand: active, expiring, expired, transferring, parked | partly | A `transferring` and a `parked` state. Collector shows expiry as days left, amber at 30 and red at 7 (`components/pages.tsx:8-14`), and has no word for a domain mid-transfer or parked. | `lib/types.ts` (`DOMAIN_STATUSES`) |
| A domain linked to a project | no | A project's own domains on its page. Mission Control links them by a project id typed into the form; Collector's `domains` key is a plain list of names (`lib/server/config.ts:61`), and a project's page shows no domain. | `lib/db.ts` (`domains.project_id`); `app/domains/page.tsx` (Project column) |
| Domains expiring in the next 60 days, on the dashboard | yes | Nothing. Collector's Needs attention names a domain inside 30 days, one inside 60 with auto-renew off, and a certificate inside 14 (`lib/server/warnings.ts:92-100`). | `lib/repo/domains.ts` (`expiringSoon`); `app/page.tsx` |
| Services: own services and their health (online, degraded, down, maintenance, unknown), last checked | yes | Nothing. Collector GETs each service once a minute and calls it online, slow or down, with the host from its headers (`lib/server/services.ts`); Mission Control's status is a pill someone sets, with a "mark status" action that stamps the time. | `lib/types.ts` (`Service`); `app/services/actions.ts` (`markStatusAction`) |
| A `maintenance` service state | no | A planned-downtime word. Collector's check cannot tell maintenance from down. | `lib/types.ts` (`SERVICE_STATUSES`) |
| A service linked to a project | partly | Nothing new. Collector matches a service to the project of the same name for the project's live site and health (`lib/server/projects.ts:102-108`). | `lib/db.ts` (`services.project_id`) |
| APIs: third-party APIs, provider, status (operational, degraded, outage, unknown), status-page link | yes | Nothing. Collector reads each vendor's status feed every five minutes (Statuspage, Datadog, Better Stack, Stripe, X, Google Cloud: `lib/server/vendors.ts`) and links the page; Mission Control's status is set by hand. | `lib/types.ts` (`Api`); `app/apis/page.tsx` |
| API criticality: low, medium, high, critical | partly | A ranking. Collector's nearest thing is the `attention` flag on a vendor, which puts its open incidents in Needs attention (`lib/server/warnings.ts:118`): one level, not four. | `lib/types.ts` (`API_CRITICALITIES`); `components/status.tsx` (`CriticalityPill`) |
| Subscriptions: name, amount, currency, billing, status | yes | Nothing. Collector keeps the same fields in `config.json` (`lib/server/config.ts:20-27`) and shows them largest first (`components/pages.tsx:410-416`). | `lib/types.ts` (`Subscription`) |
| Subscription vendor, renewal date, trial and paused states | partly | A renewal date, and a list sorted by it. Collector's subscriptions have no date at all, so nothing warns before a charge; a `status` field exists, and only `active` counts toward the total (`components/pages.tsx:413`), so a trial drops out of it. | `lib/types.ts` (`Subscription.renews_at`, `SUBSCRIPTION_STATUSES`); `lib/repo/subscriptions.ts` (sorted by renewal) |
| Monthly burn: annual ÷ 12, quarterly ÷ 3, one-time left out, per currency | partly | The right total. Collector's `monthly()` divides annual by 12 and takes every other billing at face value (`lib/format.ts:127`), so a quarterly charge counts three times over and a one-time charge counts every month. | `lib/repo/subscriptions.ts` (`monthlySpend`) |
| Proposals: client, title, amount, currency, status (draft, pending, approved, rejected, signed), sent and decided dates | no | The page itself. Collector's Proposals page is a placeholder that says no source is chosen yet (`components/pages.tsx:637-651`). | `lib/types.ts` (`Proposal`); `app/proposals/page.tsx` |
| Pipeline: the open proposals' value (draft, pending, approved), per currency | no | One number for what is out with clients. Nothing in Collector counts it. | `lib/repo/proposals.ts` (`pipelineValue`); `app/page.tsx` (Pipeline card) |
| Dashboard: count tiles (projects in production, domains expiring, services down, API issues), monthly spend, pipeline, recent proposals, active projects | partly | Count tiles and a pipeline card. Collector's dashboard leads with Needs attention, Work, Waiting on you, AI credits and Service health (`components/dashboard.tsx`), which name the domain, service or vendor in trouble instead of counting them. | `app/page.tsx` |
| Create, edit and delete every record in the page: a form per type, server actions, a confirm before delete | no | Editing in the browser. Collector's only write is the projects picker (`POST /api/projects`, `AGENTS.md`); everything else is `config.json` edited by hand. | `app/*/actions.ts`; `app/*/[id]/edit/page.tsx`; `components/delete-button.tsx` |
| SQLite storage: one file, WAL journal, a path override, a committed seed copied in on first boot | no | A database. Collector has none and wants none (`AGENTS.md`: "no database"). | `lib/db.ts`; `README.md` (Data) |
| A Fly.io deploy: Dockerfile, `fly.toml`, one volume, a URL to share | no | A hosted copy. Collector is local only; Mission Control's one ADR says it sits on Fly only because SQLite needs a disk that lasts. | `Dockerfile`; `fly.toml`; `docs/adr/0001-fly-io-over-vercel.md` |
| Single user, no login | yes | Nothing. Same in both. | `README.md` |
| Next.js App Router, TypeScript strict, Tailwind v4, Lucide icons | yes | Nothing. Same stack; Collector runs on Bun with Biome where Mission Control uses ESLint, and draws its own icons. | `package.json`; `README.md` (Stack) |

#### Repo process, not product features

| Item | In Collector | What it would add | Mission Control source |
|---|---|---|---|
| A fleet-wide secrets inventory (key names only, per repo and machine) | no | Nothing for Collector's product. It is a fleet note that happens to live in this repo; if it is still wanted, it belongs with the fleet's other docs, not in Collector. | `docs/secrets-inventory.md` |
| An ADR folder | no | Collector keeps its reasons in `CONTEXT.md`, code comments and PR bodies, as the Lookout section notes. | `docs/adr/0001-fly-io-over-vercel.md` |
| Opted out of the repo standard | no | Nothing. | `docs/repo-standard.md` |

### Mission Control: worth porting, smallest first

Four items. Each keeps Collector's rules: `config.json` stays the record and the only write stays the projects
picker. A new top-level key also goes into `CONFIG_KEYS` (`lib/server/config.ts:76`), or Needs attention flags it as
a key Collector does not read.

1. **Quarterly and one-time billing in the monthly total — 1 h.** `monthly()` (`lib/format.ts:127`) divides a
   quarterly amount by 3 and gives a one-time charge 0, with a test for each. Mission Control's source:
   `lib/repo/subscriptions.ts` (`monthlySpend`). What it buys: a correct total the day a quarterly plan goes into
   `config.json`, which today would count it three times over.
2. **A renewal date on a subscription, and a warning before it — 2–3 h.** An optional `renews` date on a
   `config.json` subscription, a Renews column on the Subscriptions page, and a Needs attention row a week out, beside
   the domain rows (`lib/server/warnings.ts:92`). Mission Control's source: `lib/types.ts` (`Subscription.renews_at`),
   `lib/repo/subscriptions.ts` (sorted by renewal). What it buys: an annual charge stops arriving as a surprise.
3. **A project's domains on its page — 2–3 h.** Match each `domains` entry to the host of the project's live site,
   which `lib/server/projects.ts:109` already works out, and show the domain's expiry, auto-renew and certificate on
   the project's page. Mission Control's source: `lib/db.ts` (`domains.project_id`). Collector derives the link
   instead of asking for it, so there is no new config key.
4. **The Proposals page and a pipeline total — 3–5 h.** A `proposals` list in `config.json` (client, title, amount,
   currency, status, sent, decided) with Mission Control's five statuses, drawn into the placeholder page
   (`components/pages.tsx:637`) with the open pipeline per currency at its foot. Mission Control's source:
   `lib/types.ts` (`Proposal`), `lib/repo/proposals.ts` (`pipelineValue`), `app/proposals/page.tsx`. The placeholder
   says no source is chosen yet; `config.json` is the cheapest one, and a Polar or Stripe invoice reader is the other
   choice if proposals should come from where they are actually sent.

**Not worth porting, and why.** The forms, the server actions and the SQLite file are the half of Mission Control
that Collector exists not to have: it reads the real thing where Mission Control asks for it to be typed, which is
why Collector's Domains, Services and APIs pages already beat their Mission Control twins. The hand-set statuses
(service health, API status, domain status, project stage) lose to a live read for the same reason; the two words a
live read cannot give (`maintenance`, `transferring`) have not been needed yet. API criticality is covered by the
`attention` flag. The Fly deploy exists only because of the database. The count tiles repeat what Needs attention
already says by name. A notes field on every record would be the first free text in `config.json`, for no question
the page is asked today.

### Mission Control: recommendation

Port the four items above into Collector (1–5 hours each, about 11 hours for all of them) and close Mission Control:
Collector already has its six pages, reads five of them live, and the four items are the rest.


## Sources read

Collector: `README.md`, `CONTEXT.md`, `AGENTS.md`, `collect.py`, `lib/server/`, `lib/format.ts`, `components/`, `app/api/`.

Lookout at `main` (`a087009`): `CONTEXT.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`,
`docs/adr/0001-org-scoped-deployment.md`, `docs/adr/0002-hook-spawned-daemon.md`,
`docs/adr/0003-live-spectate-via-sse.md`, `docs/adr/0004-nextjs-monolith.md`,
`docs/adr/0005-postgres-only-server-storage.md`, `docs/adr/0006-tree-aware-sessions.md`,
`docs/adr/0007-dri-assignment-policy.md`, `research/coding-agent-ingestion.md`,
`research/v2-architecture-decisions.md`, `docs/repo-standard.md`, `docs/lookout-vault/_index.md`,
`docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`. Its issue tracker holds
no open or closed issues, so no feature is sourced from one.

Mission Control at `main` (`6880e83`): `README.md`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `lib/types.ts`,
`lib/db.ts`, `lib/utils.ts`, `lib/repo/` (all six), `app/page.tsx`, `app/*/page.tsx`, `app/*/actions.ts`, the forms
under `app/*/`, `components/nav.tsx`, `components/status.tsx`, `components/delete-button.tsx`, `Dockerfile`,
`fly.toml`, `docs/adr/0001-fly-io-over-vercel.md`, `docs/repo-standard.md`, `docs/secrets-inventory.md`,
`scripts/seed.ts`. It has no `CONTEXT.md`. Its issue tracker holds no issues and no pull requests, open or closed, so
no feature is sourced from one.
