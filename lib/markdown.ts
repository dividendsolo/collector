/**
 * The Briefs page reads a brief's Markdown as data, never as HTML (collector#64): `parseMarkdown` turns one brief
 * into blocks of parts, and `components/markdown.tsx` draws those as React nodes. Nothing is ever handed to
 * `dangerouslySetInnerHTML`, so raw HTML in a brief — a post quoted in Lead Watch carries whatever the poster typed —
 * is text on the page, and a link is only ever `http` or `https`.
 *
 * It is the Markdown our own cron briefs are written in, not the whole CommonMark specification: headings, tables,
 * lists, fenced code, rules and paragraphs, with inline code, bold, italic and links. Two deliberate simplifications,
 * and both read better for these briefs: a line break inside a paragraph or a list item is drawn as a line break
 * (the briefs write one fact per line, and HTML would otherwise fold them into one long line), and a list nested
 * inside a list item is read as a list of its own rather than indented under it.
 */

export type Part =
  | { kind: "text"; text: string }
  /** A line break in the source: the next line of the same paragraph or list item. */
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "bold"; parts: Part[] }
  | { kind: "italic"; parts: Part[] }
  | { kind: "link"; href: string; parts: Part[] };

/** Column alignment from a table's separator row, `|:---|---:|`: the default when it does not say. */
export type Align = "left" | "right" | "center" | null;

export type Block =
  | { kind: "heading"; level: number; parts: Part[] }
  | { kind: "paragraph"; parts: Part[] }
  | { kind: "code"; text: string }
  /** `start` is the number a numbered list opens with, as the brief wrote it (`4.` shows 4). */
  | { kind: "list"; ordered: boolean; start?: number; items: Part[][] }
  | { kind: "table"; align: Align[]; head: Part[][]; rows: Part[][][] }
  | { kind: "rule" };

const text = (s: string): Part => ({ kind: "text", text: s });

/** Links are `http`/`https` and nothing else, here and in every rule below: what a brief carries can never become a
 * link to somewhere else. The rules never take a sentence's own punctuation with them: `see https://x.com/a.` reads
 * the period as the period it is. */
const autolink = (url: string): Part => ({ kind: "link", href: url, parts: [text(url)] });

/** The inline rules, tried in this order at every position. `inner` marks a rule that does not apply straight after a
 * word: `_` inside a word is an underscore (`repeat_of`), not the start of italics, which is the one place Markdown
 * itself says so. */
