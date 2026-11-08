import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getJson, HttpError, TimeoutError, why } from "@/lib/server/http";
import { backoffDelay, MAX_ATTEMPTS, withRetry } from "@/lib/server/retry";
import { run, runText } from "@/lib/server/run";

/**
 * Repo standard S2: every outbound call has a timeout and sane retries. These are the tests behind that claim — a
 * stub server that never answers and shows the call gives up, the retries that are worth making, the answer that is
 * not, the cap and the jitter, and a hung command under the subprocess runner.
 */

const servers: http.Server[] = [];

/** A stub server on 127.0.0.1 that answers every request the way `respond` says; a request with no answer holds. */
async function stub(respond: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer(respond);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

/** A server that never answers: the hung call this card has to survive. */
const silent = () => stub(() => {});

const counting = (status: number, body = "{}") => {
  const seen = { count: 0 };
  return {
    seen,
    url: () =>
      stub((_req, res) => {
        seen.count++;
        res.writeHead(status, { "content-type": "application/json" }).end(body);
      }),
  };
};

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("a call that never answers is given up on (repo standard S2)", () => {
  it("times out when the server never responds", async () => {
    const url = await silent();
    const t = Date.now();
    await expect(getJson(`${url}/hang`, {}, 0.3, { attempts: 1 })).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it("names the limit it gave up at, so a log reads plainly", async () => {
    const url = await silent();
    const err = await getJson(`${url}/hang`, {}, 0.2, { attempts: 1 }).catch((e) => e);
    expect(why(err)).toBe("timed out");
    expect((err as Error).message).toBe("timed out after 0.2 s");
  });

  it("kills a command that never exits after its timeout", async () => {
    const r = await runText([process.execPath, "-e", "setTimeout(() => {}, 60000)"], { timeout: 0.3 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timed out after 0.3 s");
  });
});

describe("retries: what is worth asking twice", () => {
  it("retries a 5xx and answers once the server recovers", async () => {
    let n = 0;
    const url = await stub((_req, res) => {
      n++;
      if (n < 3) res.writeHead(503).end("later");
      else res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    });
    const out = await getJson<{ ok: boolean }>(url, {}, 1, { sleep: async () => {} });
    expect(out).toEqual({ ok: true });
    expect(n).toBe(3);
  });

  it("does not retry a 4xx: the answer would be the same", async () => {
    const { seen, url } = counting(404);
    const err = await getJson(await url(), {}, 1, { sleep: async () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe(404);
    expect(seen.count).toBe(1);
  });

  it("gives up after three tries by default, and never more than MAX_ATTEMPTS however many are asked for", async () => {
    const a = counting(500);
    await expect(getJson(await a.url(), {}, 1, { sleep: async () => {} })).rejects.toBeInstanceOf(HttpError);
    expect(a.seen.count).toBe(3);
    const b = counting(500);
    await expect(getJson(await b.url(), {}, 1, { sleep: async () => {}, attempts: 50 })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(b.seen.count).toBe(MAX_ATTEMPTS);
  });

  it("retries a read command once by default, and not a fifth time when asked", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collector-run-")), "tries");
    const cmd = [
      process.execPath,
      "-e",
      `require("fs").appendFileSync(${JSON.stringify(file)}, "x\\n"); process.exit(1)`,
    ];
    const [data, err] = await run(cmd);
    expect(data).toBeNull();
    expect(typeof err).toBe("string");
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
    await run(cmd, { attempts: 50 });
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2 + MAX_ATTEMPTS);
  });

  it("leaves a call that would start something at one try", async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "collector-run-")), "tries");
    const cmd = [
      process.execPath,
      "-e",
      `require("fs").appendFileSync(${JSON.stringify(file)}, "x\\n"); process.exit(1)`,
    ];
    await runText(cmd);
    expect(fs.readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("the health check measures, so it is not retried (repo standard S2)", () => {
  it("reads one answer and reports it", async () => {
    const { seen, url } = counting(500, "no");
    const { check } = await import("@/lib/server/services");
    const result = await check({ name: "stub", url: await url() });
    expect(result.status).toBe("down");
    expect(result.error).toBe("HTTP 500");
    expect(seen.count).toBe(1);
  });
});

describe("backoff: exponential, capped, jittered", () => {
  it("doubles the wait per try", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 10_000, random: () => 1 };
    expect([2, 3, 4, 5].map((a) => backoffDelay(a, opts))).toEqual([100, 200, 400, 800]);
  });

  it("never waits longer than its ceiling", () => {
    const opts = { baseDelayMs: 500, maxDelayMs: 2000, random: () => 1 };
    expect(backoffDelay(20, opts)).toBe(2000);
  });

  it("jitters within half of the exponential value, so callers do not come back together", () => {
    const base = { baseDelayMs: 400, maxDelayMs: 10_000 };
    expect(backoffDelay(3, { ...base, random: () => 0 })).toBe(400);
    expect(backoffDelay(3, { ...base, random: () => 1 })).toBe(800);
    const many = new Set(Array.from({ length: 20 }, () => backoffDelay(3, base)));
    expect(many.size).toBeGreaterThan(1);
  });

  it("stops after its tries, and runs at most MAX_ATTEMPTS of them", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("no");
        },
        { attempts: 999, sleep: async () => {} },
      ),
    ).rejects.toThrow("no");
    expect(n).toBe(MAX_ATTEMPTS);
  });

  // `attempt > NaN` is false forever, so a caller asking for a count that is not a number must not turn the cap off.
  // The sleep yields to the event loop, so a version of this that does not stop fails on the timeout below instead
  // of spinning the whole run.
  it("falls back to its default when a caller asks for a count that is not a finite number", async () => {
    let n = 0;
    const fail = async () => {
      n++;
      throw new Error("no");
    };
    const yieldToLoop = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    await expect(withRetry(fail, { attempts: Number.NaN, sleep: yieldToLoop })).rejects.toThrow("no");
    expect(n).toBe(3);
    await expect(withRetry(fail, { attempts: Number.POSITIVE_INFINITY, sleep: yieldToLoop })).rejects.toThrow("no");
    expect(n).toBe(3 + MAX_ATTEMPTS);
  }, 5000);
});
