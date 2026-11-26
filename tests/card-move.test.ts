import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMove, closesCard } from "@/lib/card-move";
import { SERVE_LOGIN_HEADER } from "@/lib/server/guard";

const stubs = vi.hoisted(() => ({
  runText: vi.fn(async (_cmd: string[], _o?: unknown) => ({
    ok: true,
    stdout: "collector#232 -> ready-for-human",
    error: null as string | null,
  })),
  poll: vi.fn(async (_why?: string) => {}),
}));

vi.mock("@/lib/server/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/run")>("@/lib/server/run");
  return { ...actual, runText: stubs.runText };
});
vi.mock("@/lib/server/board", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/board")>("@/lib/server/board");
  return { ...actual, poll: stubs.poll };
});

const { POST } = await import("@/app/api/card-move/route");

const MAC = "127.0.0.1:4000";
const TAILNET = "altair.tailnet.ts.net";

const move = (host: string, body: unknown, phone = false) =>
  POST(
    new Request(`http://${host}/api/card-move`, {
      method: "POST",
      headers: {
        host,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...(phone ? { [SERVE_LOGIN_HEADER]: "someone@example.com" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

const onMac = (body: unknown) => move(MAC, body);
const onPhone = (body: unknown) => move(TAILNET, body, true);

describe("checkMove", () => {
  it("wants a card, and a status or a priority to set", () => {
    expect(checkMove({ repo: "collector", number: 232 }).ok).toBe(false);
    expect(checkMove({ repo: "../x", number: 232, status: "closed" }).ok).toBe(false);
    expect(checkMove({ repo: "collector", number: 0, status: "closed" }).ok).toBe(false);
    const missing = checkMove({ repo: "collector", number: 232 });
    expect(missing.ok ? "" : missing.why).toContain("A move sets a status");
  });

  it("takes a status from the agent stack list, and P0 to P2", () => {
    expect(checkMove({ repo: "collector", number: 232, status: "ready-for-human" })).toEqual({
      ok: true,
      move: { repo: "collector", number: 232, status: "ready-for-human", priority: "" },
    });
    expect(checkMove({ repo: "collector", number: 232, status: "nonsense" }).ok).toBe(false);
    expect(checkMove({ repo: "collector", number: 232, priority: "P5" }).ok).toBe(false);
  });

  it("reads a done status as closing a card", () => {
    expect(closesCard("closed", ["closed"])).toBe(true);
    expect(closesCard("ready-for-human", ["closed"])).toBe(false);
  });
});

describe("POST /api/card-move", () => {
  beforeEach(() => {
    stubs.runText.mockClear();
    stubs.poll.mockClear();
  });

  it("sets the status and the priority with the status tool, then polls the board", async () => {
    const r = await onMac({ repo: "collector", number: 232, status: "ready-for-human", priority: "P1" });
    expect(r.status).toBe(200);
    const calls = stubs.runText.mock.calls.map((c) => c[0]);
    expect(calls[0].slice(-3)).toEqual(["set", "collector#232", "ready-for-human"]);
    expect(calls[1].slice(-3)).toEqual(["priority", "collector#232", "P1"]);
    expect(stubs.poll).toHaveBeenCalled();
  });

  it("sets only the priority when no status is named", async () => {
    expect((await onMac({ repo: "collector", number: 232, priority: "P2" })).status).toBe(200);
    expect(stubs.runText.mock.calls).toHaveLength(1);
    expect(stubs.runText.mock.calls[0][0].slice(-3)).toEqual(["priority", "collector#232", "P2"]);
  });

  it("refuses a bad card before it runs anything", async () => {
    expect((await onMac({ repo: "collector", number: "232; rm" })).status).toBe(400);
    expect(stubs.runText).not.toHaveBeenCalled();
  });

  it("says why when the tool refuses, and names the step", async () => {
    stubs.runText.mockResolvedValueOnce({
      ok: false,
      stdout: "",
      error: "collector#232 is closed, expected ready-for-human",
    });
    const r = await onMac({ repo: "collector", number: 232, status: "ready-for-human" });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.step).toBe("status set");
    expect(body.why).toContain("expected ready-for-human");
  });

  it("moves a card from the phone, and refuses to close one there", async () => {
    expect((await onPhone({ repo: "collector", number: 232, status: "needs-info" })).status).toBe(200);
    const closing = await onPhone({ repo: "collector", number: 232, status: "closed" });
    expect(closing.status).toBe(403);
    expect((await closing.json()).why).toBe("closing a card stays on the Mac");
  });
});
