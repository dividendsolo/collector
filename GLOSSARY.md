# Collector

Collector is one local page, on the owner's own machine, that shows his machines, cards, agents, jobs and vendors: what is running now, what failed, what waits on him and what it costs. It reads; the only things it changes are what he clicks.

## Language

### The page

**Collector**:
The page itself, served from the owner's own machine and reached in his browser.
_Avoid_: dashboard app, the site, the UI

**Page**:
One screen of Collector, such as the Dashboard, Work, Network or Briefs page.
_Avoid_: view, tab, screen, section

**Panel**:
One box on a page, holding its own reading: Priority tasks, Crew, Service health, AI usage, Jog and GitHub limits.
_Avoid_: card, widget, tile, section

### Machines

**Machine**:
One computer Collector reads, under the name it is given in the page's own settings.
_Avoid_: host, server, box, node

**Snapshot**:
Everything Collector read from one machine at one moment: its jobs, ports, connections, gateway and briefs.
_Avoid_: poll, read, dump

**Stale**:
Said of a row drawn from a snapshot older than the page's own read interval. A stale row shows its age instead of its state.
_Avoid_: old, outdated, late

**Tailnet**:
The private network Tailscale builds between the owner's own machines. A port reachable there is not reachable from the internet.
_Avoid_: VPN, mesh, overlay

### Cards

**Card**:
One issue on the Board, with a Status and a Priority.
_Avoid_: ticket, task, item, issue

**Board**:
The GitHub project that holds the Cards.
_Avoid_: project, backlog, Big Board

**Status**:
The one lane a Card sits in, from the agent stack's own list, such as needs-triage, agent-in-progress or closed.
_Avoid_: column, state, stage

**Priority**:
A Card's urgency: none, P0, P1 or P2.
_Avoid_: severity, rank, importance

**Waiting on you**:
The Cards that wait on the owner: every Card in a waiting Status.
_Avoid_: inbox, queue, my list

**Open card**:
A Card in no done Status, so the page counts it as unfinished.
_Avoid_: active card, live card

**Journey**:
One Card's whole history: every Status it passed through, who moved it, when, how long it stayed and why.
_Avoid_: timeline, log, history

**Ask**:
The one thing the owner must do before a Card can move again, written on the Card when a machine stops with a question.
_Avoid_: question, blocker, request

**Claim**:
A machine's own note on a Card that it is building or reviewing that Card.
_Avoid_: lock, assignment, pickup

**Run**:
One machine's pass over one Card, from the Claim to the Card's next move.
_Avoid_: job, attempt, session

### The crew

**Crew**:
The Foreman, its building and reviewing Positions, and the Waiting crew on one machine.
_Avoid_: team, workers

**Foreman**:
The job that starts a machine on one Card when that Card's turn comes.
_Avoid_: scheduler, dispatcher

**Position**:
One slot on a machine that a run can take: build-1, build-2 or review. It is free, held or paused.
_Avoid_: seat, worker, runner, slot

**Waiting crew**:
The job that checks the Cards that wait on the owner.
_Avoid_: triage bot, checker

### Jobs and agents

**Job**:
A thing a machine runs on a schedule and the page reads: a Hermes cron job, a launchd job, a crontab line or a systemd timer.
_Avoid_: task, cron, schedule

**Session**:
A running coding agent, Claude Code or Codex, on a machine.
_Avoid_: agent, worker, process

**Watch entry**:
An agent or Job of the owner's own that the page reads, with the signal that says how it is doing.
_Avoid_: monitor, probe, check

**Busy**:
A Watch entry's state while its process or Session is running, or its Job holds a pid.
_Avoid_: running, active

**Ok**:
A Watch entry's state when nothing is running and nothing is wrong.
_Avoid_: fine, healthy, clear

**Idle**:
A Watch entry's state when its process, Session or file is missing, or its file is older than the entry's own limit.
_Avoid_: asleep, stopped, quiet

