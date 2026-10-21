import { EventEmitter } from "node:events";
import { type Board, config } from "./config";
import { expandHome } from "./paths";
import { run } from "./run";
import { once } from "./store";
import { type Comment, pickReason, type Reason } from "./text";

/** One open ticket on the board (or in a label repo), in the shape the Waiting and Work panels use. */
export interface Row {
  repo: string;
  number: number;
  title: string;
  url: string;
  lane: string;
  priority: string | null;
  created: string;
  labels: string[];
}

export const TICKET_TYPES = ["bug", "enhancement", "tech-debt"];
const ISSUE = "number title url createdAt state repository{name} labels(first:30){nodes{name}}";
// Page sizes keep one read at 1 GraphQL point: 1 + 55 label lists + 1 + 40 label lists = 97 requests (under 100).
const ITEMS_PAGE = 55;
const SEARCH_PAGE = 40;

/** The board read: open items with their Status and Priority, plus open issues in the label repos. Only the
 * connections that still have pages are asked for. */
export function boardQuery(items: boolean, search: boolean): string {
  const vars = [items && "$p:ID!,$c:String", search && "$q:String!,$s:String"].filter(Boolean).join(",");
  return `query(${vars}){ rateLimit{cost remaining resetAt}${
    items
      ? ` node(id:$p){... on ProjectV2{ items(first:${ITEMS_PAGE},after:$c,query:"is:open"){ pageInfo{hasNextPage endCursor}
  nodes{ status: fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
    priority: fieldValueByName(name:"Priority"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
    content{... on Issue{ ${ISSUE} }} }}}}`
      : ""
  }${
    search
      ? ` search(query:$q,type:ISSUE,first:${SEARCH_PAGE},after:$s){ pageInfo{hasNextPage endCursor} nodes{... on Issue{ ${ISSUE} }} }`
      : ""
  } }`;
}

const short = (r: string) => r.split("/").pop() as string;

/** The lane slugs a label repo can carry: every lane the board knows and every lane in tickets.all. */
export const laneSet = (board: Board, all: string[] = []) => new Set([...Object.keys(board.lanes), ...all]);

/** Rows from one answer of boardQuery. Board items in a label repo are skipped: the label is the truth there. */
export function parseBoard(data: any, board: Board, lanes: Set<string>) {
  const byOption = new Map(
    Object.entries(board.lanes)
      .filter(([, v]) => v)
      .map(([k, v]) => [v as string, k]),
  );
  const priority = new Map(Object.entries(board.priorities || {}).map(([k, v]) => [v, k]));
  const labelRepos = new Set((board.label_repos || []).map(short));
  const rows: Row[] = [];
  const items = data?.node?.items;
  for (const n of items?.nodes || []) {
    const c = n?.content;
    if (!c?.number || c.state !== "OPEN" || labelRepos.has(c.repository.name)) continue; // a draft, a PR, or closed
    const lane = byOption.get(n.status?.optionId);
    if (!lane) continue;
    rows.push({
      repo: c.repository.name,
      number: c.number,
      title: c.title,
      url: c.url,
      lane,
      priority: priority.get(n.priority?.optionId) ?? null,
      created: c.createdAt,
      labels: (c.labels?.nodes || []).map((l: any) => l.name),
    });
  }
  const search = data?.search;
  for (const c of search?.nodes || []) {
    if (!c?.number || c.state !== "OPEN") continue;
    const labels: string[] = (c.labels?.nodes || []).map((l: any) => l.name);
    const lane = labels.find((l) => lanes.has(l));
    if (!lane) continue;
    const p = labels.filter((l) => l in (board.priorities || {})).sort()[0] ?? null;
    rows.push({
      repo: c.repository.name,
      number: c.number,
      title: c.title,
      url: c.url,
      lane,
      priority: p,
      created: c.createdAt,
      labels,
    });
  }
  return {
    rows,
    items: items?.pageInfo as { hasNextPage: boolean; endCursor: string } | undefined,
    search: search?.pageInfo as { hasNextPage: boolean; endCursor: string } | undefined,
    cost: data?.rateLimit as { cost: number; remaining: number; resetAt: string } | undefined,
  };
}

export interface Diff {
  added: Row[];
  removed: Row[];
  moved: { row: Row; from: string }[];
  changed: Row[];
}

/** What changed between two reads, by ticket URL: new and gone tickets, lane moves, and title, priority, or label edits. */
export function diffBoard(prev: Row[], next: Row[]): Diff {
  const before = new Map(prev.map((r) => [r.url, r]));
  const after = new Set(next.map((r) => r.url));
  const d: Diff = { added: [], removed: prev.filter((r) => !after.has(r.url)), moved: [], changed: [] };
  for (const r of next) {
    const o = before.get(r.url);
    if (!o) d.added.push(r);
    else if (o.lane !== r.lane) d.moved.push({ row: r, from: o.lane });
    else if (o.title !== r.title || o.priority !== r.priority || o.labels.join() !== r.labels.join()) d.changed.push(r);
  }
  return d;
}

export const isEmpty = (d: Diff) => !d.added.length && !d.removed.length && !d.moved.length && !d.changed.length;

export function describe(d: Diff): string {
  const ref = (r: Row) => `${r.repo}#${r.number}`;
  return [
    ...d.moved.map((m) => `${ref(m.row)} ${m.from} -> ${m.row.lane}`),
    ...d.added.map((r) => `+${ref(r)} (${r.lane})`),
    ...d.removed.map((r) => `-${ref(r)}`),
    ...d.changed.map((r) => `~${ref(r)}`),
  ].join(", ");
}

interface Stats {
  polls: number;
  cost: number;
  since: number;
  last_ms: number;
  last_at: number;
  remaining: number | null;
  costs: [number, number][]; // [time ms, points], the last hour
}

interface BoardState {
  rows: Row[] | null;
  at: number;
  error: string | null;
  reasons: Map<string, { at: number; reason: Reason | null }>;
  events: EventEmitter;
  timer: NodeJS.Timeout | null;
  busy: boolean;
  clients: number;
  lastClientAt: number;
  stats: Stats;
}

const S = once<BoardState>("board", () => {
  const events = new EventEmitter();
  events.setMaxListeners(100);
  return {
    rows: null,
    at: 0,
    error: null,
    reasons: new Map(),
    events,
    timer: null,
    busy: false,
    clients: 0,
    lastClientAt: 0,
    stats: { polls: 0, cost: 0, since: Date.now(), last_ms: 0, last_at: 0, remaining: null, costs: [] },
  };
});

async function gql(query: string, vars: Record<string, string>) {
  const args = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
  return run(args, { timeout: 30 });
}

/** One full read of the board: page 1 of both lists in one query, then only the lists that have more. */
async function readBoard(
  board: Board,
  all: string[],
): Promise<{ rows: Row[]; cost: number; remaining: number | null }> {
  const lanes = laneSet(board, all);
  const q = (board.label_repos || []).map((r) => `repo:${r}`).join(" ");
  let items: string | null | undefined = null; // undefined: done
  let search: string | null | undefined = q ? null : undefined;
  const rows: Row[] = [];
  let cost = 0;
  let remaining: number | null = null;
  while (items !== undefined || search !== undefined) {
    const vars: Record<string, string> = {};
    if (items !== undefined) {
      vars.p = board.project_id;
      if (items) vars.c = items;
    }
    if (search !== undefined) {
      vars.q = `${q} is:issue is:open`;
      if (search) vars.s = search;
    }
    const [data, err] = await gql(boardQuery(items !== undefined, search !== undefined), vars);
    if (!data || data.errors) throw new Error(err || JSON.stringify(data?.errors).slice(0, 300));
    const page = parseBoard(data.data, board, lanes);
    rows.push(...page.rows);
    cost += page.cost?.cost ?? 1;
    remaining = page.cost?.remaining ?? remaining;
    items = items !== undefined && page.items?.hasNextPage ? page.items.endCursor : undefined;
    search = search !== undefined && page.search?.hasNextPage ? page.search.endCursor : undefined;
  }
  return { rows, cost, remaining };
}

/** No board in config.json: the old way, one tickets command per lane ("{lane}" in "command"). */
async function readCommand(cmd: string[], lanes: string[]): Promise<Row[]> {
  const out = await Promise.all(
    lanes.map(async (slug) => {
      const [data, err] = await run(
        cmd.map((c) => expandHome(c.replace("{lane}", slug))),
        { timeout: 60 },
      );
      if (err) throw new Error(`${slug}: ${err}`);
      return (data || []).map(
        (t: any): Row => ({
          repo: t.repo,
          number: t.number,
          title: t.title,
          url: t.url,
          lane: slug,
          priority: t.priority ?? null,
          created: t.createdAt,
          labels: t.labels || [],
        }),
      );
    }),
  );
  return out.flat();
}

const tickets = () => config().tickets || {};
const lanesOf = () => {
  const t = tickets();
  return [...new Set([...(t.all || []), ...(t.each || []), ...(t.count || [])])];
};

/** Read the board once; on a change, push the new view to every open page. */
export async function poll(reason = "timer"): Promise<void> {
  if (S.busy) return;
  S.busy = true;
  const start = Date.now();
  const cfg = config();
  try {
    let rows: Row[];
    if (cfg.board?.project_id) {
      const r = await readBoard(cfg.board, cfg.tickets?.all || []);
      rows = r.rows;
      S.stats.cost += r.cost;
      S.stats.costs.push([Date.now(), r.cost]);
      S.stats.remaining = r.remaining;
    } else if (cfg.tickets?.command?.length) {
      rows = await readCommand(cfg.tickets.command, lanesOf());
    } else {
      rows = [];
    }
    S.stats.polls++;
    S.stats.last_ms = Date.now() - start;
    S.stats.last_at = Date.now();
    S.stats.costs = S.stats.costs.filter(([t]) => Date.now() - t < 3600_000);
    const prev = S.rows;
    S.rows = rows;
    S.at = Date.now();
    const hadError = S.error;
    S.error = null;
    const d = diffBoard(prev || [], rows);
    if (prev === null || !isEmpty(d) || hadError) {
      if (prev !== null && !isEmpty(d))
        console.log(
          `[board] ${new Date().toISOString()} change seen in ${S.stats.last_ms} ms (${reason}): ${describe(d)}`,
        );
      emit();
    }
    void fillReasons();
  } catch (e) {
    S.error = String((e as Error).message).slice(0, 300);
    console.log(`[board] read failed: ${S.error}`);
    emit();
  } finally {
    S.busy = false;
  }
}

function emit() {
  S.events.emit("board", view());
}

// ---- Reasons: the comment that moved a waiting ticket, on a slower cache (ten minutes per ticket and lane).

const REASON_SECONDS = 600;
const reasonKey = (r: Row) => `${r.url}|${r.lane}`;

/** Ten issues per GraphQL query (still 1 point): comments and label events for each. */
export function reasonQuery(rows: Row[]): string {
  const parts = rows.map((r, i) => {
    const m = r.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!m) return "";
    return `i${i}: repository(owner:${JSON.stringify(m[1])},name:${JSON.stringify(m[2])}){ issue(number:${m[3]}){
  comments(last:20){ nodes{ createdAt url body } }
  timelineItems(last:20,itemTypes:[LABELED_EVENT]){ nodes{ ... on LabeledEvent{ createdAt label{name} } } } } }`;
  });
  return `query{ ${parts.join("\n")} }`;
}

