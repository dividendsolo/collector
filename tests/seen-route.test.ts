import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The Seen click's route (collector#66), the one write the Network check adds. A Seen post carries no body (the
 * Dashboard row posts its URL), so it is a request any web page could send to this machine's Collector without a
 * preflight: a page from another site must not be able to clear a mark and hide a new process or a large upload. The
 * page's own click (same origin) and a shell or an agent (no browser headers at all) still clear it.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-seen-route-"));
const envBefore = { config: process.env.COLLECTOR_CONFIG, seen: process.env.COLLECTOR_SEEN };
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");
process.env.COLLECTOR_SEEN = path.join(dir, "network-seen.json");

let POST: (req: Request) => Promise<Response>;

const mark = (id: string) => ({
  id,
  kind: "process",
  process: "nc",
  pid: "999",
  host: null,
  address: "198.51.100.1",
  port: 443,
  bytes: null,
  at: 1000,
});

function seed() {
  const machine = { at: 1000, processes: {}, bytes: {}, inbound: [], names: {}, marks: [mark("process:nc")] };
  fs.writeFileSync(process.env.COLLECTOR_SEEN as string, JSON.stringify({ machines: { laptop: machine } }));
}

const marksLeft = () =>
  JSON.parse(fs.readFileSync(process.env.COLLECTOR_SEEN as string, "utf8")).machines.laptop.marks.length;

const post = (headers: Record<string, string>) =>
  POST(
    new Request("http://localhost:4000/api/network/seen?machine=laptop&id=process%3Anc", { method: "POST", headers }),
  );

beforeAll(async () => {
  POST = (await import("@/app/api/network/seen/route")).POST;
});

afterAll(() => {
  for (const [key, value] of [
    ["COLLECTOR_CONFIG", envBefore.config],
    ["COLLECTOR_SEEN", envBefore.seen],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the Seen route (collector#66)", () => {
  it("refuses a post from another site, and the mark stays", async () => {
    seed();
    const r = await post({ "sec-fetch-site": "cross-site", origin: "https://evil.example.com" });
    expect(r.status).toBe(403);
    expect(marksLeft()).toBe(1);
    // An old browser with no Sec-Fetch-Site still names its Origin.
    expect((await post({ origin: "https://evil.example.com" })).status).toBe(403);
    expect(marksLeft()).toBe(1);
  });

  it("clears the mark on the page's own click, and on a post with no browser headers (a shell, an agent)", async () => {
    seed();
    const own = await post({ "sec-fetch-site": "same-origin", origin: "http://localhost:4000" });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ cleared: true });
    expect(marksLeft()).toBe(0);
    seed();
    expect((await post({})).status).toBe(200);
    expect(marksLeft()).toBe(0);
  });
});
