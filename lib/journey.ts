export interface Journey {
  card: ({ repo: string; number: number } & JourneyCard) | null;
  moves: Move[];
}

export interface JourneyCard {
  title: string;
  url: string;
  state: string;
  createdAt: string;
}

export interface Move {
  status: string;
  from: string | null;
  at: string;
  who: string | null;
  why: string | null;
  url: string | null;
  seconds: number | null;
}

export const journeyWalk = (moves: Move[]): string[] => moves.map((m) => m.status);

export function journeyVisits(moves: Move[]): Record<string, number> {
  const visits: Record<string, number> = {};
  for (const m of moves) visits[m.status] = (visits[m.status] ?? 0) + 1;
  return visits;
}

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

export function nowLine(moves: Move[], opts: { now?: number; zone?: string } = {}): string {
  const last = moves.at(-1);
  if (!last) return "";
  return `In ${last.status} since ${moveTime(last.at, opts)}${last.why ? `, because ${last.why}` : ""}`;
}
