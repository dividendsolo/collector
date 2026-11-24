import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkTicket, newTicket, ticketRequest } from "@/lib/ticket";

const ROSTER = ["dividendsolo/collector", "dividendsolo/situation"];
const URL_OF = "https://github.com/dividendsolo/collector/issues/240";

const calls = vi.hoisted(() => ({
  runText: vi.fn(async (_cmd: string[], _o?: unknown) => ({ ok: true, stdout: "", error: null as string | null })),
  poll: vi.fn(async (_why?: string) => {}),
  roster: vi.fn(async () => ["dividendsolo/collector", "dividendsolo/situation"] as string[] | null),
  rows: [] as { url: string; lane: string }[],
}));
vi.mock("@/lib/server/run", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/run")>("@/lib/server/run");
  return { ...actual, runText: calls.runText };
});
vi.mock("@/lib/server/board", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/board")>("@/lib/server/board");
  return { ...actual, poll: calls.poll, readStatusRepos: calls.roster };
});

const ok = (stdout = "") => ({ ok: true, stdout, error: null });
const fail = (error: string) => ({ ok: false, stdout: "", error });

const answer = (cmd: string[]) => {
  if (cmd[0] === "gh") return ok(`${URL_OF}\n`);
  return ok("collector#240 -> needs-triage");
};

const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const { POST } = await import("@/app/api/ticket/route");
  return POST(
    new Request("http://127.0.0.1:4000/api/ticket", {
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

const good = {
  repo: "dividendsolo/collector",
  title: "Add a card from Collector",
  body: "A button under Waiting on you.",
  type: "enhancement",
  priority: "none",
  status: "needs-triage",
};

describe("the New card form", () => {
  it("defaults to needs-triage and no priority with nothing chosen", () => {
    const d = newTicket();
    expect(d.status).toBe("needs-triage");
    expect(d.priority).toBe("none");
    expect(d.title).toBe("");
  });

  it("sends exactly the chosen repo, title, body, type, priority and status", () => {
    const sent = ticketRequest({
      repo: "dividendsolo/situation",
      title: "  Map pins drift  ",
      body: "Seen on 3D.",
      type: "bug",
      priority: "P1",
      status: "ready-for-agent",
    });
    expect(JSON.parse(sent)).toEqual({
      repo: "dividendsolo/situation",
      title: "Map pins drift",
      body: "Seen on 3D.",
      type: "bug",
      priority: "P1",
      status: "ready-for-agent",
    });
  });

  it("names the priority gate on the form before anything is sent", () => {
    const r = checkTicket({ ...good, status: "ready-for-agent" }, ROSTER);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.why).toMatch(/priority/i);
  });
});

describe("POST /api/ticket", () => {
  beforeEach(() => {
    calls.runText.mockReset();
    calls.runText.mockImplementation(async (cmd: string[]) => answer(cmd));
    calls.poll.mockClear();
    calls.roster.mockClear();
  });

  it("creates the issue with its type label, moves it, and polls the board", async () => {
    const r = await post({ ...good, priority: "P2", status: "ready-for-agent" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, url: URL_OF, number: 240 });
    const cmds = calls.runText.mock.calls.map((c) => c[0]);
    expect(cmds[0]).toEqual([
      "gh",
      "issue",
      "create",
      "-R",
      "dividendsolo/collector",
      "--title",
      good.title,
      "--label",
      "enhancement",
      "--body-file",
      "-",
    ]);
    expect(calls.runText.mock.calls[0][1]).toMatchObject({ input: good.body });
    expect(cmds[1].slice(-3)).toEqual(["set", "dividendsolo/collector#240", "ready-for-agent"]);
    expect(cmds[2].slice(-3)).toEqual(["priority", "dividendsolo/collector#240", "P2"]);
    expect(calls.poll).toHaveBeenCalledWith("new-ticket");
  });

  it("sets no priority when none was chosen", async () => {
    await post(good);
    const cmds = calls.runText.mock.calls.map((c) => c[0]);
    expect(cmds).toHaveLength(2);
    expect(cmds[1].slice(-3)).toEqual(["set", "dividendsolo/collector#240", "needs-triage"]);
  });

  it.each([
    ["a repo outside the roster", { repo: "someone/else" }],
    ["a type outside the ticket types", { type: "chore" }],
    ["a status outside the agent-stack statuses", { status: "done-ish" }],
    ["a priority outside P0, P1, P2 and none", { priority: "P3" }],
    ["an empty title", { title: "   " }],
  ])("refuses %s before any command", async (_name, change) => {
    const r = await post({ ...good, ...change });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
    expect(calls.runText).not.toHaveBeenCalled();
  });

  it("refuses a status past triage with no priority, naming the priority gate, before any gh call", async () => {
    const r = await post({ ...good, status: "ready-for-agent", priority: "none" });
    expect(r.status).toBe(400);
    expect((await r.json()).why).toMatch(/priority/i);
    expect(calls.runText).not.toHaveBeenCalled();
  });

  it("returns gh's own error when the issue cannot be created, and makes no card", async () => {
    calls.runText.mockImplementationOnce(async () => fail("could not add label: 'enhancement' not found"));
    const r = await post(good);
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, step: "gh issue create" });
    expect(body.why).toContain("'enhancement' not found");
    expect(body.url).toBeUndefined();
    expect(calls.runText).toHaveBeenCalledTimes(1);
    expect(calls.poll).not.toHaveBeenCalled();
  });

  it("says the card was created but not moved, with its URL, when status set fails", async () => {
    calls.runText.mockImplementation(async (cmd: string[]) =>
      cmd[0] === "gh" ? ok(`${URL_OF}\n`) : fail("priority gate: set a priority first"),
    );
    const r = await post(good);
    expect(r.status).toBe(502);
    const body = await r.json();
    expect(body).toMatchObject({ ok: false, step: "status set", url: URL_OF });
    expect(body.why).toMatch(/created but not moved/);
    expect(body.why).toContain("priority gate");
    expect(calls.poll).toHaveBeenCalledWith("new-ticket");
  });

  it("refuses a post from another site", async () => {
    const r = await post(good, { "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
    expect(calls.runText).not.toHaveBeenCalled();
  });

  it("answers the live roster on GET", async () => {
    const { GET } = await import("@/app/api/ticket/route");
    const r = await GET(new Request("http://127.0.0.1:4000/api/ticket", { headers: { host: "127.0.0.1:4000" } }));
    expect(await r.json()).toEqual({ repos: ROSTER });
  });
});

describe("the new card in Waiting on you", () => {
  it("is on the list after the poll the route runs", async () => {
    const { waitingList, AGENT_STACK_STATUSES } = await import("@/lib/statuses");
    const before = waitingList(calls.rows as any, AGENT_STACK_STATUSES.waiting);
    expect(before.some((t: any) => t.url === URL_OF)).toBe(false);
    calls.poll.mockImplementationOnce(async () => {
      calls.rows.push({ url: URL_OF, lane: "needs-triage" });
    });
    calls.runText.mockImplementation(async (cmd: string[]) => answer(cmd));
    await post(good);
    const after = waitingList(calls.rows as any, AGENT_STACK_STATUSES.waiting);
    expect(after.map((t: any) => t.url)).toContain(URL_OF);
  });
});
