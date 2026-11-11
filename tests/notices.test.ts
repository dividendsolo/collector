import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acked } from "@/components/acks";
import { warnings } from "@/lib/server/warnings";
import { noticeToasts } from "@/lib/toasts";

/**
 * Job notices (collector#82). The weekly directory-listings job on ezio appends one JSON line per newly live listing
 * to `~/.hermes/notices/directory-listings.jsonl`, and the page shows each line once: one toast and one Needs
 * attention row, linking to the listing, gone once it is acknowledged. Collector had no path for a job's good news —
 * toasts came only from services and the network, and Needs attention only from failures.
 *
 * The reading lives in collect.py, which runs on each machine, so these fixtures go through the real Python:
 * `tests/notices.driver.py` writes the case's files into a throwaway home and hands one case to `collect.notices_rows`
 * with the case's own `now`, so a fixture reads the same on every machine and at every hour.
 */
const ROOT = process.cwd();
const NOW = "2026-11-09T12:00:00-05:00";

interface Row {
  key: string;
  level: string;
  text: string;
  href: string | null;
  at: number | null;
}

function read(files: Record<string, { content: string }>): Row[] {
  return JSON.parse(
    execFileSync("python3", [path.join(ROOT, "tests", "notices.driver.py")], {
      cwd: ROOT,
      input: JSON.stringify({ now: NOW, files }),
      encoding: "utf8",
    }),
  ) as Row[];
}

/** The line the job writes when a listing goes live, with the card's own shape. */
const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    at: "2026-11-09T15:45:00Z",
    key: "directory-listing:https://example.com/situation",
    level: "info",
    text: "Situation is listed on Example Directory",
    href: "https://example.com/situation",
    ...over,
  });
const file = (...lines: string[]) => ({
  "notices/directory-listings.jsonl": { content: `${lines.join("\n")}\n` },
});

const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;
const machine = (notices: Row[]) => ({ name: "ezio", notices });

describe("collect.py's notices read", () => {
  it("reads one line as one notice, with the key, text, link and time it names", () => {
    expect(read(file(line()))).toEqual([
      {
        key: "directory-listing:https://example.com/situation",
        level: "info",
        text: "Situation is listed on Example Directory",
        href: "https://example.com/situation",
        at: Date.parse("2026-11-09T15:45:00Z") / 1000,
      },
    ]);
  });

  it("drops a line older than three weeks — the file's own record of a listing, not news", () => {
    expect(read(file(line({ at: "2026-10-01T00:00:00Z" })))).toEqual([]);
    // The boundary is the reader's own setting, so a line just inside it is still read.
    expect(read(file(line({ at: "2026-10-19T17:01:00Z" })))).toHaveLength(1);
  });

  it("reads the newest lines of every notices file, oldest first", () => {
    const other = { "notices/other-job.jsonl": { content: `${line({ at: "2026-11-09T16:00:00Z", key: "other" })}\n` } };
    expect(read({ ...file(line()), ...other }).map((r) => r.key)).toEqual([
      "directory-listing:https://example.com/situation",
      "other",
    ]);
  });

  it("skips a line it cannot read, rather than taking the machine's read down with it", () => {
    const rows = read(file("# a comment the job left", "{ not json", "[1,2]", '{"key":"no-text"}', line()));
    expect(rows.map((r) => r.text)).toEqual(["Situation is listed on Example Directory"]);
  });

  it("keeps a line with no readable `at`, and reads one with no key or link", () => {
    expect(read(file(line({ at: undefined })))[0]).toMatchObject({ at: null, level: "info" });
    expect(read(file(line({ level: undefined, href: undefined })))[0]).toMatchObject({
      level: "info",
      href: null,
      key: "directory-listing:https://example.com/situation",
    });
  });

  it("keeps only a web address as the link, since the page puts it in an href", () => {
    // The line's href comes from outside data (a directory's own URL) and ends up in an <a href> on a page whose own
    // origin can restart the server and write config.json: a scheme that runs script there is not a link.
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "file:///etc/passwd",
      "//example.com/x",
    ]) {
      const [row] = read(file(line({ href })));
      expect([href, row.href]).toEqual([href, null]);
      expect(warnings({ ...base, machines: [machine(read(file(line({ href }))))] })[0].url).toBeUndefined();
    }
    expect(read(file(line({ href: "http://example.com/a" })))[0].href).toBe("http://example.com/a");
  });

  it("keeps the machine's key on a read with no notices files at all", () => {
    const out = JSON.parse(execFileSync("python3", ["collect.py"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    expect(Array.isArray(out.notices)).toBe(true);
  });
});

describe("a job's notice on the page", () => {
  it("is one Needs attention row with its text, linking to the listing, acknowledged by its own key", () => {
    const rows = read(file(line()));
    expect(warnings({ ...base, machines: [machine(rows)] })).toEqual([
      {
        group: "good-news",
        level: "warn",
        text: "Situation is listed on Example Directory",
        url: "https://example.com/situation",
        ack: { key: "directory-listing:https://example.com/situation", next: null },
      },
    ]);
    // Good news is not an error: no alarm sound and no red row.
    expect(acked(warnings({ ...base, machines: [machine(rows)] })[0], [])).toBe(false);
  });

  it("is one toast whose title is the news and whose link is the listing", () => {
    const notices = read(file(line()));
    expect(noticeToasts([machine(notices)])).toEqual([
      {
        key: "directory-listing:https://example.com/situation",
        state: "Situation is listed on Example Directory",
        level: "warn",
        title: "Situation is listed on Example Directory",
        text: "https://example.com/situation",
        href: "https://example.com/situation",
      },
    ]);
    // A notice with no link still leads somewhere: the row that acknowledges it.
    expect(noticeToasts([machine(read(file(line({ href: undefined }))))])[0].href).toBe("#/dashboard?to=attention");
  });

  it("keeps the row and the toast on the Dashboard for a link that is not a web address", () => {
    // Card #84: the page's own allowlist, not the reader's. A machine whose collect.py is older still sends the line
    // as it read it, and that href lands in an `<a href>` on this origin, so the row and the toast drop it.
    const notices = [{ key: "k", level: "info", text: "Situation is listed", href: "javascript:alert(1)", at: null }];
    expect(warnings({ ...base, machines: [machine(notices)] })[0].url).toBeUndefined();
    expect(noticeToasts([machine(notices)])[0]).toEqual({
      key: "k",
      state: "Situation is listed",
      level: "warn",
      title: "Situation is listed",
      text: "",
      href: "#/dashboard?to=attention",
    });
  });

  it("gives neither a toast nor a row once its key is acknowledged", () => {
    const notices = read(file(line()));
    const key = notices[0].key;
    expect(noticeToasts([machine(notices)], [key])).toEqual([]);
    const row = warnings({ ...base, machines: [machine(notices)] })[0];
    expect(acked(row, [key])).toBe(true);
  });
});
