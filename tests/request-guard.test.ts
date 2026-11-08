import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromAnotherSite, guard, hostName, isLoopbackHost } from "@/lib/server/guard";

/**
 * The one guard (collector#69). Collector listens on 127.0.0.1, but a page James has open in another tab can post to
 * it: /api/update, /api/hermes and /api/tailscale take no body, so a cross-site form post needs no preflight and no
 * CORS answer, and it applies a staged update and restarts the server, or starts the gateway and the tailnet. With no
 * Host check, a page whose own name resolves to 127.0.0.1 (DNS rebinding) could also read the GET routes.
 *
 * The page's own clicks, and a shell or an agent (no browser headers at all), are answered as before.
 *
 * `ROOT` is a throwaway folder here: POST /api/update on the worktree would read the worktree's own builds, and with
 * one staged the click's script would really swap and restart the machine's Collector.
 */
vi.mock("@/lib/server/paths", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collector-guard-root-"));
  (globalThis as { __guardRoot?: string }).__guardRoot = root;
  const actual = await vi.importActual<typeof import("@/lib/server/paths")>("@/lib/server/paths");
  return { ...actual, ROOT: root };
});

/** The two routes these tests go through: the click that stages a restart, and the cheapest read there is. */
let update: (req: Request) => Response | Promise<Response>;
let version: (req: Request) => Response | Promise<Response>;

beforeAll(async () => {
  update = (await import("@/app/api/update/route")).POST;
  version = (await import("@/app/api/version/route")).GET;
});

afterAll(() => {
  fs.rmSync((globalThis as { __guardRoot?: string }).__guardRoot as string, { recursive: true, force: true });
});

const HOST = "127.0.0.1:4000";

/** The click as the page sends it, and as another site sends it: one POST, one set of browser headers. */
const post = (headers: Record<string, string>) =>
  update(new Request(`http://${HOST}/api/update`, { method: "POST", headers }));

const read = (headers: Record<string, string>) => version(new Request(`http://${HOST}/api/version`, { headers }));

describe("isLoopbackHost", () => {
  it("knows the names this machine's Collector is reached by", () => {
    for (const own of [
      "127.0.0.1",
      "127.0.0.1:4000",
      "127.1.2.3:4000",
      "localhost",
      "localhost:4000",
      "[::1]:4000",
      "::1",
    ])
      expect(isLoopbackHost(own), own).toBe(true);
  });
  it("reads a trailing dot as the same name, the way a resolver does", () => {
    expect(hostName("localhost.:4000")).toBe("localhost");
    expect(isLoopbackHost("localhost.:4000")).toBe(true);
    expect(isLoopbackHost("127.0.0.1.:4000")).toBe(true);
    expect(isLoopbackHost("evil.example.com.")).toBe(false);
  });
  it("refuses any other name, and one that only looks like a loopback address", () => {
    for (const other of [
      "evil.example.com",
      "evil.example.com:4000",
      "192.0.2.5:4000",
      "127.0.0.1.evil.example.com",
      "127.0.0.1x",
      "127.0.0.256",
      "",
    ])
      expect(isLoopbackHost(other), other).toBe(false);
  });
});

