import { describe, expect, it, vi } from "vitest";
import * as aiProvidersRoute from "@/app/api/ai-providers/route";
import * as briefsRoute from "@/app/api/briefs/route";
import * as debugFixRoute from "@/app/api/debug-fix/route";
import * as hermesRoute from "@/app/api/hermes/route";
import * as modelLoginRoute from "@/app/api/model-login/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as proposalsRoute from "@/app/api/proposals/route";
import * as releaseRoute from "@/app/api/release/route";
import * as tailscaleRoute from "@/app/api/tailscale/route";
import * as ticketRoute from "@/app/api/ticket/route";
import {
  caller,
  guard,
  isTailnetHost,
  refusePhone,
  SERVE_LOGIN_HEADER,
  sideOf,
  sideOfHeaders,
} from "@/lib/server/guard";

const stubs = vi.hoisted(() => ({
  runText: vi.fn(async (_cmd: string[], _o?: unknown) => ({ ok: true, stdout: "", error: null as string | null })),
  poll: vi.fn(async (_why?: string) => {}),
  startTailscale: vi.fn(async () => ({ ok: true, state: "Running" })),
  restartSshJobs: vi.fn(async () => [] as string[]),
  startGateway: vi.fn(async () => ({ ok: true, state: "running", pid: "1064" })),
  startLogin: vi.fn(async () => ({ ok: true, signedIn: true })),
  setBriefState: vi.fn((_key: string, _change: unknown) => ({ read: [], archived: [] })),
  addFallback: vi.fn(async () => []),
  removeFallbacks: vi.fn(async () => []),
}));

vi.mock("@/lib/server/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/run")>("@/lib/server/run");
  return { ...actual, runText: stubs.runText, run: stubs.runText };
});
vi.mock("@/lib/server/board", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/board")>("@/lib/server/board");
  return { ...actual, poll: stubs.poll };
});
vi.mock("@/lib/server/machines", () => ({
  snapshot: { peek: () => ({ machines: [] }), get: async () => ({ machines: [] }) },
}));
vi.mock("@/lib/server/tailscale", () => ({
  startTailscale: stubs.startTailscale,
  restartSshJobs: stubs.restartSshJobs,
}));
vi.mock("@/lib/server/hermes", () => ({ startGateway: stubs.startGateway }));
vi.mock("@/lib/server/model-login", () => ({ loginCommand: () => null, startLogin: stubs.startLogin }));
vi.mock("@/lib/server/briefs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/briefs")>("@/lib/server/briefs");
  return {
    ...actual,
    setBriefState: stubs.setBriefState,
    briefsView: async () => ({ at: 0, inbox: [], archived: [] }),
  };
});
vi.mock("@/lib/server/fallbacks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/fallbacks")>("@/lib/server/fallbacks");
  return { ...actual, addFallback: stubs.addFallback, removeFallbacks: stubs.removeFallbacks };
});

const MAC = "127.0.0.1:4000";
const TAILNET = "altair.tailnet.ts.net";

type Handler = (req: Request) => Response | Promise<Response>;
type Route = Record<string, Handler>;

const routes: Record<string, Route> = {
  hermes: hermesRoute as unknown as Route,
  tailscale: tailscaleRoute as unknown as Route,
  "debug-fix": debugFixRoute as unknown as Route,
  release: releaseRoute as unknown as Route,
  "model-login": modelLoginRoute as unknown as Route,
  projects: projectsRoute as unknown as Route,
  proposals: proposalsRoute as unknown as Route,
  ticket: ticketRoute as unknown as Route,
  "ai-providers": aiProvidersRoute as unknown as Route,
  briefs: briefsRoute as unknown as Route,
};