export function reasonOf(issue: any, lane: string): Reason | null {
  const comments: Comment[] = issue?.comments?.nodes || [];
  const moved = (issue?.timelineItems?.nodes || [])
    .filter((e: any) => e?.label?.name === lane)
    .map((e: any) => e.createdAt as string);
  return pickReason(comments, moved);
}

let filling = false;
async function fillReasons() {
  if (filling || !S.rows) return;
  filling = true;
  try {
    const each = new Set(tickets().each || []);
    const want = S.rows.filter((r) => {
      if (!each.has(r.lane)) return false;
      const hit = S.reasons.get(reasonKey(r));
      return !hit || Date.now() - hit.at > REASON_SECONDS * 1000;
    });
    for (let i = 0; i < want.length; i += 10) {
      const batch = want.slice(i, i + 10);
      const [data] = await run(["gh", "api", "graphql", "-f", `query=${reasonQuery(batch)}`], { timeout: 30 });
      batch.forEach((r, k) => {
        const issue = data?.data?.[`i${k}`]?.issue;
        if (issue || data)
          S.reasons.set(reasonKey(r), { at: Date.now(), reason: issue ? reasonOf(issue, r.lane) : null });
      });
      if (data) emit();
    }
  } finally {
    filling = false;
  }
}

// ---- The views the page uses.

