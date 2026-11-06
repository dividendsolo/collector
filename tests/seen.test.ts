import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NetworkConnection, NetworkMark } from "@/lib/server/network";

/**
 * The seen-list and its marks (collector#66): what each machine has been seen doing on the network, and what is new
 * about it. The file the state lives in is resolved from COLLECTOR_CONFIG's folder when `lib/server/paths.ts` loads,
 * so a temp config is pointed at before the import — the same reason `tests/projects-save.test.ts` does it that way,
 * and the reason the real `network-seen.json` beside `config.json` is never touched. Reverse DNS is never asked
 * here: every case hands the fold the names it should use.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-seen-"));
const envBefore = process.env.COLLECTOR_CONFIG;
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");

let seen: typeof import("@/lib/server/seen");
let warnings: typeof import("@/lib/server/warnings").warnings;

beforeAll(async () => {
  seen = await import("@/lib/server/seen");
  warnings = (await import("@/lib/server/warnings")).warnings;
});

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One established connection, as `collect.py` read it plus the name the server resolved for it. */
const conn = (over: Partial<NetworkConnection> = {}): NetworkConnection => ({
  proto: "tcp",
  address: "198.51.100.1",
  port: 443,
  local_address: "192.0.2.5",
  local_port: 51234,
  process: "curl",
  pid: "1234",
  bytes_sent: 0,
  bytes_received: 0,
  inbound: false,
  host: null,
  ...over,
});

/** The marks' ids, which is what a Seen click names. */
const ids = (marks: NetworkMark[]) => marks.map((m) => m.id).sort();

describe("the seen-list's first read (collector#66)", () => {
  it("fills the list and marks nothing: a fresh install is not twenty new processes", () => {
    const first = seen.foldRead(
      undefined,
      [conn({ host: "downloads.example.com" }), conn({ process: "ssh", port: 22 })],
      { now: 1000 },
    );
    expect(first.marks).toEqual([]);
    expect(first.at).toBe(1000);
    // What the process was seen going to: the name reverse DNS gave, and the address it resolved from.
    expect(first.processes).toEqual({ curl: ["downloads.example.com", "198.51.100.1"], ssh: ["198.51.100.1"] });
    expect(first.bytes).toEqual({ curl: 0, ssh: 0 });
  });

  it("says nothing new on the next read of the same connections, and counts what they sent", () => {
    const first = seen.foldRead(undefined, [conn()], { now: 1000 });
    const next = seen.foldRead(first, [conn({ bytes_sent: 5000 })], { now: 1010 });
    expect(next.marks).toEqual([]);
    expect(next.bytes).toEqual({ curl: 5000 });
    expect(next.at).toBe(1010);
  });

  it("keeps no process of a connection whose owner this user may not read", () => {
    const out = seen.foldRead(undefined, [conn({ process: null, pid: null })], { now: 1000 });
    expect(out.processes).toEqual({});
    expect(out.bytes).toEqual({});
    expect(out.marks).toEqual([]);
  });
});

