import { describe, expect, it } from "vitest";
import { type Block, parseInline, parseMarkdown } from "@/lib/markdown";

const kinds = (blocks: Block[]) => blocks.map((b) => b.kind);
const plain = (parts: { kind: string; text?: string; parts?: any[]; href?: string }[]): string =>
  parts.map((p) => (p.kind === "text" ? p.text : p.kind === "link" ? plain(p.parts || []) : "")).join("");

const LEAD_WATCH = `# Lead Watch - 2026-11-08

## Leads

1. https://x.com/pierrickselas/status/2119182358599373269
   @pierrickselas, 2026-11-07, X
   Asked for:   a no-holds-barred roast of his landing page
   Our app:     PageRoast, fits as is
   Quote:       "roast my landing page, no sugarcoating 👇"

## Stats

Posts read: X 6, Reddit 12, Hacker News 0.

- PageRoast: 1 read, 1 lead, 100%
- Omarchy4mac: 5 read, 0 leads, 0%

X spend this month: $0.885 of $30
Notes: none.
`;

const YT_REVIEW = `# YouTube Weekly Review - 2026-11-02

Top traffic sources (7d):

| Source | Views |
| --- | --- |
| YouTube search | 143 |

## Valuation

| Ticker | Price | Day |
|:---|---:|---:|
| META | 612.5 | -1.2% |
`;

describe("a brief's blocks (collector#64)", () => {
  it("reads the Lead Watch digest the way it is written", () => {
    const blocks = parseMarkdown(LEAD_WATCH);
    expect(kinds(blocks)).toEqual(["heading", "heading", "list", "heading", "paragraph", "list", "paragraph"]);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(plain((blocks[0] as any).parts)).toBe("Lead Watch - 2026-11-08");
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: true });
    expect((blocks[2] as any).items).toHaveLength(1);
    const item = (blocks[2] as any).items[0];
    expect(plain(item)).toContain("Asked for:   a no-holds-barred roast");
    expect(item.filter((p: any) => p.kind === "break")).toHaveLength(4);
    expect(blocks[4]).toMatchObject({ kind: "paragraph" });
    expect(blocks[5]).toMatchObject({ kind: "list", ordered: false });
    expect((blocks[5] as any).items).toHaveLength(2);
    expect((blocks[6] as any).parts.filter((p: any) => p.kind === "break")).toHaveLength(1);
  });

  it("reads the YouTube review's tables, with the alignment they ask for", () => {
    const blocks = parseMarkdown(YT_REVIEW);
    expect(kinds(blocks)).toEqual(["heading", "paragraph", "table", "heading", "table"]);
    expect(blocks[2]).toMatchObject({
      kind: "table",
      align: [null, null],
      head: [[{ kind: "text", text: "Source" }], [{ kind: "text", text: "Views" }]],
      rows: [[[{ kind: "text", text: "YouTube search" }], [{ kind: "text", text: "143" }]]],
    });
    expect((blocks[4] as any).align).toEqual(["left", "right", "right"]);
    expect((blocks[4] as any).rows).toHaveLength(1);
  });

  it("reads a table only where the separator row is a separator", () => {
    const blocks = parseMarkdown("| not a table | really |\n| just a paragraph |\n");
    expect(kinds(blocks)).toEqual(["paragraph"]);
  });

  it("reads code, rules, headings of every level and a line to itself", () => {
    const blocks = parseMarkdown("#### Four\n\n```sh\nbun run test\n```\n\n---\n\n* * *\n");
    expect(kinds(blocks)).toEqual(["heading", "code", "rule", "rule"]);
    expect(blocks[0]).toMatchObject({ level: 4 });
    expect(blocks[1]).toMatchObject({ kind: "code", text: "bun run test" });
  });

  it("reads nothing at all out of an empty brief", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});