describe("a write from another site (collector#69)", () => {
  it("refuses a post that says it comes from another site, and the click never runs", async () => {
    const r = await post({ host: HOST, origin: "https://evil.example.com", "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
    expect((await r.json()).why).toBe("a write comes from this page only");
    // An old browser with no Sec-Fetch-Site still names its Origin, and a local page on another port is another site.
    expect((await post({ host: HOST, origin: "https://evil.example.com" })).status).toBe(403);
    expect((await post({ host: HOST, origin: "http://127.0.0.1:3000" })).status).toBe(403);
  });

  it("answers the page's own click, and a shell or an agent that sends no browser headers", async () => {
    // Nothing is staged in this folder, so the click's own answer — not a 403 — is the proof it reached the route.
    const own = await post({ host: HOST, origin: `http://${HOST}`, "sec-fetch-site": "same-origin" });
    expect(own.status).toBe(409);
    expect((await own.json()).why).toBe("no build is staged");
    expect((await post({ host: HOST })).status).toBe(409);
  });

  it("refuses a write to a name that is not this machine's, even from this page's own site", async () => {
    const r = await post({
      host: "evil.example.com",
      origin: "http://evil.example.com",
      "sec-fetch-site": "same-origin",
    });
    expect(r.status).toBe(403);
  });
});

describe("a read through a name that is not this machine's (DNS rebinding)", () => {
  it("refuses a Host of another name on a GET route, and answers this machine's own", async () => {
    expect((await read({ host: "evil.example.com" })).status).toBe(403);
    expect((await read({ host: "attacker.example.com:4000" })).status).toBe(403);
    for (const own of [HOST, "localhost:4000", "[::1]:4000"]) expect((await read({ host: own })).status, own).toBe(200);
    expect(await (await read({ host: HOST })).text()).toBe("dev");
  });
});

describe("fromAnotherSite", () => {
  const at = (headers: Record<string, string>) => new Request(`http://${HOST}/api/update`, { method: "POST", headers });

  it("reads the browser's own statement first, then the Origin", () => {
    expect(fromAnotherSite(at({ "sec-fetch-site": "cross-site" }), new URL(`http://${HOST}/api/update`))).toBe(true);
    expect(fromAnotherSite(at({ "sec-fetch-site": "same-origin" }), new URL(`http://${HOST}/api/update`))).toBe(false);
    expect(fromAnotherSite(at({ origin: "https://evil.example.com" }), new URL(`http://${HOST}/api/update`))).toBe(
      true,
    );
    expect(fromAnotherSite(at({ origin: `http://${HOST}` }), new URL(`http://${HOST}/api/update`))).toBe(false);
    expect(fromAnotherSite(at({ origin: "not-a-url" }), new URL(`http://${HOST}/api/update`))).toBe(true);
    expect(fromAnotherSite(at({}), new URL(`http://${HOST}/api/update`))).toBe(false); // no browser headers: a shell
  });
});

describe("guard", () => {
  it("lets a guarded request through as null, and answers the refusal itself", () => {
    expect(guard(new Request(`http://${HOST}/api/state`, { headers: { host: HOST } }))).toBeNull();
    expect(guard(new Request(`http://${HOST}/api/state`, { headers: { host: "evil.example.com" } }))?.status).toBe(403);
    // A GET is not a write: its Origin, when a browser sends one, changes nothing.
    expect(
      guard(new Request(`http://${HOST}/api/state`, { headers: { host: HOST, origin: "https://evil.example.com" } })),
    ).toBeNull();
    const write = guard(
      new Request(`http://${HOST}/api/update`, {
        method: "POST",
        headers: { host: HOST, "sec-fetch-site": "cross-site" },
      }),
    );
    expect(write?.status).toBe(403);
  });
});

/** Every route file in the repo, A to Z, so a new one cannot quietly sit outside the guard. */
const routeFiles = () => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") out.push(p);
    }
  };
  walk(path.join(process.cwd(), "app", "api"));
  return out.sort();
};

const handlersIn = (src: string) =>
  src.match(/^export (?:async )?(?:function|const) (?:GET|POST|PUT|PATCH|DELETE)\b/gm) || [];

describe("every route in the repo", () => {
  it("calls the one guard first, in every handler it exports", () => {
    const files = routeFiles();
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      const name = path.relative(process.cwd(), file);
      const handlers = handlersIn(src);
      expect(handlers.length, `${name} exports no handler`).toBeGreaterThan(0);
      expect(src, `${name} does not import the guard`).toContain('from "@/lib/server/guard"');
      expect(src.match(/guard\(req\)/g)?.length || 0, `${name} has an unguarded handler`).toBeGreaterThanOrEqual(
        handlers.length,
      );
    }
  });

  it("is the whole list of state-changing routes: a new one has to be guarded on purpose", () => {
    const writes = routeFiles()
      .filter((f) => handlersIn(fs.readFileSync(f, "utf8")).some((h) => !h.endsWith("GET")))
      .map((f) => path.relative(process.cwd(), f));
    expect(writes).toEqual([
      "app/api/hermes/route.ts",
      "app/api/projects/route.ts",
      "app/api/tailscale/route.ts",
      "app/api/update/route.ts",
    ]);
  });
});
