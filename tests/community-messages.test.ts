import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** `docs/community.md` is Collector's outreach file (collector#17, rewritten as one-line messages by #39). Nothing
 * in it has been sent: James sends from #26. These are that card's done-when items, read off the file itself, so a
 * later edit cannot quietly wrap a message onto two lines, push one past the length, or drop a link. */
const REPO = "https://github.com/dividendsolo/collector";
const MESSAGE = /^Draft message \(one line, (\d+) characters\):\n\n(.+)$/gm;
const community = () => fs.readFileSync(path.join(process.cwd(), "docs", "community.md"), "utf8");
/** The ten draft messages, each with the length it prints beside it. The count is checked here so that a test
 * looping over them can never pass on an empty list. */
const messages = () => {
  const found = [...community().matchAll(MESSAGE)].map((m) => ({ stated: Number(m[1]), text: m[2] as string }));
  expect(found).toHaveLength(10);
  return found;
};

describe("docs/community.md", () => {
  it("holds ten draft messages, one for each of the ten people", () => {
    expect(community().match(/^### \d+\. /gm)).toHaveLength(10);
    expect(messages()).toHaveLength(10);
  });

  it("writes each message as exactly one line, under 300 characters, and says so correctly", () => {
    for (const { stated, text } of messages()) {
      expect(text).not.toContain("\n");
      expect(text.length).toBeLessThan(300);
      expect(stated).toBe(text.length);
    }
  });

  it("names Collector as a free page that shows every agent and job across machines, and links the repo", () => {
    for (const { text } of messages()) {
      expect(text).toContain("I built Collector, a free page that shows every agent and job across");
      expect(text).toContain(REPO);
    }
  });

  it("ends each message with the one question", () => {
    for (const { text } of messages()) expect(text.endsWith("Does it catch your case?")).toBe(true);
  });

  it("keeps every person's own post linked under their heading", () => {
    const sections = community()
      .split(/^### \d+\. /gm)
      .slice(1);
    expect(sections).toHaveLength(10);
    // The post is the linked line the heading opens on, above the message: the person's own words, for checking.
    for (const section of sections) expect(section).toMatch(/^\[[^\]]+\]\(https?:\/\/\S+\)/m);
  });
});
