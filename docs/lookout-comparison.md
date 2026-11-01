# Lookout and Collector: what overlaps, what is worth porting

Investigation for collector#44 (James, 2026-11-01). Lookout lives at `dividendsolo/lookout`; this is a read-only
comparison of the two, with the table, the port list and one recommendation line. No code changed in either repo.

Two things to know before the table:

- **Lookout is pre-code.** At `main` it is a single commit (`a087009`, pushed 2026-09-30) of docs: no
  `package.json`, no source. Its own `AGENTS.md` says "This repo is pre-code: the architecture is decided in ADRs but
  not yet implemented." So every Lookout row below is read out of its `CONTEXT.md`, `AGENTS.md`, `docs/adr/`,
  `research/` and `docs/repo-standard.md` — there is no Lookout code to compare, and the hour estimates are
  estimates against its ADRs, not against a codebase.
- **Lookout is a private repo and Collector's is public.** Every row therefore cites the Lookout file it came from
  and states the decision in summary; this doc quotes nothing verbatim beyond a term or a knob name.

## Every Lookout feature, against Collector

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

### Repo process, not product features

Named for completeness, since they are in Lookout's docs and would otherwise look like an omission. None of them
is something to port into a product.

| Item | In Collector | What it would add | Lookout source |
|---|---|---|---|
| Single-context domain docs: a `CONTEXT.md` glossary plus `docs/adr/` decisions | partly | Collector has a `CONTEXT.md` and an `AGENTS.md`, and no ADRs and no glossary of its own; the reasoning sits in code comments and PR bodies. | `docs/agents/domain.md`; `CONTEXT.md`; `docs/adr/` |
| An Obsidian knowledge vault as the first source of truth | no | Nothing Collector wants: its docs are four files, and it is not maintained by a team. | `AGENTS.md` (Knowledge vault); `docs/lookout-vault/_index.md` |
| Work tracked as GitHub issues with the Big Board lanes as state | yes | Nothing. Both repos run the same habit, `lane` plus issues; Collector's own page reads it. | `docs/agents/issue-tracker.md`; `docs/agents/triage-labels.md` |
| The repo standard audit | no | Nothing: Lookout is opted out ("preview prototype", `docs/repo-standard.md`). | `docs/repo-standard.md` |

## Worth porting, smallest first

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

## Recommendation

Port the five items above into Collector (3–20 hours each, about 40 hours for all of them, and each one shippable
on its own) and leave Lookout as it is: its docs stay the reference for the session model, and none of its server
half is built.

## Sources read

Collector: `README.md`, `CONTEXT.md`, `AGENTS.md`, `collect.py`, `lib/server/`, `components/`, `app/api/`.

Lookout at `main` (`a087009`): `CONTEXT.md`, `AGENTS.md`, `README.md`, `CLAUDE.md`,
`docs/adr/0001-org-scoped-deployment.md`, `docs/adr/0002-hook-spawned-daemon.md`,
`docs/adr/0003-live-spectate-via-sse.md`, `docs/adr/0004-nextjs-monolith.md`,
`docs/adr/0005-postgres-only-server-storage.md`, `docs/adr/0006-tree-aware-sessions.md`,
`docs/adr/0007-dri-assignment-policy.md`, `research/coding-agent-ingestion.md`,
`research/v2-architecture-decisions.md`, `docs/repo-standard.md`, `docs/lookout-vault/_index.md`,
`docs/agents/domain.md`, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`. Its issue tracker holds
no open or closed issues, so no feature is sourced from one.
