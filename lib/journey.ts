/**
 * One card's journey (collector#146): every status the card passed through, in order, with who moved it, when, how
 * long it stayed and the comment that says why. The timeline itself is read and folded on the server
 * (`lib/server/journey.ts`); this file is the shared model — the walk the drawing replays, the visit counts, and
 * the words the page puts on a move — so the page and its test read the same numbers.
 */

/** One card's journey, in the shape `/api/journey` answers and the page draws. `card` is null when no chosen
 * project holds that card number — an answer the page can tell apart from one it is still waiting for. */
export interface Journey {
  card: ({ repo: string; number: number } & JourneyCard) | null;
  moves: Move[];
}

/** The card's own facts, as GitHub answers them for the issue. */
export interface JourneyCard {
  title: string;
  url: string;
  state: string;
  createdAt: string;
}

/** One move: the card entered `status` at `at`, from `from`. */
export interface Move {
  /** The status the card moved into. */
  status: string;
  /** The status it came from, or null for the earliest move the timeline still holds. */
  from: string | null;
  /** When it moved, ISO 8601, as GitHub stamps its events. */
  at: string;
  /** Who moved it: the machine that held the card (`ezio`), the lane's own name for a run it cannot name
   * (Housekeeping, The scheduler, The waiting crew), `James, by hand`, else the account that made the event. */
  who: string | null;
  /** Why it moved, in one line: the Ask, the claim, or the comment's own first sentence. */
  why: string | null;
  /** The comment that says why, linked from the page. Null when nothing near the move explains it. */
  url: string | null;
  /** How long the card stayed in this status, in seconds; null for the last move, which is still going. */
  seconds: number | null;
}

/** The statuses the card entered, in time order: the path the flow draws, node by node. */
export const journeyWalk = (moves: Move[]): string[] => moves.map((m) => m.status);

/** How many times the card visited each status: a node it passed more than once says so on the drawing. */
export function journeyVisits(moves: Move[]): Record<string, number> {
  const visits: Record<string, number> = {};
  for (const m of moves) visits[m.status] = (visits[m.status] ?? 0) + 1;
  return visits;
}

/** How long a card stayed in one status: "45 s", "30 min", "1 h 2 min", "3 days 4 h", and a dash for the last move. */
export function stayText(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const word = `${days} ${days === 1 ? "day" : "days"}`;
  return h ? `${word} ${h} h` : word;
}

/**
 * When one move happened, in the viewer's own time zone — the page's own rule for every time it shows (never UTC,
 * collector#64's Briefs) — with the day in front when it was not today: "14:39 EST", "Nov 12 16:26 EST". `zone`
 * names a zone instead (a test's own), and `now` the day "today" is measured against.
 */
export function moveTime(at: string, { now = Date.now(), zone }: { now?: number; zone?: string } = {}): string {
  const t = new Date(at);
  if (Number.isNaN(t.getTime())) return "—";
  const inZone = zone ? { timeZone: zone } : {};
  const time = t.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    ...inZone,
  });
  if (t.toLocaleDateString("en-US", inZone) === new Date(now).toLocaleDateString("en-US", inZone)) return time;
  return `${t.toLocaleDateString("en-US", { month: "short", day: "numeric", ...inZone })} ${time}`;
}

/**
 * The line the view is opened for, from the last move: "In needs-info since 14:39 EST, because decision: cut the
 * rest of #146 into agent cards". Empty for a card whose timeline holds no move at all.
 */
export function nowLine(moves: Move[], opts: { now?: number; zone?: string } = {}): string {
  const last = moves.at(-1);
  if (!last) return "";
  return `In ${last.status} since ${moveTime(last.at, opts)}${last.why ? `, because ${last.why}` : ""}`;
}
