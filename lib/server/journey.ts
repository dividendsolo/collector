import type { Journey, JourneyCard, Move } from "../journey";
import { webUrl } from "../links";
import { AGENT_STACK_ALL } from "../statuses";
import { config, repoNames } from "./config";
import { run } from "./run";
import { once } from "./store";
import { askOf, claimOf, headline } from "./text";

/**
 * One card's journey (collector#146): the issue's own GraphQL timeline, folded into the moves the card made. The
 * card's status is read from its labels, never from the project board's status-change event: this board does not
 * emit one (0 nodes for dividend-solo#146, whose story the card tells), and a label pair says the same thing.
 *
 * The fold is one step per status label, so `ready-for-agent -> agent-in-progress` is one move and not two raw
 * events; the unlabel half of that pair, the `ezio` and `waiting-check` labels and every comment that is not the
 * nearest one beside a move fold into the move they belong to, or away.
 */

/** One page of `timelineItems`, as GitHub answers it. */
export interface TimelinePage {
  nodes: any[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** The issue's own facts, as the journey's heading uses them. */
export interface TimelineRead {
  issue: JourneyCard | null;
  pages: TimelinePage[];
}

/** The events a journey reads. `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` is not among them: the board emits none. */
export const TIMELINE_ITEM_TYPES = [
  "LABELED_EVENT",
  "UNLABELED_EVENT",
  "ISSUE_COMMENT",
  "CLOSED_EVENT",
  "REOPENED_EVENT",
  "CROSS_REFERENCED_EVENT",
];

/** `timelineItems` answers 100 nodes at most, and a long card has more: dividend-solo#146 matched 93 of these
 * events on 2026-11-13 and held 110 timeline items. Each page costs 1 GraphQL point. */
export const TIMELINE_PAGE = 100;
/** The most pages one journey reads: a card with more than a thousand events is read as far as this goes. */
export const MAX_PAGES = 10;

/** The statuses a label can name, and the two nodes the drawing gives a close and a reopen. `lib/statuses.ts` is
 * the one list of statuses, so a lane the agent stack gains is a journey step with no edit here. */
const STATUSES = new Set(AGENT_STACK_ALL);
const CLOSED = "closed";
/** A reopened card re-enters the board where every card lands first. */
const REOPENED = "needs-triage";

/** One page of one issue's timeline, oldest events first. `after` asks for the page that follows a cursor. */
export function timelineQuery(owner: string, name: string, number: number, cursor: string | null): string {
  const after = cursor ? `,after:${JSON.stringify(cursor)}` : "";
  return `query{ repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){ issue(number:${number}){
  title url state createdAt
  timelineItems(first:${TIMELINE_PAGE}${after},itemTypes:[${TIMELINE_ITEM_TYPES.join(",")}]){
    pageInfo{hasNextPage endCursor}
    nodes{
      __typename
      ... on LabeledEvent{ createdAt actor{login} label{name} }
      ... on IssueComment{ createdAt author{login} body url }
      ... on ClosedEvent{ createdAt actor{login} }
      ... on ReopenedEvent{ createdAt actor{login} }
    } } } } }`;
}

/** The issue's own facts and one page of its timeline from one answer, or null for an answer with no issue (a repo
 * this token cannot read, a number that is not there). */
export function parseTimeline(data: any): { issue: JourneyCard; page: TimelinePage } | null {
  const issue = data?.data?.repository?.issue;
  if (!issue) return null;
  const items = issue.timelineItems || {};
  return {
    issue: { title: issue.title, url: issue.url, state: issue.state, createdAt: issue.createdAt },
    page: {
      nodes: items.nodes || [],
      pageInfo: { hasNextPage: Boolean(items.pageInfo?.hasNextPage), endCursor: items.pageInfo?.endCursor ?? null },
    },
  };
}

/** Every page of one issue's timeline, in the order GitHub answered them. The issue's own facts come from the
 * first page that answered; a page GitHub will not give stops the read and keeps the ones already read. */
export async function readTimeline(name: string, number: number): Promise<TimelineRead> {
  const [owner, repo] = name.split("/");
  const pages: TimelinePage[] = [];
  let issue: JourneyCard | null = null;
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const [data] = await run(["gh", "api", "graphql", "-f", `query=${timelineQuery(owner, repo, number, cursor)}`], {
      timeout: 30,
    });
    const read = parseTimeline(data);
    if (!read) break;
    issue = issue ?? read.issue;
    pages.push(read.page);
    if (!read.page.pageInfo.hasNextPage || !read.page.pageInfo.endCursor) break;
    cursor = read.page.pageInfo.endCursor;
  }
  return { issue, pages };
}

/** The events of every page, in the order the pages came in. */
export const timelineNodes = (pages: TimelinePage[]): any[] =>
  pages.flatMap((p) => p.nodes || []).filter((n) => n?.createdAt && !Number.isNaN(Date.parse(n.createdAt)));

/**
 * What a comment is, which is how good it is as a move's reason: a claim, an Ask and a "Released by hand" say why a
 * card moved; the housekeeping comment that names a status says what moved it; anything else only sits beside it.
 */
export type CauseKind = "ask" | "claim" | "release" | "scheduler" | "crew" | "housekeeping" | "comment";

const RELEASED_BY_HAND = /Released by hand/i;
const SCHEDULED_REACHED = /Scheduled date[^\n]*reached/i;
const CREW_NOTE = /^\s*Waiting crew:/i;
const MOVED_TO = /moved to `?([a-z][a-z-]*)`?/i;

/** The status a housekeeping comment says it moved the card to, or null for a comment that says no such thing. */
export const movedTo = (body: string): string | null => body.match(MOVED_TO)?.[1] ?? null;

export function causeKind(body: string): CauseKind {
  if (askOf(body)) return "ask";
  if (claimOf(body)) return "claim";
  if (RELEASED_BY_HAND.test(body)) return "release";
  if (SCHEDULED_REACHED.test(body)) return "scheduler";
  if (CREW_NOTE.test(body)) return "crew";
  if (movedTo(body)) return "housekeeping";
  return "comment";
}

/** A comment, and how far it sits from the move it is beside. */
interface NearComment {
  at: string;
  body: string;
  url: string;
  kind: CauseKind;
  gap: number;
}

/** One move while it is being folded: the reason and the machine are attached to it after the timeline is read. */
interface MoveDraft {
  status: string;
  at: string;
  actor: string | null;
  host: string | null;
  hostGap: number;
  causes: NearComment[];
}

/** A comment explains the move nearest it, never two: a card's Ask belongs to the step it made, not to the step 28
 * seconds before it. Nothing further away than this from a move is taken as its reason. */
export const CAUSE_WINDOW_S = 60;

/** The comment that explains a move: a decision (a claim, an Ask, a hand release) first, then the housekeeping line
 * that names this status, then the scheduler and the crew, then whatever else sits nearest. */
export function pickCause(causes: NearComment[], status: string): NearComment | null {
  const rank = (c: NearComment) => {
    if (c.kind === "ask" || c.kind === "claim" || c.kind === "release") return 0;
    if (c.kind === "housekeeping" && movedTo(c.body) === status) return 1;
    if (c.kind === "scheduler") return 2;
    return 3;
  };
  let best: NearComment | null = null;
  for (const c of causes) {
    if (!best) {
      best = c;
      continue;
    }
    if (rank(c) - rank(best) < 0 || (rank(c) === rank(best) && c.gap < best.gap)) best = c;
  }
  return best;
}

/** What a move's reason reads: the Ask the run posted, the claim's own marker, else the comment's first line. */
function reasonOf(c: NearComment): string | null {
  const ask = askOf(c.body);
  if (ask) return ask;
  const claim = claimOf(c.body);
  if (claim) return `Claimed for a ${claim.role} run on ${claim.host}.`;
  return headline(c.body);
}

/** The name a mover shows when its kind is its own (a machine is named by the move's own host instead). */
const NAMED: Partial<Record<CauseKind, string>> = {
  release: "James, by hand",
  housekeeping: "Housekeeping",
  scheduler: "The scheduler",
  crew: "The waiting crew",
};

/**
 * The moves a card made, folded off its timeline's pages (oldest first). `machines` are the machine names from
 * `config.json`: a label naming one (`ezio`) is not a status, so it never makes a move — it says which machine held
 * the card on the move it sits beside.
 */
export function journeyMoves(pages: TimelinePage[], machines: string[] = []): Move[] {
  const hosts = new Set(machines);
  const moves: MoveDraft[] = [];
  const labels: { at: string; name: string }[] = [];
  const comments: { at: string; body: string; url: string; kind: CauseKind }[] = [];

  for (const n of timelineNodes(pages)) {
    const at: string = n.createdAt;
    const actor: string | null = n.actor?.login ?? n.author?.login ?? null;
    if (n.__typename === "LabeledEvent") {
      const label = n.label?.name;
      if (STATUSES.has(label)) moves.push({ status: label, at, actor, host: null, hostGap: 0, causes: [] });
      else if (hosts.has(label)) labels.push({ at, name: label });
    } else if (n.__typename === "ClosedEvent") {
      moves.push({ status: CLOSED, at, actor, host: null, hostGap: 0, causes: [] });
    } else if (n.__typename === "ReopenedEvent") {
      moves.push({ status: REOPENED, at, actor, host: null, hostGap: 0, causes: [] });
    } else if (n.__typename === "IssueComment") {
      const body: string = n.body ?? "";
      comments.push({ at, body, url: n.url ?? "", kind: causeKind(body) });
    }
  }

  /** The move a timeline item sits beside: the nearest one, and only within the window. */
  const nearest = (at: string): { move: MoveDraft; gap: number } | null => {
    const t = Date.parse(at);
    let best: MoveDraft | null = null;
    let gap = Number.POSITIVE_INFINITY;
    for (const m of moves) {
      const d = Math.abs(Date.parse(m.at) - t) / 1000;
      if (d <= CAUSE_WINDOW_S && d < gap) {
        best = m;
        gap = d;
      }
    }
    return best ? { move: best, gap } : null;
  };

  for (const c of comments) {
    const near = nearest(c.at);
    if (near) near.move.causes.push({ ...c, gap: near.gap });
  }
  for (const l of labels) {
    const near = nearest(l.at);
    // The label flaps on and off around one move: the nearest label of its own is the one that names the machine.
    if (near && (!near.move.host || near.gap < near.move.hostGap)) {
      near.move.host = l.name;
      near.move.hostGap = near.gap;
    }
  }

  // The machine a card was on at a time: the last claim or machine label at or before it, so an Ask a builder's run
  // posted while it held the card is that run's.
  const inPlay = moves
    .map((m) => (m.host ? { at: m.at, host: m.host } : null))
    .concat(comments.filter((c) => c.kind === "claim").map((c) => ({ at: c.at, host: claimOf(c.body)?.host ?? "" })))
    .filter((x): x is { at: string; host: string } => Boolean(x?.host))
    .sort((a, b) => a.at.localeCompare(b.at));
  const hostAt = (at: string) => inPlay.filter((p) => p.at <= at).at(-1)?.host ?? null;

  return moves.map((m, i) => {
    const cause = pickCause(m.causes, m.status);
    return {
      status: m.status,
      from: i > 0 ? moves[i - 1].status : null,
      at: m.at,
      who: (cause ? NAMED[cause.kind] : undefined) ?? m.host ?? hostAt(m.at) ?? m.actor ?? null,
      why: cause ? reasonOf(cause) : null,
      // Only a web address is an href (collector#84): a comment's url is outside data, like every other link
      // the page takes from outside. One that is not http(s) is dropped; the reason still shows, without a link.
      url: webUrl(cause?.url ?? "") || null,
      seconds: i + 1 < moves.length ? Math.round((Date.parse(moves[i + 1].at) - Date.parse(m.at)) / 1000) : null,
    };
  });
}

/** How long a journey's own answer is kept: a card's history does not change second to second, and the page asks
 * for it once when it opens. */
export const JOURNEY_SECONDS = 300;

const journeys = once("journeys", () => new Map<string, { at: number; value: Journey }>());

/** One card's journey, read from the issue's own timeline. `card` is null when no chosen project holds that number,
 * so the page is always answering with something it can draw. */
export async function journey(repo: string, number: number): Promise<Journey> {
  const key = `${repo}#${number}`;
  const hit = journeys.get(key);
  if (hit && Date.now() - hit.at < JOURNEY_SECONDS * 1000) return hit.value;
  const cfg = config();
  const machines = (cfg.machines || []).map((m) => m.name).filter((n): n is string => Boolean(n));
  let value: Journey = { card: null, moves: [] };
  for (const name of repoNames(cfg, repo)) {
    const read = await readTimeline(name, number);
    if (!read.issue) continue;
    value = {
      card: { repo, number, ...read.issue },
      moves: journeyMoves(read.pages, machines),
    };
    break;
  }
  journeys.set(key, { at: Date.now(), value });
  return value;
}
