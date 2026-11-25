import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type InboxMessage, inboxRows, inboxTime, isInboxId, keyOf, unhandled } from "@/lib/inbox";

const ROOT = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-inbox-"));
const envBefore = process.env.COLLECTOR_CONFIG;
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");
const STATE = path.join(dir, "inbox.json");
fs.writeFileSync(process.env.COLLECTOR_CONFIG, JSON.stringify({ machines: [{ name: "altair" }] }));

const fake = vi.hoisted(() => ({ machines: [] as any[] }));

vi.mock("@/lib/server/machines", () => ({
  snapshot: { get: async () => ({ at: 1_763_000_000, machines: fake.machines }) },
}));

type Handler = (req: Request) => Response | Promise<Response>;
let list: Handler;
let save: Handler;

beforeAll(async () => {
  const route = await import("@/app/api/inbox/route");
  list = route.GET;
  save = route.POST;
});

beforeEach(() => {
  fs.rmSync(STATE, { force: true });
  fake.machines = [];
});

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4000";
const PAGE = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" };

const get = (headers: Record<string, string> = { host: HOST }) =>
  list(new Request(`http://${HOST}/api/inbox`, { headers }));
const post = (body: unknown, headers: Record<string, string> = PAGE) =>
  save(new Request(`http://${HOST}/api/inbox`, { method: "POST", headers, body: JSON.stringify(body) }));

interface Row {
  id: string;
  source: string;
  text: string;
  href: string | null;
  at: number | null;
}

function read(files: Record<string, { content: string }>): Row[] {
  return JSON.parse(
    execFileSync("python3", [path.join(ROOT, "tests", "inbox.driver.py")], {
      cwd: ROOT,
      input: JSON.stringify({ files }),
      encoding: "utf8",
    }),
  ) as Row[];
}

const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    at: "2026-11-25T13:16:00Z",
    id: "signal:1",
    source: "deploy-watch",
    text: "deployed situation 4f2a1c",
    href: "https://github.com/dividendsolo/situation/pull/9",
    ...over,
  });
const file = (...lines: string[]) => ({ "inbox/signal.jsonl": { content: `${lines.join("\n")}\n` } });

const at = (iso: string) => Date.parse(iso) / 1000;

