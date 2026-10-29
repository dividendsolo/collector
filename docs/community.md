# Where agent-heavy developers gather

Research for stage 1 (Idea) of the stage ladder: the audience Collector is built for is solo developers and small
teams who run many coding agents, cron jobs and background workers, often across more than one machine. This file
names where those people gather, ten of them who have written about the exact problem, and one message James could
send each. It is the `find-community` pass for Collector, written down so collector#12 (the paid cloud companion) has
something to test against.

The problem being checked, in the words of the people below: an agent or a scheduled job stops doing its work
without raising anything, and there is no single view of what ran, what is running, and what quietly stopped.

Nothing here has been sent. No DMs, no comments, no emails. Every message below is a draft for James to approve,
rewrite or drop.

## The places, five of them

### r/ClaudeAI

<https://www.reddit.com/r/ClaudeAI/>

Home of the largest group of people running Claude Code all day, including scheduled routines and always-on daemons
on their own hardware. The posts are specific and receipted, and the same shapes repeat: a daemon that has been up
for weeks, a list of jobs, and a count of the ones that stopped without saying so. The threads carry numbers
rather than opinions, which makes them easy to quote and easy to check.

Evidence it fits: [a daemon log audit where six of ten jobs had
died](https://www.reddit.com/r/ClaudeAI/comments/1srnkda/), and [a thread asking how anyone keeps an eye on
long-running agents and scheduled runs](https://www.reddit.com/r/ClaudeAI/comments/1vj71wj/) (both opened, both in
the list of ten below).

### r/AI_Agents

<https://www.reddit.com/r/AI_Agents/>

Agent builders rather than agent users. The threads that do well here are failure post-mortems and "what breaks
first" questions, which is where the pain is described rather than demoed. One of the ten below posted here, and
the same subreddit turned up the other two angles of the problem: long-horizon fleets, and the review layer after
an interruption.

### r/selfhosted

<https://www.reddit.com/r/selfhosted/>

