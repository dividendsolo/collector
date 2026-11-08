import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Proposal, pipelineValue } from "@/lib/proposals";

/**
 * The Proposals page's one write route (collector#77). Two halves, the way the card's security section has them:
 *
 * - the route parses every field itself, so markup with a link, a 101-character title, a status outside the five, an
 *   amount past ten million, a currency that is not three letters and a date that is not a real day are all refused
 *   before anything is stored;
 * - the guard (collector#69) refuses a write from another site, while the page's own click and a shell are answered.
 *
 * COLLECTOR_CONFIG is read once, at import time (`lib/server/paths.ts`), so the temp folder is set before the route
 * loads and `proposals.json` lands there — never in the repo, which is public (AGENTS.md, Dangers; the same shape as
 * tests/projects-save.test.ts). Every test starts from no file, so each one stands on its own.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-proposals-"));
const envBefore = process.env.COLLECTOR_CONFIG;
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");
/** The file the route writes, and the one an unset COLLECTOR_CONFIG would have written. */
const FILE = path.join(dir, "proposals.json");
const REPO_FILE = path.join(process.cwd(), "proposals.json");
/** size:mtime, or "missing": a file that never existed and one left alone read the same twice (tests/projects-save). */
const stamp = (p: string) => {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "missing";
  }
};

type Handler = (req: Request) => Response | Promise<Response>;
let GET: Handler;
let POST: Handler;
let PUT: Handler;
let DELETE: Handler;

beforeAll(async () => {
  const route = await import("@/app/api/proposals/route");
  GET = route.GET;
  POST = route.POST;
  PUT = route.PUT;
  DELETE = route.DELETE;
});

beforeEach(() => fs.rmSync(FILE, { force: true }));

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4000";
/** The page's own click: this origin, JSON, the way components/pages.tsx sends it. */
const PAGE = { host: HOST, "sec-fetch-site": "same-origin", "content-type": "application/json" };

const post = (body: unknown, headers: Record<string, string> = PAGE) =>
  POST(new Request(`http://${HOST}/api/proposals`, { method: "POST", headers, body: JSON.stringify(body) }));
const put = (body: unknown, headers: Record<string, string> = PAGE) =>
  PUT(new Request(`http://${HOST}/api/proposals`, { method: "PUT", headers, body: JSON.stringify(body) }));
const del = (id: string, headers: Record<string, string> = PAGE) =>
  DELETE(new Request(`http://${HOST}/api/proposals?id=${encodeURIComponent(id)}`, { method: "DELETE", headers }));
const read = () => GET(new Request(`http://${HOST}/api/proposals`, { headers: { host: HOST } }));

const stored = (): Proposal[] => JSON.parse(fs.readFileSync(FILE, "utf8"));
/** How many proposals the file holds (0 when it was never written). */
const count = () => (fs.existsSync(FILE) ? stored().length : 0);
/** One stored proposal, through the route: its id, for the edit and the delete below. */
const one = async (over: Record<string, unknown> = {}) => {
  const r = await post({ ...valid, ...over });
  expect(r.status, JSON.stringify(over)).toBe(200);
  return (await r.json()).proposals.find((p: Proposal) => p.title === (over.title ?? valid.title)) as Proposal;
};

const valid = {
  client: "Acme Corp",
  title: "Website rebuild",
  amount: 5000,
  currency: "USD",
  status: "pending",
  sent_at: "2026-11-01",
  decided_at: null,
  notes: "",
};