const req = (host: string, path: string, method = "POST", extra: Record<string, string> = {}, body?: unknown) =>
  new Request(`http://${host}${path}`, {
    method,
    headers: { host, "sec-fetch-site": "same-origin", "content-type": "application/json", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const onPhone = (path: string, method = "POST", body?: unknown) =>
  req(TAILNET, path, method, { [SERVE_LOGIN_HEADER]: "someone@example.com" }, body);

const onMac = (path: string, method = "POST", body?: unknown) => req(MAC, path, method, {}, body);

describe("the side a request came from", () => {
  it("reads loopback as the Mac and Tailscale Serve's own request as the phone", () => {
    expect(sideOf(onMac("/api/state"))).toBe("mac");
    expect(sideOf(onPhone("/api/state"))).toBe("phone");
    expect(caller(onMac("/api/state"))).toBe("mac");
    expect(caller(onPhone("/api/state"))).toBe("phone");
  });

  it("refuses a name that is not this machine's, with no Tailscale Serve behind it (DNS rebinding)", () => {
    expect(caller(req("evil.example.com", "/api/state", "GET"))).toBe("refused");
    expect(guard(req("evil.example.com", "/api/state", "GET"))?.status).toBe(403);
    expect(sideOf(req(TAILNET, "/api/state", "GET"))).toBe("mac");
  });

  it("refuses a foreign name even with Serve's header on it: a page that rebinds its own DNS can set a header", () => {
    const rebinding = req("evil.example.com", "/api/state", "GET", { [SERVE_LOGIN_HEADER]: "someone@example.com" });
    expect(caller(rebinding)).toBe("refused");
    expect(guard(rebinding)?.status).toBe(403);
    expect(isTailnetHost("altair.tailnet.ts.net")).toBe(true);
    expect(isTailnetHost("altair.tailnet.ts.net:4001")).toBe(true);
    expect(isTailnetHost("altair.example.com")).toBe(false);
    expect(isTailnetHost("ts.net.evil.example.com")).toBe(false);
  });

  it("reads the same side off the page's own headers", () => {
    const h = (host: string, serve: string) => new Headers({ host, ...(serve ? { [SERVE_LOGIN_HEADER]: serve } : {}) });
    expect(sideOfHeaders(h(MAC, ""))).toBe("mac");
    expect(sideOfHeaders(h(TAILNET, ""))).toBe("mac");
    expect(sideOfHeaders(h(TAILNET, "someone@example.com"))).toBe("phone");
  });

  it("lets the phone through the read guard, and still refuses a write from another site", () => {
    expect(guard(onPhone("/api/state", "GET"))).toBeNull();
    expect(guard(onPhone("/api/hermes"))).toBeNull();
    expect(
      guard(req(TAILNET, "/api/hermes", "POST", { [SERVE_LOGIN_HEADER]: "j", "sec-fetch-site": "cross-site" }))?.status,
    ).toBe(403);
  });

  it("refuses a phone only on the actions that stay on the Mac", () => {
    expect(refusePhone(onMac("/api/hermes"))).toBeNull();
    expect(refusePhone(onPhone("/api/hermes"))?.status).toBe(403);
  });
});

describe("an action route on the phone", () => {
  const REFUSED: [string, string, string, unknown?][] = [
    ["hermes", "POST", "/api/hermes"],
    ["tailscale", "POST", "/api/tailscale"],
    ["debug-fix", "POST", "/api/debug-fix", { machine: "ezio", id: "abc" }],
    ["debug-fix", "DELETE", "/api/debug-fix", { key: "ezio/abc" }],
    ["release", "POST", "/api/release", { repo: "collector", number: 232, from: "needs-info" }],
    ["model-login", "POST", "/api/model-login", { machine: "altair", provider: "nous" }],
    ["projects", "POST", "/api/projects", { repos: ["x/y"] }],
    ["proposals", "POST", "/api/proposals", { client: "A", title: "T" }],
    ["proposals", "PUT", "/api/proposals", { id: "x" }],
    ["proposals", "DELETE", "/api/proposals?id=x"],
    ["ticket", "POST", "/api/ticket", { repo: "dividendsolo/collector", title: "T", type: "bug", body: "B" }],
    ["ai-providers", "POST", "/api/ai-providers", { action: "add", provider: "nous", model: "m" }],
    ["ai-providers", "POST", "/api/ai-providers", { action: "remove", provider: "nous" }],
    ["briefs", "POST", "/api/briefs", { machine: "altair", file: "brief.md", archived: true }],
  ];

  it("answers 403 to every one of them, with the tailnet Host, and runs nothing", async () => {
    stubs.startGateway.mockClear();
    stubs.startTailscale.mockClear();
    stubs.runText.mockClear();
    for (const [file, method, path, body] of REFUSED) {
      const r = await routes[file][method](onPhone(path, method, body));
      expect(r.status, `${method} ${path}`).toBe(403);
      expect((await r.json()).why, `${method} ${path}`).toBe("this action stays on the Mac");
    }
    expect(stubs.startGateway).not.toHaveBeenCalled();
    expect(stubs.startTailscale).not.toHaveBeenCalled();
    expect(stubs.runText).not.toHaveBeenCalled();
    expect(stubs.setBriefState).not.toHaveBeenCalled();
    expect(stubs.addFallback).not.toHaveBeenCalled();
    expect(stubs.removeFallbacks).not.toHaveBeenCalled();
  });

  it("still reads the open Debug and fix sessions from the phone", async () => {
    const r = await routes["debug-fix"].GET(onPhone("/api/debug-fix", "GET"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ fixes: {} });
  });

  it("marks a brief read from the phone, the way opening it on the Mac does", async () => {
    stubs.setBriefState.mockClear();
    const r = await routes.briefs.POST(
      onPhone("/api/briefs", "POST", { machine: "altair", file: "brief.md", read: true }),
    );
    expect(r.status).toBe(200);
    expect(stubs.setBriefState).toHaveBeenCalledWith(expect.any(String), { read: true });
  });

  it("behaves as today for the same routes on a loopback Host", async () => {
    stubs.startGateway.mockClear();
    stubs.startTailscale.mockClear();
    expect((await routes.hermes.POST(onMac("/api/hermes"))).status).toBe(200);
    expect(stubs.startGateway).toHaveBeenCalledTimes(1);
    expect((await routes.tailscale.POST(onMac("/api/tailscale"))).status).toBe(200);
    expect(stubs.startTailscale).toHaveBeenCalledTimes(1);
  });
});