describe("what gets marked (collector#66)", () => {
  const first = () => seen.foldRead(undefined, [conn({ host: "downloads.example.com" })], { now: 1000 });
  const fold = (rows: NetworkConnection[], opts: { now?: number; uploadWarnMB?: number } = {}) =>
    seen.foldRead(first(), rows, { now: opts.now ?? 1010, uploadWarnMB: opts.uploadWarnMB });

  it("marks a process never seen on this machine before, and records where it went", () => {
    const out = fold([conn({ process: "nc", pid: "999", host: "drop.example.net" })]);
    expect(ids(out.marks)).toEqual(["process:nc"]);
    expect(out.marks[0]).toMatchObject({ kind: "process", process: "nc", pid: "999", host: "drop.example.net" });
    expect(out.processes.nc).toEqual(["drop.example.net", "198.51.100.1"]);
  });

  it("marks a new destination for a process it already knows", () => {
    expect(fold([conn({ host: "downloads.example.com" })]).marks).toEqual([]);
    expect(ids(fold([conn({ host: "news.example.com", address: "203.0.113.9" })]).marks)).toEqual([
      "destination:curl:news.example.com",
    ]);
    // An address with no name is a destination too.
    expect(ids(fold([conn({ host: null, address: "203.0.113.9" })]).marks)).toEqual(["destination:curl:203.0.113.9"]);
  });

  it("marks an upload over the threshold since the last read, and the bytes it sent", () => {
    const vars = { ...first(), bytes: { curl: 1_000_000 } };
    const over = seen.foldRead(vars, [conn({ bytes_sent: 61_000_000 })], { now: 1010 });
    expect(ids(over.marks)).toEqual(["upload:curl"]);
    expect(over.marks[0]).toMatchObject({ kind: "upload", process: "curl", bytes: 60_000_000 });

    expect(seen.foldRead(vars, [conn({ bytes_sent: 10_000_000 })], { now: 1010 }).marks).toEqual([]); // under 50 MB
    // A socket that closed takes its counter with it: a smaller total is not an upload.
    expect(
      seen.foldRead({ ...vars, bytes: { curl: 100_000_000 } }, [conn({ bytes_sent: 5_000_000 })], { now: 1010 }).marks,
    ).toEqual([]);
    // A process the read has known but counted nothing for (no counters on its socket) is measured from nothing.
    expect(ids(seen.foldRead({ ...vars, bytes: {} }, [conn({ bytes_sent: 60_000_000 })], { now: 1010 }).marks)).toEqual(
      ["upload:curl"],
    );
  });

  it("takes the threshold from config.json's network.uploadWarnMB", () => {
    const vars = { ...first(), bytes: { curl: 0 } };
    expect(ids(seen.foldRead(vars, [conn({ bytes_sent: 2_000_000 })], { now: 1010, uploadWarnMB: 1 }).marks)).toEqual([
      "upload:curl",
    ]);
    expect(seen.foldRead(vars, [conn({ bytes_sent: 2_000_000 })], { now: 1010, uploadWarnMB: 10 }).marks).toEqual([]);
  });

  it("marks a connection to a listening port from another device on the local network", () => {
    const inbound = conn({
      inbound: true,
      local_port: 7000,
      address: "192.168.1.21",
      port: 51234,
      process: "AirPlay",
      pid: "900",
    });
    const out = fold([inbound]);
    expect(ids(out.marks)).toEqual(["inbound:7000/192.168.1.21"]);
    expect(out.marks[0]).toMatchObject({ kind: "inbound", process: "AirPlay", address: "192.168.1.21", port: 7000 });
    // A connection this machine opened to the same device is nobody knocking.
    expect(ids(fold([conn({ address: "192.168.1.21", port: 51234 })]).marks)).not.toContain(
      "inbound:7000/192.168.1.21",
    );
  });

  it("says each new thing once: a second read of the same connection adds no second mark", () => {
    const once = fold([conn({ process: "nc" })]);
    const twice = seen.foldRead(once, [conn({ process: "nc" })], { now: 1020 });
    expect(ids(twice.marks)).toEqual(["process:nc"]);
    expect(twice.at).toBe(1020);
  });

  it("keeps a mark until it is seen, even after the machine stops sending it", () => {
    const marked = fold([conn({ process: "nc" })]);
    expect(ids(seen.foldRead(marked, [], { now: 1030 }).marks)).toEqual(["process:nc"]);
  });
});