export function ticketsView() {
  const t = tickets();
  const each = t.each || [];
  const count = t.count || [];
  const keep = new Set([...each, ...count]);
  return {
    each,
    count,
    tickets: (S.rows || [])
      .filter((r) => keep.has(r.lane))
      .map((r) => ({
        repo: r.repo,
        number: r.number,
        title: r.title,
        url: r.url,
        lane: r.lane,
        priority: r.priority,
        created: r.created,
        type: r.labels.find((l) => TICKET_TYPES.includes(l)) ?? null,
        ...(each.includes(r.lane) ? { reason: S.reasons.get(reasonKey(r))?.reason ?? null } : {}),
      })),
    error: S.error,
    loaded: S.rows !== null,
  };
}

export function workView() {
  const lanes = tickets().all || [];
  const known = new Set(lanesOf());
  return {
    at: S.at / 1000,
    lanes,
    cards: (S.rows || [])
      .filter((r) => lanes.includes(r.lane))
      .map((r) => ({
        repo: r.repo,
        number: r.number,
        title: r.title,
        url: r.url,
        lane: r.lane,
        priority: r.priority,
        created: r.created,
        labels: r.labels.filter((l) => !known.has(l) && l !== r.priority),
      })),
    error: S.error,
    loaded: S.rows !== null,
  };
}

