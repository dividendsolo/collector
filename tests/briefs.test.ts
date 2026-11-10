import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { archived, type Brief, inbox, isBriefFile, keyOf } from "@/lib/briefs";

/**
 * The Briefs page (collector#64). Three halves:
 *
 * - the read on the machine: `collect.py`'s own folder reader, driven through `tests/briefs.driver.py`, so the
 *   reading a machine does is tested against the real Python and the writer's own file names;
 * - the rules the page shows: the Inbox is every brief that is not Archived, oldest first, and the sidebar's count is
 *   that list's length;
 * - this machine's state: opening a brief makes it Read, Archive files it out of the Inbox, and both live in
 *   `briefs.json` beside `config.json` — a browser reset and a Collector restart both leave them there.
 *
 * COLLECTOR_CONFIG is read once, at import time (`lib/server/paths.ts`), so the temp folder is set before the route
 * loads (the same shape as tests/proposals.test.ts) and neither `briefs.json` nor anything else lands in the repo.
 * The machines are mocked: a brief's file is read on another machine over ssh, which no test does.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-briefs-"));
const envBefore = process.env.COLLECTOR_CONFIG;
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");
const STATE = path.join(dir, "briefs.json");
const REPO_STATE = path.join(process.cwd(), "briefs.json");
fs.writeFileSync(
  process.env.COLLECTOR_CONFIG,
  JSON.stringify({ machines: [{ name: "altair" }, { name: "ezio", ssh: "ezio" }] }),
);

/** What the mocked machine read answers, per test. */
const fake = vi.hoisted(() => ({
  machines: [] as any[],
  brief: null as any,
  asked: [] as string[],
}));

vi.mock("@/lib/server/machines", () => ({
  snapshot: { get: async () => ({ at: 1_763_000_000, machines: fake.machines }) },
  collect: async (_machine: unknown, _cfg: unknown, file: string) => {
    fake.asked.push(file);
    return [fake.brief, null];
  },
}));

type Handler = (req: Request) => Response | Promise<Response>;
let list: Handler;
let one: Handler;
let save: Handler;

beforeAll(async () => {
  const route = await import("@/app/api/briefs/route");
  list = route.GET;
  save = route.POST;
  one = (await import("@/app/api/brief/route")).GET;
});

beforeEach(() => {
  fs.rmSync(STATE, { force: true });
  fake.brief = null;
  fake.asked = [];
});

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4000";
/** The page's own click: this origin, JSON, the way components/briefs.tsx sends it. */
const PAGE = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" };

const get = (url: string, headers: Record<string, string> = { host: HOST }) => list(new Request(url, { headers }));
const open = (machine: string, file: string, headers: Record<string, string> = { host: HOST }) =>
  one(
    new Request(`http://${HOST}/api/brief?machine=${encodeURIComponent(machine)}&file=${encodeURIComponent(file)}`, {
      headers,
    }),
  );
const post = (body: unknown, headers: Record<string, string> = PAGE) =>
  save(new Request(`http://${HOST}/api/briefs`, { method: "POST", headers, body: JSON.stringify(body) }));

const state = () => JSON.parse(fs.readFileSync(STATE, "utf8"));

/** A brief's file name as the writer makes it: `<UTC stamp>-<slug>-<6 hex>.md`. */
const file = (stamp: string, slug: string, hex = "ab12cd") => `${stamp}-${slug}-${hex}.md`;
const LEAD = file("2026-11-08T141717Z", "lead-watch");
const ILLYISM = file("2026-11-08T030102Z", "illyism-watch", "ffeedd");
const LAB = file("2026-11-07T113141Z", "lab-droid", "001122");

/** One machine's rows as `collect.py` answers them: oldest first, the writer's own names. */
const on = (name: string, ...files: string[]) => ({
  name,
  briefs: files.map((f) => ({
    file: f,
    brief: f.includes("lead")
      ? "Lead Watch"
      : f.includes("illyism")
        ? "Illyism Watch"
        : f.includes("lab")
          ? "Lab Droid"
          : null,
    subject: f.includes("lead") ? "Lead Watch - 2026-11-08 - 3 leads" : `A brief - ${f.slice(0, 10)}`,
    sent_at: `${f.slice(0, 10)}T${f.slice(11, 13)}:${f.slice(13, 15)}:${f.slice(15, 17)}Z`,
  })),
});

const rows = async () => {
  const body = await (await get(`http://${HOST}/api/briefs`)).json();
  return body as { at: number; inbox: Brief[]; archived: Brief[]; why?: string };
};