describe("a brief's inline parts (collector#64)", () => {
  it("reads inline code, bold and italics", () => {
    expect(parseInline("the `briefs.json` file")).toEqual([
      { kind: "text", text: "the " },
      { kind: "code", text: "briefs.json" },
      { kind: "text", text: " file" },
    ]);
    expect(parseInline("**Stats**")).toEqual([{ kind: "bold", parts: [{ kind: "text", text: "Stats" }] }]);
    expect(parseInline("_Prices as of 2026-11-02 close._")).toEqual([
      { kind: "italic", parts: [{ kind: "text", text: "Prices as of 2026-11-02 close." }] },
    ]);
    expect(parseInline("a *little* emphasis")).toEqual([
      { kind: "text", text: "a " },
      { kind: "italic", parts: [{ kind: "text", text: "little" }] },
      { kind: "text", text: " emphasis" },
    ]);
  });

  it("reads an underscore inside a word as an underscore", () => {
    expect(parseInline("repeat_of asks before")).toEqual([{ kind: "text", text: "repeat_of asks before" }]);
  });

  it("reads a Markdown link, an autolink and a bare URL, and trims the sentence's punctuation", () => {
    expect(parseInline("[8-K](https://www.sec.gov/Archives/x.htm)")).toEqual([
      {
        kind: "link",
        href: "https://www.sec.gov/Archives/x.htm",
        parts: [{ kind: "text", text: "8-K" }],
      },
    ]);
    expect(parseInline("<https://example.com/a>")).toEqual([
      { kind: "link", href: "https://example.com/a", parts: [{ kind: "text", text: "https://example.com/a" }] },
    ]);
    expect(parseInline("1. https://x.com/someone/status/1\n")).toEqual([
      { kind: "text", text: "1. " },
      {
        kind: "link",
        href: "https://x.com/someone/status/1",
        parts: [{ kind: "text", text: "https://x.com/someone/status/1" }],
      },
      { kind: "text", text: "\n" },
    ]);
    expect(parseInline("see https://example.com/x.")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://example.com/x", parts: [{ kind: "text", text: "https://example.com/x" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("never makes a link of anything but http and https", () => {
    for (const line of ["[click](javascript:alert(1))", "[x](data:text/html,<script>alert(1)</script>)"]) {
      expect(
        parseInline(line).some((p) => p.kind === "link"),
        line,
      ).toBe(false);
    }
  });

  it("keeps raw HTML as the text it is, so a quoted post cannot become markup", () => {
    expect(parseInline('<script>alert("x")</script>')).toEqual([{ kind: "text", text: '<script>alert("x")</script>' }]);
    const blocks = parseMarkdown('# Hi\n\n<img src=x onerror=alert(1)>\n\n<a href="https://evil.example.com">go</a>\n');
    expect(kinds(blocks)).toEqual(["heading", "paragraph", "paragraph"]);
    expect(JSON.stringify(blocks)).not.toContain('"html"');
    expect(JSON.stringify(blocks).includes("https://evil.example.com")).toBe(true);
    expect((blocks as any)[2].parts.every((p: any) => p.kind === "text")).toBe(true);
  });
});

describe("a numbered list across blank lines (collector#116)", () => {
  it("keeps one list, and its numbers, when a blank line sits between the items", () => {
    const blocks = parseMarkdown("1. a\n   x\n\n2. b\n\n3. c");
    expect(kinds(blocks)).toEqual(["list"]);
    expect(blocks[0]).toMatchObject({ kind: "list", ordered: true, start: 1 });
    expect((blocks[0] as any).items.map(plain)).toEqual(["ax", "b", "c"]);
  });

  it("shows the number the brief wrote first", () => {
    expect(parseMarkdown("4. d\n\n5. e")).toEqual([
      { kind: "list", ordered: true, start: 4, items: [[{ kind: "text", text: "d" }], [{ kind: "text", text: "e" }]] },
    ]);
  });

  it("still ends the list at a paragraph after the blank line", () => {
    const blocks = parseMarkdown("1. a\n\nSome words.\n\n- b");
    expect(kinds(blocks)).toEqual(["list", "paragraph", "list"]);
  });
});