export const view = () => ({ at: S.at, tickets: ticketsView(), work: workView() });
export const boardError = () => S.error;
export const boardRows = () => S.rows;

export function boardStats() {
  const hour = S.stats.costs.reduce((n, [, c]) => n + c, 0);
  return {
    ...S.stats,
    costs: undefined,
    cost_last_hour: hour,
    clients: S.clients,
    interval_s: intervalSeconds(),
    rows: S.rows?.length ?? null,
  };
}

// ---- The poller: every 10 seconds while a page is open, every minute when none has been for two minutes.

const intervalSeconds = () => {
  const base = config().board?.interval || 10;
  const idle = S.clients === 0 && Date.now() - S.lastClientAt > 120_000;
  return idle ? Math.max(base, 60) : base;
};

export function startBoard() {
  if (S.timer) return;
  const loop = async () => {
    await poll();
    S.timer = setTimeout(loop, intervalSeconds() * 1000);
  };
  S.timer = setTimeout(loop, 0);
}

/** Subscribe one page to board changes. Returns the unsubscribe. */
export function subscribe(fn: (v: ReturnType<typeof view>) => void): () => void {
  startBoard();
  S.clients++;
  S.lastClientAt = Date.now();
  S.events.on("board", fn);
  if (S.rows !== null || S.error) fn(view());
  // A page that opens after an idle spell gets a fresh read now, not at the next minute tick.
  if (Date.now() - S.at > (config().board?.interval || 10) * 1000) void poll("page opened");
  return () => {
    S.clients--;
    S.lastClientAt = Date.now();
    S.events.off("board", fn);
  };
}

/** Wait (up to `ms`) for the first read, for the plain JSON routes. */
export async function ready(ms = 30_000) {
  startBoard();
  const t0 = Date.now();
  while (S.rows === null && !S.error && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100));
}
