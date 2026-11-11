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

/**
 * The two one-click routes' own work, mocked (collector#71): `POST /api/tailscale` starts the tailnet on this machine
 * and restarts the ssh jobs that failed on it, and `POST /api/hermes` kickstarts the gateway the waiting crew runs
 * on. A test here proves the refusal, never the start; the machines read behind them is mocked too, so no test
 * reaches ssh.
 */
const clicks = vi.hoisted(() => ({
  startTailscale: vi.fn(async () => ({ ok: true, state: "Running" })),
  restartSshJobs: vi.fn(async () => [] as string[]),
  startGateway: vi.fn(async () => ({ ok: true, state: "running", pid: "1064" })),
}));

vi.mock("@/lib/server/tailscale", () => ({
  startTailscale: clicks.startTailscale,
  restartSshJobs: clicks.restartSshJobs,
}));
vi.mock("@/lib/server/hermes", () => ({ startGateway: clicks.startGateway }));
vi.mock("@/lib/server/machines", () => ({
  snapshot: { peek: () => ({ machines: [] }), get: async () => ({ machines: [] }) },
}));

/** The routes these tests go through: the two one-click buttons, the click that stages a restart, and the cheapest
 * read there is. */
let tailscale: (req: Request) => Response | Promise<Response>;
let hermes: (req: Request) => Response | Promise<Response>;
let update: (req: Request) => Response | Promise<Response>;
let version: (req: Request) => Response | Promise<Response>;

beforeAll(async () => {
  tailscale = (await import("@/app/api/tailscale/route")).POST;
  hermes = (await import("@/app/api/hermes/route")).POST;
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

/**
 * The card's own repro, one route at a time (collector#71): `/api/tailscale` and `/api/hermes` take no body, so a
 * cross-site form post needs no preflight and any page open in this browser can start the tailnet (and the ssh jobs
 * that failed on it) or kickstart the Hermes gateway on this machine. The guard from collector#69 is the check the
 * card asks for; these hold it to both routes' own handlers, so neither can lose it quietly.
 */
describe("Start Tailscale and Start Hermes answer this page only (collector#71)", () => {
  const CROSS = { origin: "https://evil.example.com", "sec-fetch-site": "cross-site" };
  const OWN = { origin: `http://${HOST}`, "sec-fetch-site": "same-origin" };

  /** One one-click post, exactly as the hidden form and as the page's own click send it. */
  const post = async (
    route: (req: Request) => Response | Promise<Response>,
    path: string,
    headers: Record<string, string>,
  ) => route(new Request(`http://${HOST}${path}`, { method: "POST", headers }));

  it("Start Tailscale refuses a post from another site and never starts the tailnet", async () => {
    clicks.startTailscale.mockClear();
    clicks.restartSshJobs.mockClear();

    const r = await post(tailscale, "/api/tailscale", { host: HOST, ...CROSS });
    expect(r.status).toBe(403);
    expect((await r.json()).why).toBe("a write comes from this page only");
    // An older browser sends no Sec-Fetch-Site at all: the Origin is the whole statement, on its own port or another.
    expect((await post(tailscale, "/api/tailscale", { host: HOST, origin: "https://evil.example.com" })).status).toBe(
      403,
    );
    expect((await post(tailscale, "/api/tailscale", { host: HOST, origin: "http://127.0.0.1:3000" })).status).toBe(403);

    expect(clicks.startTailscale).not.toHaveBeenCalled();
    expect(clicks.restartSshJobs).not.toHaveBeenCalled();
  });

  it("Start Tailscale still starts the tailnet on the page's own click, and for a shell with no browser headers", async () => {
    clicks.startTailscale.mockClear();
    clicks.restartSshJobs.mockClear();

    const own = await post(tailscale, "/api/tailscale", { host: HOST, ...OWN });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ ok: true, state: "Running" });
    expect(clicks.startTailscale).toHaveBeenCalledTimes(1);
    expect(clicks.restartSshJobs).toHaveBeenCalledTimes(1); // the click's own follow-on work still runs

    // No Origin and no Sec-Fetch-Site is not a browser: a shell or an agent is answered as it always was.
    expect((await post(tailscale, "/api/tailscale", { host: HOST })).status).toBe(200);
    expect(clicks.startTailscale).toHaveBeenCalledTimes(2);
  });

  it("Start Hermes refuses a post from another site and never kickstarts the gateway", async () => {
    clicks.startGateway.mockClear();

    const r = await post(hermes, "/api/hermes", { host: HOST, ...CROSS });
    expect(r.status).toBe(403);
    expect((await r.json()).why).toBe("a write comes from this page only");
    expect((await post(hermes, "/api/hermes", { host: HOST, origin: "https://evil.example.com" })).status).toBe(403);

    expect(clicks.startGateway).not.toHaveBeenCalled();
  });

  it("Start Hermes still kickstarts the gateway on the page's own click, and for a shell with no browser headers", async () => {
    clicks.startGateway.mockClear();

    const own = await post(hermes, "/api/hermes", { host: HOST, ...OWN });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ ok: true, state: "running", pid: "1064" });
    expect(clicks.startGateway).toHaveBeenCalledTimes(1);

    expect((await post(hermes, "/api/hermes", { host: HOST })).status).toBe(200);
    expect(clicks.startGateway).toHaveBeenCalledTimes(2);
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
      "app/api/briefs/route.ts",
      "app/api/debug-fix/route.ts",
      "app/api/hermes/route.ts",
      "app/api/projects/route.ts",
      "app/api/proposals/route.ts",
      "app/api/tailscale/route.ts",
      "app/api/update/route.ts",
    ]);
  });
});