describe("collect.py's brief folder read (collector#64)", () => {
  /** One case against the real reader, through the driver the way `tests/watch.driver.py` drives its own. */
  const read = (spec: unknown) =>
    JSON.parse(
      execFileSync("python3", [path.join(process.cwd(), "tests", "briefs.driver.py")], {
        cwd: process.cwd(),
        input: JSON.stringify(spec),
        encoding: "utf8",
      }),
    ) as { rows: any[]; one: any; missing: any };

  const brief = (front: string, body = "# Lead Watch - 2026-11-08\n\nHello.\n") => ({ content: `${front}${body}` });

  it("reads the folder's rows, oldest first, with the front matter they carry", () => {
    const out = read({
      files: {
        [LEAD]: brief(
          "---\nbrief: Lead Watch\nsubject: Lead Watch - 2026-11-08 - 3 leads\nsent_at: 2026-11-08T14:17:17Z\nresend_id: 9f2\n---\n",
        ),
        [ILLYISM]: brief(
          "---\nbrief: Illyism Watch\nsubject: Illyism Watch - 2026-11-08\nsent_at: 2026-11-08T03:01:02Z\n---\n",
        ),
      },
    });
    expect(out.rows).toEqual([
      { file: ILLYISM, brief: "Illyism Watch", subject: "Illyism Watch - 2026-11-08", sent_at: "2026-11-08T03:01:02Z" },
      {
        file: LEAD,
        brief: "Lead Watch",
        subject: "Lead Watch - 2026-11-08 - 3 leads",
        sent_at: "2026-11-08T14:17:17Z",
      },
    ]);
  });

  it("skips the writer's half-written dot-file and anything that is not a brief", () => {
    const out = read({
      files: {
        [LEAD]: brief("---\nbrief: Lead Watch\n---\n"),
        [`.${LEAD}.tmp`]: { content: "---\nbrief: Lead Watch\n" },
        "leads-hits-2026-11-08.json": { content: "{}" },
        "notes.txt": { content: "hello" },
      },
    });
    expect(out.rows.map((r: any) => r.file)).toEqual([LEAD]);
  });

  it("reads one brief whole: its front matter, then its Markdown", () => {
    const out = read({
      files: {
        [LEAD]: brief(
          "---\nbrief: Lead Watch\nsubject: Lead Watch - 2026-11-08 - 3 leads\nsent_at: 2026-11-08T14:17:17Z\n---\n",
          "# Lead Watch - 2026-11-08\n\n1. https://x.com/someone/status/1\n   Asked for:   a landing-page roast\n",
        ),
      },
      read: LEAD,
    });
    expect(out.one).toEqual({
      file: LEAD,
      brief: "Lead Watch",
      subject: "Lead Watch - 2026-11-08 - 3 leads",
      sent_at: "2026-11-08T14:17:17Z",
      body: "# Lead Watch - 2026-11-08\n\n1. https://x.com/someone/status/1\n   Asked for:   a landing-page roast",
    });
  });

  it("reads a brief with no front matter as its own body rather than dropping it", () => {
    const out = read({ files: { [LEAD]: { content: "# A brief someone wrote by hand\n" } }, read: LEAD });
    expect(out.one).toMatchObject({ brief: null, subject: null, sent_at: null });
    expect(out.one.body).toBe("# A brief someone wrote by hand");
  });

  it("answers null for a brief that is no longer there, and never reads outside the folder", () => {
    const out = read({ files: { [LEAD]: brief("---\nbrief: Lead Watch\n---\n") }, read: "../../etc/passwd" });
    expect(out.one).toBe(null);
    const gone = read({ files: {}, missing: file("2026-11-01T000000Z", "lead-watch", "zzzzzz") });
    expect(gone.missing).toBe(null);
  });

  it("reads no folder as no briefs, the way every other read here reads without its file", () => {
    expect(read({ files: {} }).rows).toEqual([]);
  });
});

describe("an Inbox of briefs on two machines (collector#64)", () => {
  it("reads every machine's briefs as one list, oldest first", async () => {
    fake.machines = [on("altair", LAB), on("ezio", LEAD, ILLYISM)];
    const { inbox: list } = await rows();
    expect(list.map((b) => b.file)).toEqual([LAB, ILLYISM, LEAD]);
    expect(list.map((b) => b.machine)).toEqual(["altair", "ezio", "ezio"]);
    expect(list[2].subject).toBe("Lead Watch - 2026-11-08 - 3 leads");
    expect(list.every((b) => !b.read && !b.archived)).toBe(true);
  });

  it("is empty with no briefs anywhere, and says why when a machine could not be read", async () => {
    fake.machines = [on("altair"), { name: "ezio", error: "ssh: connect to host ezio port 22: Connection refused" }];
    const body = await rows();
    expect(body.inbox).toEqual([]);
    expect(body.archived).toEqual([]);
    // One plain line, naming the machine: an empty Inbox on a machine nothing read would be a lie.
    expect(body.why).toBe("ezio could not be read: ssh: connect to host ezio port 22: Connection refused");
  });
});