The self-hosted and small-VPS crowd: people who run their own boxes, their own backups, and their own scheduled
jobs. They are the ones who already accept that a job can fail silently and have opinions about what to do about
it. [The thread asking how people monitor cron jobs and scheduled
tasks](https://www.reddit.com/r/selfhosted/comments/1turvx8/) drew 102 comments, more replies than anything else
found in this pass.

### Hacker News

<https://news.ycombinator.com/>

The Ask HN and Show HN threads on cron verification and heartbeat monitoring are where the same complaint gets
restated in engineering terms, often by people who have already tried three fixes.
[Ask HN: How do you verify cron jobs did what they were supposed to?](https://news.ycombinator.com/item?id=46717618)
is the cleanest single statement of the problem found anywhere in this pass: jobs that exit 0 and produce nothing.
It is also a good place to watch for the next thread, since these reappear every few months.

### The Claude Discord

<https://discord.gg/anthropic>

133,017 members, 25,828 online when this was checked. Real-time help for people running Claude Code and scheduled
routines, and the place a broken setup tends to get asked about the same day.

### Adjacent rooms, worth knowing about

Two more, both real and both linked, but a worse fit for the first round of conversations: r/Proxmox
(<https://www.reddit.com/r/Proxmox/>), where the multi-machine cron pain shows up from the homelab side, and r/n8n
(<https://www.reddit.com/r/n8n/>), where scheduled automation stops silently and people are unusually willing to
describe what it cost them.

## Ten people to talk to

Public handles, each with the post that shows the problem. The quotes are from the post or thread the link opens.

Each person also has one draft message: one line, under 300 characters, ready to send as it stands. The `marketing`
skill, section 7, says the first outreach message is one line. The link to the person's own post stays above it, so
the message can be checked against what they actually wrote.

### 1. u/lakshminp, r/ClaudeAI

[I audited my always-on AI agent. 6 of 10 cron jobs had silently stopped running and I didn't notice for a
month.](https://www.reddit.com/r/ClaudeAI/comments/1srnkda/) (April 2026)

Runs an always-on daemon: ten scheduled jobs, up 54 days. The audit counted actual runs in the log directory and
found three working, three dead and four limping. "morning-brief, scheduled daily at 6am. Last actual run: March
18. Full month of silence. I did not miss it."

Draft message (one line, 235 characters):

Your audit found 6 of 10 cron jobs had been dead for a month, and you never missed them. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 2. u/Significant_Aide_313, r/Proxmox

[My homelab automation became 12 unrelated cron jobs across 3 machines and I have no idea what failed last
night](https://www.reddit.com/r/Proxmox/comments/1wg90rl/) (September 2026)

The exact shape Collector is for: automation that grew from a folder of shell scripts into twelve jobs on three
machines, with no shared view. "Found out last week my backup job had been silently failing for 3 weeks." What the
post asks for sits between a folder of shell scripts and an enterprise scheduler: one central place to see what
ran and what failed, with retries.

Draft message (one line, 255 characters):

Your homelab became 12 unrelated cron jobs across 3 machines, and a backup had been failing for three weeks. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 3. u/Irudon, r/ClaudeAI

[How do you keep an eye on long-running agents and scheduled runs?](https://www.reddit.com/r/ClaudeAI/comments/1vj71wj/)
(August 2026)

Runs Claude Code sessions on a migration, scheduled agent runs and overnight batch jobs, each reporting progress a
different way: "one I tail, one posts to a Discord channel, one I just check on when I remember." What the post
wants: "one glanceable view of current state, last heartbeat, current step, done/failed, rather than scrolling a
log to reconstruct what's happening."

Draft message (one line, 263 characters):

Three runs each reporting a different way, and you wanted one glanceable view: last heartbeat, step, done or failed. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 4. u/Few-Ad-1358, r/AI_Agents

[People running 2-5 coding agents: what actually breaks first for
you?](https://www.reddit.com/r/AI_Agents/comments/1stu0we/) (April 2026)

Opens from the other side: running agents in parallel is solved, the control and review layer is not. The list of
what is still unresolved after worktrees, branches and routing rules includes "recovering context cleanly after
interruption" and "understanding what changed and why across runs".

Draft message (one line, 252 characters):

You said running agents in parallel is solved; the control and review layer after an interruption is not. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 5. u/danhof1, r/ClaudeCode

[Sick of workarounds for AI agents that lie about being alive](https://www.reddit.com/r/ClaudeCode/comments/1t0g4gm/)
(May 2026)

On liveness checks that lie. The thread settles on the file-mtime heartbeat: "The HTTP endpoint is a liveness
proxy that lies, the file mtime is tied to the loop actually running." An agent with a healthy port and a stale
heartbeat is a zombie that an uptime check will happily call up.

Draft message (one line, 259 characters):

You found the HTTP check is a liveness proxy that lies, and the file mtime is tied to the loop actually running. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 6. u/robotrossart, r/Applesilicon

[Running a fleet of 4 AI agents 24/7 on a Mac Mini, Flotilla v0.2.0](https://www.reddit.com/r/Applesilicon/comments/1rw8uuy/)
(March 2026)

Four coding agents on staggered ten-minute cycles as native launchd services, with a dispatcher, a database, a
dashboard and a Telegram bot: shared memory, persistent state, and scheduling handed to launchd rather than cron.
The multi-agent, single-host version of the setup, self-hosted and running around the clock.

Draft message (one line, 268 characters):

You run four agents around the clock on one Mac Mini, with a dispatcher and a dashboard you built to keep an eye on them. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 7. u/bagrat_hakobyan, r/selfhosted

[Do you monitor cron jobs and scheduled tasks on your servers?](https://www.reddit.com/r/selfhosted/comments/1turvx8/)
(June 2026)

Asks the question directly of people running VPSs and home servers, and separates the two failures well: "many
failures aren't caused by the server going down, but by background jobs silently stopping. The server itself is
healthy, but the automation isn't." 102 comments, mostly tool names.

Draft message (one line, 232 characters):

Your point was that the server stays healthy while the background jobs silently stop. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 8. u/masani3llo, r/n8n

[How did you find out an n8n workflow silently stopped?](https://www.reddit.com/r/n8n/comments/1w75q6m/)
(September 2026)

Runs scheduled workflows, some for clients, and asks the two questions that matter for pricing a solution: how did
you find out, and "what did it actually cost you when it happened? Just the time to fix it, or something worse?"
53 comments. A follow-up in the thread is the sharp one: a workflow that reports success and quietly produces
nothing, which a green-tick execution list will never show.

Draft message (one line, 247 characters):

You asked what a silently stopped workflow cost people, and whether the success tick means anything. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 9. BlackPearl02, Hacker News

[Ask HN: How do you verify cron jobs did what they were supposed to?](https://news.ycombinator.com/item?id=46717618)
(January 2026)

The purest statement of the problem found in this pass, and the reason exit codes are not a monitoring story:
"Backup cron runs, exit code 0, but creates empty files. Data sync completes successfully but only processes a
fraction of records. The logs say everything's fine, but the results are wrong." A reply in the thread says that
even with chronic, correct exit codes and notifications, a job can succeed and do nothing.

Draft message (one line, 265 characters):

Exit code 0, empty files: the cron runs, the sync completes, the logs say everything's fine and the results are wrong. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

### 10. @ericosiu, X

[Everyone on X is building OpenClaw agents. And many are quietly
failing.](https://x.com/ericosiu/status/2021643561301860762) (February 2026)

Runs 30 automated jobs a day through OpenClaw, three agents, a shared memory system and "a mission control
dashboard I check from my phone". The failure described is the one an uptime monitor cannot see: "The agent
hallucinated an entire build process and reported success with total confidence. 200,000 tokens. $3.12. Zero
output." The second item is the scheduled version of the same thing: "Crons Silently Die For Days ... No error. No
alert. No indication anything was wrong."

Draft message (one line, 254 characters):

You said the fix is an immune system, not better prompts, after an agent reported success with zero output. I built Collector, a free page that shows every agent and job across machines: https://github.com/dividendsolo/collector. Does it catch your case?

## How this was checked

Every link above was opened, not just searched for.

- Hacker News items were read from the HN API and opened at `news.ycombinator.com` (HTTP 200); authors come from
  the API, which is the same data the page renders.
- Discord invites were checked against Discord's public invite API, which returns the server name and member
  counts: `discord.gg/anthropic` resolves to the server named Claude with 133,017 members and 25,828 online.
- The X post was opened and read.
- Reddit permalinks were opened through a Redlib mirror at the same path, in a headless Chrome, because
  `reddit.com` and its JSON API answer this machine with a login wall or a 403, and the posts are newer than any
  archive snapshot. The author, date, title and body of each of the ten came from that render, and the links in
  this file are the canonical `reddit.com` ones, which is what James's browser opens. This is the one check that
  could not be done against the origin site from here; it is worth re-opening two or three of them by hand before
  the first message goes out.

Each draft message is one line, under 300 characters; it names Collector and links the repo, and the count printed
beside it is checked in `tests/community-messages.test.ts`.

Counts and dates in this file are as they appeared on the day it was written (2026-10-23).

## What this is not

No paid feature, no cloud companion and no pricing: collector#12 waits on the problem being confirmed with real
people, and this file is the input to that, not the answer. No account has been created anywhere, and nothing has
been posted, sent, followed or joined.