const RULES: { re: RegExp; make: (m: RegExpExecArray) => Part; inner?: boolean }[] = [
  { re: /^`([^`\n]+)`/, make: (m) => ({ kind: "code", text: m[1] }) },
  {
    re: /^\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]*)\s*\)/,
    make: (m) => ({ kind: "link", href: m[2], parts: parseInline(m[1]) }),
  },
  { re: /^<(https?:\/\/[^>\s]+)>/, make: (m) => autolink(m[1]) },
  { re: /^\*\*([^*\n]+)\*\*/, make: (m) => ({ kind: "bold", parts: parseInline(m[1]) }) },
  { re: /^__([^_\n]+)__/, inner: true, make: (m) => ({ kind: "bold", parts: parseInline(m[1]) }) },
  { re: /^\*([^*\n]+)\*/, make: (m) => ({ kind: "italic", parts: parseInline(m[1]) }) },
  { re: /^_([^_\n]+)_/, inner: true, make: (m) => ({ kind: "italic", parts: parseInline(m[1]) }) },
  // A bare URL, up to but not including the punctuation that ends the sentence around it.
  {
    re: /^(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?])/,
    make: (m) => autolink(m[1]),
  },
];

const WORD = /[\p{L}\p{N}]/u;

/** One line of a brief as its parts: plain text around code, bold, italics and links. */
export function parseInline(line: string): Part[] {
  const parts: Part[] = [];
  let plain = "";
  let at = 0;
  const flush = () => {
    if (plain) parts.push(text(plain));
    plain = "";
  };
  while (at < line.length) {
    const rest = line.slice(at);
    const afterWord = at > 0 && WORD.test(line[at - 1]);
    const rule = RULES.find((r) => !(r.inner && afterWord) && r.re.test(rest));
    const hit = rule?.re.exec(rest);
    if (!rule || !hit) {
      plain += line[at];
      at += 1;
      continue;
    }
    flush();
    parts.push(rule.make(hit));
    at += hit[0].length;
  }
  flush();
  return parts;
}

/** The lines between two pipes, trimmed: `| a | b |`, and the row that follows it. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparator = (line: string) => {
  const row = cells(line);
  return row.length > 1 && row.every((c) => /^:?-+:?$/.test(c));
};

const alignOf = (cell: string): Align => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
};

/** A list item: its marker (`-`, `*`, `+`, `1.` or `1)`) and its text. */
const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
/** A fence's opening line, and three or more `-`, `*` or `_` alone: a rule. */
const FENCE = /^\s{0,3}(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
/** A line that opens with an HTML tag, which is what a quoted post may carry. It is read as the characters it is —
 * no part of it becomes markup or a link — rather than half-read as Markdown around the tags. */
const HTML_LINE = /^\s{0,3}<\/?[a-zA-Z][\w-]*(\s|\/?>)/;

/** True for a line that begins a block of its own, which is where one paragraph ends and the next begins. */
const starts = (lines: string[], i: number) =>
  FENCE.test(lines[i]) ||
  RULE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  HTML_LINE.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  (lines[i].trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1]));

/** One brief's Markdown as blocks, in the order they read. */
export function parseMarkdown(markdown: string): Block[] {
  const lines = (markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence, or the end of the brief
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, parts: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const head = cells(line).map(parseInline);
      const align = cells(lines[i + 1]).map(alignOf);
      const rows: Part[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(cells(lines[i]).map(parseInline));
        i += 1;
      }
      blocks.push({ kind: "table", align, head, rows });
      continue;
    }
    if (HTML_LINE.test(line)) {
      // The characters as they are: a quoted post's HTML is shown, not read.
      const literal: Part[] = [];
      while (i < lines.length && lines[i].trim()) {
        if (literal.length) literal.push({ kind: "break" });
        literal.push(text(lines[i].trim()));
        i += 1;
      }
      blocks.push({ kind: "paragraph", parts: literal });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const items: Part[][] = [];
      let current: Part[] = [];
      while (i < lines.length) {
        const next = ITEM.exec(lines[i]);
        if (next) {
          if ((next[3] !== undefined) !== ordered) break; // a numbered item after a bullet is another list
          if (current.length || items.length) items.push(current);
          current = parseInline(next[4].trim());
          i += 1;
          continue;
        }
        // An indented line under an item carries on that item (`Asked for: ...` under the lead it belongs to).
        if (current.length && lines[i].trim() && /^\s/.test(lines[i])) {
          current.push({ kind: "break" }, ...parseInline(lines[i].trim()));
          i += 1;
          continue;
        }
        // A blank line between two items of the same list keeps the list (the briefs space their leads that way).
        let j = i;
        while (j < lines.length && !lines[j].trim()) j += 1;
        const after = j > i && j < lines.length ? ITEM.exec(lines[j]) : null;
        if (after && (after[3] !== undefined) === ordered) {
          i = j;
          continue;
        }
        break;
      }
      items.push(current);
      blocks.push(
        ordered ? { kind: "list", ordered, start: Number(item[3]), items } : { kind: "list", ordered, items },
      );
      continue;
    }
    const parts: Part[] = [];
    while (i < lines.length && lines[i].trim() && !starts(lines, i)) {
      if (parts.length) parts.push({ kind: "break" });
      parts.push(...parseInline(lines[i].trim()));
      i += 1;
    }
    blocks.push({ kind: "paragraph", parts });
  }
  return blocks;
}