describe("opening a brief makes it Read (collector#64)", () => {
  it("reads it on the click, keeps it in the Inbox, and the state is on this machine", async () => {
    fake.machines = [on("ezio", ILLYISM, LEAD)];
    expect((await post({ machine: "ezio", file: LEAD, read: true })).status).toBe(200);
    // The file beside config.json holds it, so a browser reset and a Collector restart both leave it read.
    expect(state()).toEqual({ read: [keyOf({ machine: "ezio", file: LEAD })], archived: [] });
    const body = await rows();
    expect(body.inbox.map((b) => b.file)).toEqual([ILLYISM, LEAD]);
    expect(body.inbox[1]).toMatchObject({ read: true, archived: false });
    expect(body.inbox[0].read).toBe(false);
  });

  it("never puts the state file in the repo", async () => {
    const before = fs.existsSync(REPO_STATE);
    await post({ machine: "ezio", file: LEAD, read: true });
    expect(fs.existsSync(REPO_STATE)).toBe(before);
  });

  it("answers the view after the click, so the page needs one call", async () => {
    fake.machines = [on("ezio", LEAD)];
    const body = await (await post({ machine: "ezio", file: LEAD, read: true })).json();
    expect(body.inbox[0]).toMatchObject({ file: LEAD, read: true });
    expect(body.at).toBe(1_763_000_000);
  });
});

describe("Archive takes a brief out of the Inbox (collector#64)", () => {
  it("moves it to the Archived section, newest first, out of the count, and still open", async () => {
    fake.machines = [on("ezio", ILLYISM, LEAD, LAB)];
    await post({ machine: "ezio", file: LEAD, read: true });
    await post({ machine: "ezio", file: LAB, archived: true });
    const body = await rows();
    expect(body.inbox.map((b) => b.file)).toEqual([ILLYISM, LEAD]);
    expect(body.archived.map((b) => b.file)).toEqual([LAB]); // and newest first: a second, older one lands under it
    await post({ machine: "ezio", file: ILLYISM, archived: true });
    const after = await rows();
    expect(after.archived.map((b) => b.file)).toEqual([ILLYISM, LAB]);
    expect(after.inbox.map((b) => b.file)).toEqual([LEAD]);
    // An archived brief still opens.
    fake.brief = { file: ILLYISM, brief: "Illyism Watch", subject: "x", sent_at: "y", body: "# Illyism Watch\n" };
    const opened = await (await open("ezio", ILLYISM)).json();
    expect(opened.brief).toMatchObject({ file: ILLYISM, archived: true, body: "# Illyism Watch\n" });
  });

  it("never counts an archived brief on the sidebar", async () => {
    fake.machines = [on("ezio", ILLYISM, LEAD, LAB)];
    expect((await rows()).inbox).toHaveLength(3);
    await post({ machine: "ezio", file: LEAD, archived: true });
    expect((await rows()).inbox).toHaveLength(2);
  });
});

describe("opening one brief (collector#64)", () => {
  it("reads that one file on the machine that keeps it, and its state here", async () => {
    fake.brief = {
      file: LEAD,
      brief: "Lead Watch",
      subject: "Lead Watch - 2026-11-08 - 3 leads",
      sent_at: "2026-11-08T14:17:17Z",
      body: "# Lead Watch - 2026-11-08\n\n| Source | Views |\n| --- | --- |\n| Search | 143 |\n",
    };
    await post({ machine: "ezio", file: LEAD, read: true });
    const body = await (await open("ezio", LEAD)).json();
    expect(fake.asked).toEqual([LEAD]); // one file read, over the ssh the snapshot uses
    expect(body.brief).toMatchObject({
      machine: "ezio",
      file: LEAD,
      read: true,
      archived: false,
      body: "# Lead Watch - 2026-11-08\n\n| Source | Views |\n| --- | --- |\n| Search | 143 |\n",
    });
  });

  it("refuses a machine config.json does not name, and a file name that is a path", async () => {
    fake.brief = { file: LEAD, body: "x" };
    expect((await open("nowhere", LEAD)).status).toBe(404);
    expect((await (await open("nowhere", LEAD)).json()).why).toBe("config.json has no machine named nowhere");
    for (const file of ["../../etc/passwd", "/etc/passwd", ".hidden.md", "notes.txt", ""]) {
      expect((await open("ezio", file)).status, file).toBe(400);
    }
    expect(fake.asked).toEqual([]); // nothing was read anywhere
  });

  it("says the one line when the machine has no such brief", async () => {
    fake.brief = null;
    const r = await open("ezio", LEAD);
    expect(r.status).toBe(404);
    expect((await r.json()).why).toBe(`ezio has no brief ${LEAD}`);
  });
});

