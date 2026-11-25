# Collector

Collector is James's local dashboard of his machines, cards, agents, jobs and vendors, the one screen he keeps open all day.

## Language

### Briefs

**Brief**:
One report that a cron job writes for James, such as "Lead Watch - 2026-11-06 - 4 leads".
_Avoid_: report, digest, email

**Inbox**:
Every Brief that is not Archived, oldest first. The count on the Briefs link is the number of Briefs in the Inbox.
_Avoid_: unread list, queue

**Read**:
A Brief James has opened. A Read Brief stays in the Inbox, dimmed, until it is Archived.
_Avoid_: seen, opened, done

**Archived**:
A Brief James has finished and archived. It leaves the Inbox for the Archived section and is never counted again. Only James archives a Brief; a skill never does.
_Avoid_: processed, acknowledged, marked as read, deleted

### Inbox

The sidebar's Inbox link is every Message Hermes or a job sent James on Signal. The Briefs page has an Inbox of its own, above.

**Message**:
One thing Hermes or a job sent James on Signal, kept as one line in `~/.hermes/inbox/*.jsonl` on the machine that sent it and shown as one row on the Inbox page.
_Avoid_: notification, alert, signal message

**Source**:
The job or profile that sent a Message.
_Avoid_: sender, origin, from

**Handled**:
A Message James has finished with. It leaves the top of the Inbox for the Handled section and is not counted again. Only James handles a Message; a skill never does.
_Avoid_: read, done, acknowledged, archived
