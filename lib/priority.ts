export const PRIORITY_GROUPS = [
  "cant-work",
  "security",
  "p0",
  "triage",
  "jobs",
  "money",
  "briefs",
  "good-news",
] as const;
export type PriorityGroup = (typeof PRIORITY_GROUPS)[number];

export const TRIAGE_LANE = "needs-triage";

export function priorityOrder<T extends { group?: PriorityGroup }>(rows: T[]): T[] {
  const rank = (r: T) => {
    const i = r.group ? PRIORITY_GROUPS.indexOf(r.group) : -1;
    return i < 0 ? PRIORITY_GROUPS.length : i;
  };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

export function transitionNames(rows: { ack?: { key: string }; text?: string }[]): string[] {
  const used = new Set<string>();
  return rows.map((r) => {
    const base = `alert-${String(r.ack?.key ?? r.text ?? "").replace(/[^A-Za-z0-9_-]/g, "_")}`;
    let name = base;
    for (let n = 1; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return name;
  });
}

export function fullRepo(t: { repo?: string | null; url?: string | null }): string {
  const m = String(t.url ?? "").match(/github\.com\/([^/]+\/[^/]+)\/issues\//);
  return m ? m[1] : String(t.repo ?? "");
}

export function triageRow(
  tickets: {
    lane?: string | null;
    checking?: boolean;
    repo?: string | null;
    number?: number | null;
    created?: string | null;
    url?: string | null;
  }[],
) {
  const cards = tickets.filter((t) => t.lane === TRIAGE_LANE && !t.checking);
  const n = cards.length;
  if (!n) return null;
  const one =
    n === 1 && cards[0].number
      ? `: ${String(cards[0].repo ?? "")
          .split("/")
          .pop()}#${cards[0].number}`
      : "";
  return {
    level: "warn" as const,
    group: "triage" as const,
    text: `${n} ${n === 1 ? "card needs" : "cards need"} triage${one}`,
    jump: "waiting-panel",
    filter: TRIAGE_LANE,
    since: openedAt(cards),
    ...(n === 1 && cards[0].repo && cards[0].number
      ? { triage: { repo: fullRepo(cards[0]), number: Number(cards[0].number) } }
      : {}),
  };
}

export function briefsRow(inbox: { read?: boolean }[]) {
  const n = inbox.filter((b) => !b.read).length;
  if (!n) return null;
  return {
    level: "warn" as const,
    group: "briefs" as const,
    text: `${n} unread ${n === 1 ? "brief" : "briefs"}`,
    href: "#/briefs",
  };
}

export function p0Rows(
  tickets: {
    lane?: string | null;
    priority?: string | null;
    repo?: string;
    number?: number;
    title?: string;
    url?: string;
    created?: string | null;
  }[],
) {
  return tickets
    .filter((t) => t.priority === "P0" && t.lane !== TRIAGE_LANE)
    .map((t) => ({
      level: "error" as const,
      group: "p0" as const,
      text: `P0: ${t.title} (${String(t.repo).split("/").pop()}#${t.number}, ${t.lane})`,
      url: t.url,
      since: openedAt([t]),
      ...(t.repo && t.number ? { unblock: { repo: fullRepo(t), number: Number(t.number) } } : {}),
    }));
}

function openedAt(cards: { created?: string | null }[]): number | undefined {
  const times = cards.map((c) => (c.created ? Date.parse(c.created) : Number.NaN)).filter((n) => !Number.isNaN(n));
  return times.length ? Math.min(...times) / 1000 : undefined;
}