describe("a Briefs state file the page cannot read (collector#64)", () => {
  it("refuses the write, leaves the file byte for byte, and says why on the read", async () => {
    fake.machines = [on("ezio", LEAD)];
    const broken = '{"read": ["ezio/a.md",],}\n';
    fs.writeFileSync(STATE, broken);
    const r = await post({ machine: "ezio", file: LEAD, read: true });
    expect(r.status).toBe(409);
    expect((await r.json()).why).toContain(STATE);
    expect(fs.readFileSync(STATE, "utf8")).toBe(broken);
    // The briefs are still there — the file holds what he read, not what he read — with the one line that says why.
    const body = await rows();
    expect(body.inbox.map((b) => b.file)).toEqual([LEAD]);
    expect(body.inbox[0].read).toBe(false);
    expect(body.why).toContain(STATE);
  });

  it("reads a hand-edited file for what it is: the string keys, each one once", async () => {
    fs.writeFileSync(STATE, JSON.stringify({ read: [keyOf({ machine: "ezio", file: LEAD }), 7, null, "x", "x"] }));
    fake.machines = [on("ezio", LEAD)];
    const body = await rows();
    expect(body.inbox[0]).toMatchObject({ read: true });
    // A key the page does not know is kept: its machine may simply not have answered this read, and a brief must not
    // silently become unread because of it.
    await post({ machine: "ezio", file: ILLYISM, archived: true });
    expect(state()).toEqual({
      read: [keyOf({ machine: "ezio", file: LEAD }), "x"],
      archived: [keyOf({ machine: "ezio", file: ILLYISM })],
    });
  });
});

describe("what the write route refuses (collector#64)", () => {
  it("refuses a write from another site, and stores nothing", async () => {
    const r = await post(
      { machine: "ezio", file: LEAD, read: true },
      { host: HOST, origin: "https://evil.example.com", "sec-fetch-site": "cross-site" },
    );
    expect(r.status).toBe(403);
    expect((await r.json()).why).toBe("a write comes from this page only");
    expect(fs.existsSync(STATE)).toBe(false);
  });

  it("refuses a body that is not JSON, one with no machine, a file that is a path, and a write that sets nothing", async () => {
    const empty = new Request(`http://${HOST}/api/briefs`, { method: "POST", headers: { host: HOST } });
    expect((await save(empty)).status).toBe(400);
    for (const body of [
      { file: LEAD, read: true },
      { machine: "ezio", file: "../../etc/passwd", read: true },
      { machine: "ezio", file: LEAD },
      { machine: "ezio", file: LEAD, read: "yes" },
      { machine: "ezio", file: LEAD, archived: 1 },
      ["ezio", LEAD],
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(fs.existsSync(STATE)).toBe(false);
  });

  it("answers a shell or an agent that sends no browser headers, as every other write does", async () => {
    fake.machines = [];
    expect((await post({ machine: "ezio", file: LEAD, read: true }, { host: HOST })).status).toBe(200);
  });
});

describe("the rules the page shows (collector#64)", () => {
  const at = (file: string, over: Partial<Brief> = {}): Brief => ({
    machine: "ezio",
    file,
    brief: "Lead Watch",
    subject: "Lead Watch",
    sent_at: null,
    read: false,
    archived: false,
    ...over,
  });

  it("is the Inbox, oldest first, and everything archived is out of it", () => {
    const briefs = [
      at(LEAD),
      at(ILLYISM, { read: true }),
      at(LAB, { archived: true }),
      at(file("2026-11-09T030102Z", "illyism-watch", "aabbcc"), { archived: true }),
    ];
    expect(inbox(briefs).map((b) => b.file)).toEqual([ILLYISM, LEAD]);
    expect(archived(briefs).map((b) => b.file)).toEqual([file("2026-11-09T030102Z", "illyism-watch", "aabbcc"), LAB]);
    // The briefs a machine answered in some other order are sorted, not trusted.
    expect(inbox([at(LEAD), at(ILLYISM)]).map((b) => b.file)).toEqual([ILLYISM, LEAD]);
  });

  it("counts what the sidebar shows: every brief in the Inbox, read or not", () => {
    expect(inbox([])).toHaveLength(0);
    expect(inbox([at(LEAD, { archived: true })])).toHaveLength(0);
    expect(inbox([at(LEAD, { read: true }), at(ILLYISM), at(LAB, { archived: true })])).toHaveLength(2);
  });

  it("refuses a file name that is a path, and takes the writer's own names", () => {
    expect(isBriefFile(LEAD)).toBe(true);
    expect(isBriefFile("2026-11-08T141717Z-lead-watch-ab12cd.md")).toBe(true);
    for (const bad of ["../../etc/passwd", "/etc/passwd", ".hidden.md", "notes.txt", "a/b.md", "", null, 7])
      expect(isBriefFile(bad), String(bad)).toBe(false);
  });
});