**Failed**:
A Watch entry's state when its last run failed.
_Avoid_: broken, down, error

### Briefs

**Brief**:
One report that a Job writes for the owner, such as "Lead Watch - 2026-11-06 - 4 leads".
_Avoid_: report, digest, email

**Inbox**:
Every Brief that is not Archived, oldest first. The count on the Briefs link is the number of Briefs in the Inbox.
_Avoid_: unread list, queue

**Read**:
A Brief the owner has opened. A Read Brief stays in the Inbox, dimmed, until it is Archived.
_Avoid_: seen, opened, done

**Archived**:
A Brief the owner has finished and archived. It leaves the Inbox for the Archived section and is never counted again. Only the owner archives a Brief; a skill never does.
_Avoid_: processed, acknowledged, marked as read, deleted

### Alerts and news

**Priority tasks**:
The Dashboard panel that lists what needs the owner now, one Row per thing.
_Avoid_: alerts, notifications, inbox, todos

**Row**:
One line of Priority tasks: one thing that needs the owner, with its age, its level (an error or a warn) and its own action.
_Avoid_: item, entry, alert

**Acknowledge**:
The click that takes one Row, and its Toast, off the list until what it names really changes.
_Avoid_: dismiss, resolve, clear, read

**Dismiss**:
The click that takes a Toast off the screen. A red Toast has none, and an amber one comes back when the value that raised it changes.
_Avoid_: acknowledge, close, hide

**Toast**:
The small card in the page's own corner: a problem while the problem lasts, or a Job's good news until it is acknowledged.
_Avoid_: popup, alert, banner, notification

**Notice**:
One line of good news a Job writes on a machine for the page to show.
_Avoid_: message, news item, alert

### The machine's state

**Reach**:
Who can connect to a listening port: the internet, the local network, the Tailnet, the machine alone, or firewalled.
_Avoid_: exposure, access, visibility

**Firewalled**:
Reachable from the internet, but only by a rule someone wrote, so it is open on purpose and raises no warning.
_Avoid_: allowed, whitelisted

**Security check**:
One line of a machine's security rubric, with a dot for green, amber, red or grey.
_Avoid_: audit, scan, test

**Going out**:
The connections a machine has made to somewhere else.
_Avoid_: outbound, egress, traffic

**Service**:
One site the page checks for health.
_Avoid_: site, endpoint, monitor, uptime check

**Roast**:
The latest score PageRoast gave a Service, with the day it was made.
_Avoid_: score, rating, audit

**Vendor**:
One outside company the page reads a status page, an API limit or a bill from.
_Avoid_: provider, supplier, third party

**Criticality**:
How much one Vendor's outage matters: low, medium, high or critical.
_Avoid_: severity, importance

### Projects and money

**Project**:
One repository the page shows a Row for, under its owner and name.
_Avoid_: repo, codebase

**Stage**:
The part of its life a Project is in: idea, development, testing, production or archived.
_Avoid_: phase, status, state

**Subscription**:
One repeating payment the page reads a renewal day for.
_Avoid_: plan, bill, contract

**Proposal**:
One offer to a client and where it stands: draft, pending, approved, rejected or signed.
_Avoid_: quote, estimate, contract, bid

**Pipeline**:
The value of the Proposals still open, draft, pending and approved, added up per currency.
_Avoid_: forecast, backlog, funnel

### The running page

**Served build**:
The release the running server booted on, which is what every open Page shows.
_Avoid_: live build, current build, deploy

**Staged build**:
A release that is built and waits to be swapped in.
_Avoid_: pending build, next build

**Rebuild job**:
The Job that keeps the Served build current after a merge, by building, swapping in and restarting.
_Avoid_: updater, deployer, CI

**Restart**:
The few seconds while the server comes back on a new build, when every open Page reloads itself.
_Avoid_: reboot, downtime, deploy
