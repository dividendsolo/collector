import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One click releases a waiting card (James, 2026-11-12): "in the waiting stuff, be able to click the badge for the
 * status and just change it ... to ready for agent ... and then it'll just jump up into the current work". The
 * example was situation#964, waiting on "Start Docker Desktop", which he had already done.
 *
 * `POST /api/release` runs the agents' own card tool (`status set <repo>#<n> ready-for-agent --expect <lane>`), so
 * the move is the same one an agent makes, `--expect` refuses a card that moved meanwhile, and the board is read
 * again at once. The tool is mocked here: no test changes a real card.
 */
const calls = vi.hoisted(() => ({
  runText: vi.fn(async (_cmd: string[], _o?: unknown) => ({
    ok: true,
    stdout: "situation#964 -> ready-for-agent",
    error: null as string | null,
  })),
  poll: vi.fn(async (_why?: string) => {}),
}));
vi.mock("@/lib/server/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/run")>("@/lib/server/run");
  return { ...actual, runText: calls.runText };
});
vi.mock("@/lib/server/board", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/board")>("@/lib/server/board");
  return { ...actual, poll: calls.poll };
});

const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const { POST } = await import("@/app/api/release/route");
  return POST(
    new Request("http://127.0.0.1:4000/api/release", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
};

describe("POST /api/release", () => {
  beforeEach(() => {
    calls.runText.mockClear();
    calls.poll.mockClear();
  });

  it("moves a waiting card to ready-for-agent with the status tool, expecting the lane the page showed", async () => {
    const r = await post({ repo: "situation", number: 964, from: "ready-for-human" });
    expect(r.status).toBe(200);
    const cmd = calls.runText.mock.calls[0][0];
    expect(cmd.slice(-5)).toEqual(["set", "situation#964", "ready-for-agent", "--expect", "ready-for-human"]);
    expect(calls.poll).toHaveBeenCalled();
  });

  it("refuses a lane that is not one of James's waiting lanes", async () => {
    const r = await post({ repo: "situation", number: 964, from: "agent-in-progress" });
    expect(r.status).toBe(400);
    expect(calls.runText).not.toHaveBeenCalled();
  });

  it("refuses a bad repo or number", async () => {
    expect((await post({ repo: "../x", number: 1, from: "needs-info" })).status).toBe(400);
    expect((await post({ repo: "situation", number: "1; rm", from: "needs-info" })).status).toBe(400);
    expect(calls.runText).not.toHaveBeenCalled();
  });

  it("says why when the tool refuses (the card moved meanwhile)", async () => {
    calls.runText.mockResolvedValueOnce({
      ok: false,
      stdout: "",
      error: "situation#964 is ready-for-agent, expected ready-for-human",
    });
    const r = await post({ repo: "situation", number: 964, from: "ready-for-human" });
    expect(r.status).toBe(409);
    expect((await r.json()).why).toContain("expected ready-for-human");
  });

  it("refuses a post from another site", async () => {
    const r = await post({ repo: "situation", number: 964, from: "needs-info" }, { "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
    expect(calls.runText).not.toHaveBeenCalled();
  });
});
