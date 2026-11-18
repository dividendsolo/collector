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

const ASK = /\*\*Ask \(([a-z]+)\):\*\*\s*([^\n]+)/;

export function askOf(body: string): string | null {
  const [, kind, text] = body.match(ASK) ?? [];
  if (!kind) return null;
  const line = `${kind}: ${text.trim()}`;
  return line.slice(0, 220) + (line.length > 220 ? "…" : "");
}

const CLAIM = /foreman:claim[^>]*?\brole=([\w-]+)[^>]*?\bhost=([\w.-]+)/;

export function claimOf(body: string): { role: string; host: string } | null {
  const [, role, host] = body.match(CLAIM) ?? [];
  return role && host ? { role, host } : null;
}

export function headline(body: string): string | null {
  const line = sentences(body)[0];
  if (!line) return null;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export function pickReason(comments: Comment[], labeledAt: string[]): Reason | null {
  const moved = labeledAt[labeledAt.length - 1];
  const asks = comments.filter((c) => ASK.test(c.body));
  const inStay = moved ? asks.filter((c) => c.createdAt >= moved) : asks;
  const beforeMove = moved ? asks.filter((c) => c.createdAt <= moved) : [];
  const ask = inStay[inStay.length - 1] ?? beforeMove[beforeMove.length - 1];
  if (ask) {
    const line = askOf(ask.body) as string;
    return { text: line, url: ask.url, at: ask.createdAt };
  }
  let pick: Comment | undefined;
  if (labeledAt.length) {
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