describe("Seen (collector#66)", () => {
  it("writes the state beside the config, not into the repo, and hands the names back with the connections", async () => {
    expect(seen.seenPath()).toBe(path.join(dir, "network-seen.json"));
    const out = await seen.observeAll(
      [{ name: "ezio", network: { connections: [conn()], upload_warn_mb: 50 } }],
      1000,
      async () => "downloads.example.com",
    );
    // The page draws the host name it was told (the read's own row keeps the address), and the seen-list knows the
    // process went to both.
    expect(out[0].network.connections[0]).toMatchObject({ address: "198.51.100.1", host: "downloads.example.com" });
    const written = JSON.parse(fs.readFileSync(seen.seenPath(), "utf8"));
    expect(Object.keys(written.machines)).toEqual(["ezio"]);
    expect(written.machines.ezio.processes).toEqual({ curl: ["downloads.example.com", "198.51.100.1"] });
    expect(written.machines.ezio.names).toEqual({ "198.51.100.1": "downloads.example.com" });
  });

  it("drops the mark and does not bring it back: the fact behind it stays in the seen-list", async () => {
    const read = (connections: NetworkConnection[], now: number) =>
      seen.observeAll([{ name: "altair", network: { connections, upload_warn_mb: 50 } }], now, async () => "");
    // The first read fills the list for this machine; the second marks a process that is new to it.
    await read([conn()], 2000);
    const marked = await read([conn(), conn({ process: "nc", pid: "999" })], 2010);
    expect(marked[0].network.marks.map((m: NetworkMark) => m.id)).toEqual(["process:nc"]);

    expect(await seen.clearMark("altair", "process:nc")).toEqual({ cleared: true, marks: [] });
    expect(seen.readSeen().machines.altair.marks).toEqual([]);
    // The next read has the process in its list, so the mark is gone for good; and a click on a mark that is not
    // there says so rather than failing.
    const after = await read([conn(), conn({ process: "nc", pid: "999" })], 2020);
    expect(after[0].network.marks).toEqual([]);
    expect((await seen.clearMark("altair", "process:nc")).cleared).toBe(false);
  });

  it("clears one mark of one machine and leaves the rest", async () => {
    const marks: NetworkMark[] = [
      {
        id: "process:nc",
        kind: "process",
        process: "nc",
        pid: null,
        host: null,
        address: null,
        port: null,
        bytes: null,
        at: 1,
      },
      {
        id: "upload:curl",
        kind: "upload",
        process: "curl",
        pid: null,
        host: null,
        address: null,
        port: null,
        bytes: 6,
        at: 2,
      },
    ];
    fs.writeFileSync(
      seen.seenPath(),
      JSON.stringify({ machines: { ezio: { at: 1, processes: {}, bytes: {}, inbound: [], names: {}, marks } } }),
    );
    expect(await seen.clearMark("ezio", "upload:curl")).toEqual({ cleared: true, marks: [marks[0]] });
    expect(seen.readSeen().machines.ezio.marks).toHaveLength(1);
  });

  it("keeps a Seen click that lands while a read is folding: the read cannot write the mark back", async () => {
    const read = (now: number, address: string, lookup: (ip: string) => Promise<string>, withNc = true) =>
      seen.observeAll(
        [
          {
            name: "cobalt",
            network: {
              connections: withNc
                ? [conn({ address }), conn({ address, process: "nc", pid: "999" })]
                : [conn({ address })],
              upload_warn_mb: 50,
            },
          },
        ],
        now,
        lookup,
      );
    // The first read fills the list; the second marks the process this machine has not seen before.
    await read(3000, "198.51.100.1", async () => "", false);
    await read(3010, "198.51.100.1", async () => "");
    expect(seen.readSeen().machines.cobalt.marks.map((m) => m.id)).toEqual(["process:nc"]);

    // A read held open inside its reverse DNS — the window a Seen click lands in. The click's own write must not be
    // undone by this read writing back the state it read before the click.
    let release = () => {};
    const held = new Promise<string>((r) => {
      release = () => r("");
    });
    const folding = read(3020, "203.0.113.88", () => held);
    await new Promise((r) => setTimeout(r, 0)); // let that read pick up the seen-list and reach the held lookup
    const clicked = seen.clearMark("cobalt", "process:nc");
    release();
    await Promise.all([folding, clicked]);

    expect(await clicked).toMatchObject({ cleared: true });
    expect(seen.readSeen().machines.cobalt.marks.map((m) => m.id)).not.toContain("process:nc");
  });
});