describe("collect.py's inbox read", () => {
  it("reads one line as one message, with its id, source, text, link and time", () => {
    expect(read(file(line()))).toEqual([
      {
        id: "signal:1",
        source: "deploy-watch",
        text: "deployed situation 4f2a1c",
        href: "https://github.com/dividendsolo/situation/pull/9",
        at: at("2026-11-25T13:16:00Z"),
      },
    ]);
  });

  it("reads every inbox file, oldest first", () => {
    const other = {
      "inbox/lead-watch.jsonl": {
        content: `${line({ at: "2026-11-25T14:00:00Z", id: "signal:2", text: "4 leads" })}\n`,
      },
    };
    expect(read({ ...file(line()), ...other }).map((r) => r.id)).toEqual(["signal:1", "signal:2"]);
  });

  it("gives a line with no id of its own the same id every read", () => {
    const [first] = read(file(line({ id: undefined })));
    const [again] = read(file(line({ id: undefined })));
    expect(first.id).toBe(again.id);
    expect(first.id).toHaveLength(16);
    const [other] = read(file(line({ id: undefined, text: "something else" })));
    expect(other.id).not.toBe(first.id);
  });

  it("skips a line it cannot read, rather than taking the machine's read down with it", () => {
    const rows = read(file("# a note the writer left", "{ not json", "[1,2]", '{"id":"no-text"}', line()));
    expect(rows.map((r) => r.text)).toEqual(["deployed situation 4f2a1c"]);
  });

  it("keeps only a web address as the link, since the page puts it in an href", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "//example.com/x"]) {
      expect(read(file(line({ href })))[0].href).toBeNull();
    }
    expect(read(file(line({ href: "http://example.com/a" })))[0].href).toBe("http://example.com/a");
    expect(read(file(line({ href: undefined })))[0].href).toBeNull();
  });

  it("keeps a line with no readable `at`, and one with no source", () => {
    expect(read(file(line({ at: undefined })))[0]).toMatchObject({ at: null, source: "deploy-watch" });
    expect(read(file(line({ source: undefined })))[0]).toMatchObject({ source: "", at: at("2026-11-25T13:16:00Z") });
  });

  it("keeps the machine's key on a read with no inbox folder at all", () => {
    const out = JSON.parse(execFileSync("python3", ["collect.py"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
    expect(Array.isArray(out.inbox)).toBe(true);
  });
});

describe("the inbox's own rules", () => {
  const row = (over: Partial<InboxMessage> = {}): InboxMessage => ({
    machine: "altair",
    id: "signal:1",
    source: "deploy-watch",
    text: "a message",
    href: null,
    at: 1_763_000_000,
    handled: false,
    ...over,
  });

  it("puts the unhandled first and the newest first", () => {
    const rows = [
      row({ id: "old", at: 100 }),
      row({ id: "handled-new", at: 400, handled: true }),
      row({ id: "new", at: 300 }),
      row({ id: "handled-old", at: 200, handled: true }),
    ];
    expect(inboxRows(rows).map((r) => r.id)).toEqual(["new", "old", "handled-new", "handled-old"]);
  });

  it("counts what nobody handled yet", () => {
    expect(unhandled([row(), row({ id: "b", handled: true })])).toHaveLength(1);
  });

  it("names one row by its machine and its id", () => {
    expect(keyOf({ machine: "ezio", id: "signal:9" })).toBe("ezio/signal:9");
    expect(isInboxId("signal:9")).toBe(true);
    expect(isInboxId("")).toBe(false);
    expect(isInboxId("a\nb")).toBe(false);
    expect(isInboxId("trailing\n")).toBe(false);
    expect(isInboxId("x".repeat(201))).toBe(false);
    expect(isInboxId("signal:café")).toBe(true);
    expect(isInboxId("x".repeat(200))).toBe(true);
    expect(isInboxId(9)).toBe(false);
    expect(isInboxId(undefined)).toBe(false);
  });

  it("shows a time in the viewer's own zone, with the day in front when it was not today", () => {
    expect(inboxTime(null)).toBe("—");
    expect(inboxTime(Math.floor(Date.now() / 1000))).toMatch(/^\d{2}:\d{2}/);
    expect(inboxTime(0)).toMatch(/^[A-Z][a-z]{2} \d/);
  });
});

describe("a message on the page", () => {
  it("shows a line as one unhandled row, and Handled moves it out of unhandled", async () => {
    fake.machines = [{ name: "altair", inbox: read(file(line())) }];
    const before = await (await get()).json();
    expect(before.unhandled).toBe(1);
    expect(before.rows.map((r: InboxMessage) => [r.machine, r.id, r.text, r.handled])).toEqual([
      ["altair", "signal:1", "deployed situation 4f2a1c", false],
    ]);

    const moved = await (await post({ machine: "altair", id: "signal:1", handled: true })).json();
    expect(moved.unhandled).toBe(0);
    expect(moved.rows.map((r: InboxMessage) => [r.id, r.handled])).toEqual([["signal:1", true]]);
    expect(JSON.parse(fs.readFileSync(STATE, "utf8"))).toEqual({ handled: ["altair/signal:1"] });

    const after = await (await get()).json();
    expect(after.unhandled).toBe(0);
    expect(after.rows[0].handled).toBe(true);
  });

  it("keeps Handled per row id, so one row's Handled leaves the other unhandled", async () => {
    fake.machines = [
      {
        name: "altair",
        inbox: read(file(line(), line({ at: "2026-11-25T14:00:00Z", id: "signal:2", text: "second" }))),
      },
    ];
    await post({ machine: "altair", id: "signal:1", handled: true });
    const view = await (await get()).json();
    expect(view.rows.map((r: InboxMessage) => [r.id, r.handled])).toEqual([
      ["signal:2", false],
      ["signal:1", true],
    ]);
    expect(view.unhandled).toBe(1);
  });

  it("puts a row back in the inbox on Undo", async () => {
    fake.machines = [{ name: "altair", inbox: read(file(line())) }];
    await post({ machine: "altair", id: "signal:1", handled: true });
    const back = await (await post({ machine: "altair", id: "signal:1", handled: false })).json();
    expect(back.unhandled).toBe(1);
    expect(JSON.parse(fs.readFileSync(STATE, "utf8"))).toEqual({ handled: [] });
  });

  it("reads the same row from another machine as a row of its own", async () => {
    fake.machines = [
      { name: "altair", inbox: read(file(line())) },
      { name: "ezio", inbox: read(file(line())) },
    ];
    await post({ machine: "altair", id: "signal:1", handled: true });
    const view = await (await get()).json();
    expect(view.unhandled).toBe(1);
    expect(view.rows.map((r: InboxMessage) => [r.machine, r.handled])).toEqual([
      ["ezio", false],
      ["altair", true],
    ]);
  });

  it("refuses a write that is not one row, and a broken state file rather than overwriting it", async () => {
    expect((await post({ machine: "", id: "signal:1", handled: true })).status).toBe(400);
    expect((await post({ machine: "altair", id: "signal:1" })).status).toBe(400);
    expect((await post({ machine: "altair", id: "a\u0000b", handled: true })).status).toBe(400);
    expect((await post({ machine: "altair", id: "x".repeat(201), handled: true })).status).toBe(400);
    expect((await post({ machine: "altair", id: "signal:1", handled: "yes" })).status).toBe(400);

    fs.writeFileSync(STATE, "{ not json");
    const refused = await post({ machine: "altair", id: "signal:1", handled: true });
    expect(refused.status).toBe(409);
    expect((await refused.json()).why).toContain(STATE);
    expect(fs.readFileSync(STATE, "utf8")).toBe("{ not json");
  });

  it("says so when a machine could not be read, rather than showing an empty inbox", async () => {
    fake.machines = [{ name: "ezio", error: "ssh: connect to host ezio port 22: timed out" }];
    expect((await (await get()).json()).why).toContain("ezio could not be read");
  });
});
