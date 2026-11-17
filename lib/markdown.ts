export type Part =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "bold"; parts: Part[] }
  | { kind: "italic"; parts: Part[] }
  | { kind: "link"; href: string; parts: Part[] };

export type Align = "left" | "right" | "center" | null;

export type Block =
  | { kind: "heading"; level: number; parts: Part[] }
  | { kind: "paragraph"; parts: Part[] }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; start?: number; items: Part[][] }
  | { kind: "table"; align: Align[]; head: Part[][]; rows: Part[][][] }
  | { kind: "rule" };

const text = (s: string): Part => ({ kind: "text", text: s });

const autolink = (url: string): Part => ({ kind: "link", href: url, parts: [text(url)] });

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
  {
    re: /^(https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?])/,
    make: (m) => autolink(m[1]),
  },
];

const WORD = /[\p{L}\p{N}]/u;

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

const ITEM = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HTML_LINE = /^\s{0,3}<\/?[a-zA-Z][\w-]*(\s|\/?>)/;

const starts = (lines: string[], i: number) =>
  FENCE.test(lines[i]) ||
  RULE.test(lines[i]) ||
  HEADING.test(lines[i]) ||
  HTML_LINE.test(lines[i]) ||
  ITEM.test(lines[i]) ||
  (lines[i].trim().startsWith("|") && i + 1 < lines.length && isSeparator(lines[i + 1]));

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
      i += 1;
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
          if ((next[3] !== undefined) !== ordered) break;
          if (current.length || items.length) items.push(current);
          current = parseInline(next[4].trim());
          i += 1;
          continue;
        }
        if (current.length && lines[i].trim() && /^\s/.test(lines[i])) {
          current.push({ kind: "break" }, ...parseInline(lines[i].trim()));
          i += 1;
          continue;
        }
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
