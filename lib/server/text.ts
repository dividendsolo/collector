/** The prose of a comment, one sentence at a time: no headings, quotes, tables, code, or Markdown marks. Log paths
 * and run records (a "$" or 3+ slashes) are skipped. */
export function sentences(body: string): string[] {
  const keep: string[] = [];
  for (const line of body.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (!t || ["#", ">", "|", "```", "- ["].some((p) => t.startsWith(p))) continue;
    keep.push(t.replace(/^\s*[-*]\s+/, "").replace(/[*_`]/g, ""));
  }
  const text = keep.join(" ").replace(/^(Mac lane|VPS lane|Foreman|foreman)( on \w+)?:\s*/, "");
  return text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x && !x.includes("$") && (x.match(/\//g) || []).length < 3 && x.length < 400);
}

export const REASON_HINT =
  /needs?[- ]info|need your|did not pass|cannot|can't|blocked|split this|unverified|over \d+ hours/i;
export const REASON_STRONG =
  /need your|needs James|James to|awaiting|your input|answer|cannot|can't|uncommitted|split this|over \d+ hours|blocked by/i;

export interface Comment {
  createdAt: string;
  url: string;
  body: string;
}
export interface Reason {
  text: string;
  url: string;
  at: string;
}

/** Why a ticket sits in its lane: the comment that moved it there (the newest one up to when the lane label went on,
 * else the newest that reads like a reason, else the newest), cut to one sentence. */
export function pickReason(comments: Comment[], labeledAt: string[]): Reason | null {
  let pick: Comment | undefined;
  if (labeledAt.length) {
    const moved = labeledAt[labeledAt.length - 1];
    const before = comments.filter((c) => c.createdAt <= moved);
    pick = before[before.length - 1];
  }
  if (!pick) pick = [...comments].reverse().find((c) => REASON_HINT.test(c.body)) ?? comments[comments.length - 1];
  if (!pick) return null;
  const said = sentences(pick.body);
  let line = said.find((x) => REASON_STRONG.test(x)) ?? said.find((x) => REASON_HINT.test(x)) ?? said[0] ?? "";
  line = line.charAt(0).toUpperCase() + line.slice(1);
  return { text: line.slice(0, 220) + (line.length > 220 ? "…" : ""), url: pick.url, at: pick.createdAt };
}

const CARD_SECTION = /^#+\s*(what|problem|bug|goal|why|summary)\b/i;

/** What a card is for: its Agent Brief Summary line, else the first sentences of its What / Problem section, else of
 * the body; about 320 characters. */
export function cardText(body: string): string {
  const lines = (body || "").replace(/\r/g, "").split("\n");
  const head = lines.findIndex((l) => CARD_SECTION.test(l.trim()));
  const start = head + 1;
  let end = lines.findIndex((l, i) => i >= start && l.trimStart().startsWith("#"));
  if (end < 0) end = lines.length;
  const summary = lines.find((l) => /^\W*summary:/i.test(l.trim()));
  const brief = summary ? summary.trim().replace(/^\W*summary:\W*/i, "") : null;
  const s1 = sentences(brief ?? lines.slice(start, end).join("\n"));
  const said = s1.length ? s1 : sentences(lines.join("\n"));
  let text = "";
  for (const x of said) {
    if (text.length + x.length > 320 && text) break;
    text = `${text} ${x}`.trim();
  }
  return text;
}
