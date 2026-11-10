"use client";

import { Fragment } from "react";
import { type Align, type Block, type Part, parseMarkdown } from "@/lib/markdown";

/**
 * One brief's Markdown, drawn as React nodes (collector#64). `lib/markdown.ts` reads the text; nothing here ever
 * becomes HTML: a part is text, a line break, inline code, bold, italic or a link, and React escapes every one of
 * them. A brief quotes what other people posted, so a `<script>` in one prints as those characters on the page.
 */

const Inline = ({ parts }: { parts: Part[] }) => (
  <>
    {parts.map((p, i) => {
      if (p.kind === "text") return <Fragment key={i}>{p.text}</Fragment>;
      if (p.kind === "break") return <br key={i} />;
      if (p.kind === "code") return <code key={i}>{p.text}</code>;
      if (p.kind === "link")
        return (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            <Inline parts={p.parts} />
          </a>
        );
      return p.kind === "bold" ? (
        <strong key={i}>
          <Inline parts={p.parts} />
        </strong>
      ) : (
        <em key={i}>
          <Inline parts={p.parts} />
        </em>
      );
    })}
  </>
);

const align = (a: Align) => (a ? { textAlign: a } : undefined);

const Table = ({ block }: { block: Extract<Block, { kind: "table" }> }) => (
  <div className="wrap">
    <table>
      <thead>
        <tr>
          {block.head.map((cell, j) => (
            <th key={j} style={align(block.align[j])}>
              <Inline parts={cell} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, i) => (
          <tr key={i}>
            {block.head.map((_, j) => (
              <td key={j} style={align(block.align[j])}>
                <Inline parts={row[j] || []} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

function BlockView({ block }: { block: Block }) {
  if (block.kind === "heading") {
    if (block.level === 1)
      return (
        <h1>
          <Inline parts={block.parts} />
        </h1>
      );
    if (block.level === 2)
      return (
        <h2>
          <Inline parts={block.parts} />
        </h2>
      );
    return (
      <h3>
        <Inline parts={block.parts} />
      </h3>
    );
  }
  if (block.kind === "paragraph")
    return (
      <p>
        <Inline parts={block.parts} />
      </p>
    );
  if (block.kind === "code")
    return (
      <pre>
        <code>{block.text}</code>
      </pre>
    );
  if (block.kind === "rule") return <hr />;
  if (block.kind === "table") return <Table block={block} />;
  const List = block.ordered ? "ol" : "ul";
  return (
    <List>
      {block.items.map((item, i) => (
        <li key={i}>
          <Inline parts={item} />
        </li>
      ))}
    </List>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="brief-body">
      {parseMarkdown(text).map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