describe("reverse DNS (collector#66)", () => {
  it("asks each address once ever, and keeps the empty answer so it is not asked again", async () => {
    const asked: string[] = [];
    const lookup = async (ip: string) => {
      asked.push(ip);
      return ip === "198.51.100.1" ? "downloads.example.com." : "";
    };
    const first = await seen.resolveNames(["198.51.100.1", "203.0.113.9"], {}, lookup);
    expect(first).toEqual({ "198.51.100.1": "downloads.example.com", "203.0.113.9": "" });
    const again = await seen.resolveNames(["198.51.100.1", "203.0.113.9"], first, lookup);
    expect(again).toEqual(first);
    expect(asked).toEqual(["198.51.100.1", "203.0.113.9"]);
    // This machine's own loopback is never asked about.
    expect(await seen.resolveNames(["127.0.0.1", "::1"], {}, lookup)).toEqual({});
    expect(asked).toEqual(["198.51.100.1", "203.0.113.9"]);
  });

  it("gives up on an answer that takes too long rather than holding a read up", async () => {
    const never = () => new Promise<string>(() => {});
    expect(await seen.resolveNames(["203.0.113.9"], {}, never)).toEqual({ "203.0.113.9": "" });
  });
});

describe("the marks in Needs attention (collector#66)", () => {
  const base = { github: {}, cfg: {} as any, services: [], domains: [], ticketsError: null, x: null, ai: [] };
  const mark = (over: Partial<NetworkMark>): NetworkMark => ({
    id: "process:curl",
    kind: "process",
    process: "curl",
    pid: "1234",
    host: "downloads.example.com",
    address: "198.51.100.1",
    port: 443,
    bytes: null,
    at: 1000,
    ...over,
  });
  const rows = (marks: NetworkMark[]) => warnings({ ...base, machines: [{ name: "ezio", network: { marks } }] });

  it("says what each mark is, names the machine, and carries the Seen click for that one mark", () => {
    const w = rows([
      mark({}),
      mark({
        id: "destination:nc:203.0.113.9",
        kind: "destination",
        process: "nc",
        host: null,
        address: "203.0.113.9",
        port: null,
      }),
      mark({ id: "upload:curl", kind: "upload", bytes: 600_000_000 }),
      mark({
        id: "inbound:7000/192.168.1.21",
        kind: "inbound",
        process: "AirPlay",
        address: "192.168.1.21",
        port: 7000,
      }),
    ]);
    expect(w.map((x) => x.level)).toEqual(["warn", "warn", "warn", "warn"]);
    expect(w[0].text).toBe(
      "curl on ezio: a process not seen here before, connected to downloads.example.com (198.51.100.1):443",
    );
    expect(w[1].text).toBe("nc on ezio: connected somewhere new, 203.0.113.9");
    expect(w[2].text).toBe("curl on ezio: sent 600 MB since the last read");
    expect(w[3].text).toBe("Something on the local network reached ezio on port 7000 from 192.168.1.21 (AirPlay)");
    // One click clears one mark: the id rides in the query, where the row's own POST can carry it with no body.
    expect(w[0].action).toEqual({ label: "Seen", post: "/api/network/seen?machine=ezio&id=process%3Acurl" });
    expect(w[3].action?.post).toBe("/api/network/seen?machine=ezio&id=inbound%3A7000%2F192.168.1.21");
  });

  it("says nothing for a machine with no marks, and nothing that is not a mark", () => {
    expect(rows([])).toEqual([]);
    expect(warnings({ ...base, machines: [{ name: "ezio" }] })).toEqual([]);
  });
});