describe("what the route refuses before it stores anything (collector#77)", () => {
  it("refuses a client that carries markup and a link, and stores nothing", async () => {
    const r = await post({ ...valid, client: '<h1><a href="https://evil.com">Enter</a></h1>' });
    expect(r.status).toBe(400);
    expect((await r.json()).why).toContain("client");
    expect(count()).toBe(0);
  });

  it("refuses a title of 101 characters, and the same title at 100", async () => {
    expect((await post({ ...valid, title: "t".repeat(101) })).status).toBe(400);
    expect((await post({ ...valid, title: "t".repeat(100) })).status).toBe(200);
    expect(stored()[0].title).toBe("t".repeat(100));
  });

  it("refuses a status outside the five", async () => {
    expect((await post({ ...valid, status: "won" })).status).toBe(400);
    for (const status of ["draft", "pending", "approved", "rejected", "signed"]) {
      expect((await post({ ...valid, status, title: `a ${status} one` })).status, status).toBe(200);
    }
  });

  it("refuses an amount outside 0..10,000,000, a currency that is not three letters, and notes past 1000", async () => {
    for (const amount of [-1, 10_000_001, Number.NaN, "5000"]) {
      expect((await post({ ...valid, amount })).status, String(amount)).toBe(400);
    }
    expect((await post({ ...valid, currency: "USDD" })).status).toBe(400);
    expect((await post({ ...valid, notes: "n".repeat(1001) })).status).toBe(400);
    expect((await post({ ...valid, notes: "see www.evil.com" })).status).toBe(400);
    expect(count()).toBe(0);
  });

  it("refuses a date that is not a real day", async () => {
    expect((await post({ ...valid, sent_at: "2026-02-31" })).status).toBe(400);
    expect((await post({ ...valid, sent_at: "1 November" })).status).toBe(400);
    expect((await post({ ...valid, decided_at: "2026-13-01" })).status).toBe(400);
    expect(count()).toBe(0);
  });

  it("refuses a body that is not JSON, and an edit with no id", async () => {
    const empty = new Request(`http://${HOST}/api/proposals`, { method: "POST", headers: { host: HOST } });
    expect((await POST(empty)).status).toBe(400);
    expect((await put(valid)).status).toBe(400);
    expect(count()).toBe(0);
  });

  it("refuses a write that says it comes from another site", async () => {
    const r = await post(valid, { host: HOST, origin: "https://evil.example.com", "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
    expect((await r.json()).why).toBe("a write comes from this page only");
    expect(count()).toBe(0);
  });
});

describe("adding, editing and deleting (collector#77)", () => {
  it("stores a proposal the page sends, and the file holds what the route returned", async () => {
    // The repo's own proposals.json (gitignored, and real clients if it exists) is never written: its stamp stays put.
    const repoBefore = stamp(REPO_FILE);
    const r = await post({ ...valid, client: "  Acme Corp  ", currency: "usd", notes: "  the site, not the app  " });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.proposals).toHaveLength(1);
    const [p] = body.proposals;
    expect(p.client).toBe("Acme Corp");
    expect(p.currency).toBe("USD");
    expect(p.notes).toBe("the site, not the app");
    expect(p.id).toBeTruthy();
    // The file on disk is what the route answered, entry for entry.
    expect(stored()).toEqual(body.proposals);
    expect(stamp(REPO_FILE)).toBe(repoBefore);
  });

  it("edits a row, keeping its id and its created time, and the file follows", async () => {
    const before = await one();
    const r = await put({ ...valid, id: before.id, amount: 7_500, status: "approved" });
    expect(r.status).toBe(200);
    const [p] = (await r.json()).proposals;
    expect(p).toMatchObject({ id: before.id, amount: 7_500, status: "approved", created_at: before.created_at });
    expect(stored()).toEqual([{ ...p }]);
  });

  it("answers 404 and changes nothing for an id that is not there", async () => {
    await one();
    const before = fs.readFileSync(FILE, "utf8");
    expect((await put({ ...valid, id: "nope" })).status).toBe(404);
    expect((await del("nope")).status).toBe(404);
    expect(fs.readFileSync(FILE, "utf8")).toBe(before);
  });

  it("deletes a row, and the file follows", async () => {
    const { id } = await one();
    const r = await del(id);
    expect(r.status).toBe(200);
    expect((await r.json()).proposals).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it("lists the newest first: sent proposals by their sent date, the unsent after them", async () => {
    await one({ title: "old", sent_at: "2026-09-01" });
    await one({ title: "unsent", sent_at: null });
    await one({ title: "new", sent_at: "2026-11-05" });
    const body = await (await read()).json();
    expect(body.proposals.map((p: Proposal) => p.title)).toEqual(["new", "old", "unsent"]);
    // The file is in that same order, not in the order they arrived.
    expect(stored().map((p) => p.title)).toEqual(["new", "old", "unsent"]);
  });

  it("answers the open pipeline beside the list, from the same read", async () => {
    await one({ title: "open one", amount: 5_000, status: "pending" });
    await one({ title: "open two", amount: 1_000, status: "draft", currency: "EUR" });
    await one({ title: "lost", amount: 90_000, status: "rejected" });
    const body = await (await read()).json();
    expect(body.pipeline).toEqual([
      { currency: "EUR", total: 1_000 },
      { currency: "USD", total: 5_000 },
    ]);
  });

  it("keeps a row the file is hand-edited out of, instead of crashing on it", async () => {
    await one();
    const good = stored();
    fs.writeFileSync(FILE, JSON.stringify([...good, { id: "x", client: "<script>" }], null, 2));
    const body = await (await read()).json();
    expect(body.proposals).toEqual(good);
  });
});

describe("a proposals.json the route cannot read whole is never written over (PR #79 review)", () => {
  /** Every write the page can send: add, edit and delete, each refused by name and leaving the file as it was. */
  const everyWrite = async (id: string) => {
    for (const r of [await post(valid), await put({ ...valid, id }), await del(id)]) {
      expect(r.status).toBe(409);
      expect((await r.json()).why).toContain(FILE);
    }
  };

  it("refuses every write while the file does not parse, and leaves it byte for byte", async () => {
    const { id } = await one();
    await one({ title: "second" });
    // One stray comma, typed by hand: the file is still the only copy of both rows.
    const broken = fs.readFileSync(FILE, "utf8").replace(/}\s*\]\s*$/, "},\n]\n");
    fs.writeFileSync(FILE, broken);
    await everyWrite(id);
    expect(fs.readFileSync(FILE, "utf8")).toBe(broken);
    // The page is told why, instead of a list that looks empty.
    const body = await (await read()).json();
    expect(body.proposals).toEqual([]);
    expect(body.why).toContain(FILE);
  });

  it("refuses every write while the file holds a row the schema refuses, and leaves it byte for byte", async () => {
    const { id } = await one();
    const odd = JSON.stringify([...stored(), { id: "x", client: "<script>" }], null, 2);
    fs.writeFileSync(FILE, odd);
    await everyWrite(id);
    expect(fs.readFileSync(FILE, "utf8")).toBe(odd);
    const body = await (await read()).json();
    expect(body.proposals).toHaveLength(1);
    expect(body.why).toContain(FILE);
  });

  it("writes through a temp file, so no half-written file or stray temp is left beside it", async () => {
    await one();
    await one({ title: "second" });
    expect(stored()).toHaveLength(2);
    expect(fs.readdirSync(dir).filter((f: string) => f.startsWith("proposals"))).toEqual(["proposals.json"]);
  });
});

describe("the open pipeline (collector#77)", () => {
  const at = (over: Partial<Proposal>): Proposal => ({
    id: "x",
    client: "Acme",
    title: "t",
    amount: 100,
    currency: "USD",
    status: "draft",
    sent_at: null,
    decided_at: null,
    notes: "",
    created_at: 1,
    updated_at: 1,
    ...over,
  });

  it("counts draft, pending and approved, per currency, and leaves rejected and signed out", () => {
    expect(
      pipelineValue([
        at({ status: "draft", amount: 100 }),
        at({ status: "pending", amount: 200 }),
        at({ status: "approved", amount: 300.5 }),
        at({ status: "rejected", amount: 1_000 }),
        at({ status: "signed", amount: 5_000 }),
        at({ status: "pending", amount: 1_000, currency: "EUR" }),
      ]),
    ).toEqual([
      { currency: "EUR", total: 1_000 },
      { currency: "USD", total: 600.5 },
    ]);
  });

  it("answers nothing for no proposals, and nothing when every proposal is decided", () => {
    expect(pipelineValue([])).toEqual([]);
    expect(pipelineValue([at({ status: "signed" }), at({ status: "rejected" })])).toEqual([]);
  });
});
