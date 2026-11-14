import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * collector#139 (James, 2026-11-13): "the check in a needs-triage badge under Waiting on you is redundant now".
 * The waiting crew (agent-stack#261) already moves a complete needs-triage card to ready-for-agent, so the cards
 * left there need a real triage with James. A needs-triage badge starts the same interactive triage session the
 * Priority tasks Triage button starts, for any of the cards, not only when there is one; the other waiting lanes
 * (ready-for-human, needs-info, needs-manual-qa) keep the check that hands the card to the agents.
 *
 * The board and the fix read are mocked here: the page renders from its own reads, and no test opens a session.
 */
const page = vi.hoisted(() => ({ board: null as any, fixes: null as any }));
vi.mock("@/components/data", async () => {
  const actual = await vi.importActual<typeof import("@/components/data")>("@/components/data");
  return {
    ...actual,
    useLive: () => ({ state: null, updated: "", liveClass: "live", tick: () => {}, board: page.board }),
    useApi: () => ({ data: page.fixes ? { fixes: page.fixes } : undefined, mutate: async () => {} }),
  };
});

const api = vi.hoisted(() => ({
  view: null as any,
  open: {} as any,
  opened: [] as { key: string; prompt: string; name: string }[],
}));
vi.mock("@/lib/server/board", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/board")>("@/lib/server/board");
  return { ...actual, ticketsView: () => api.view };
});
vi.mock("@/lib/server/debug-fix", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/debug-fix")>("@/lib/server/debug-fix");
  return {
    ...actual,
    openFixes: async () => api.open,
    openFixPane: async (key: string, prompt: string, name: string) => {
      api.opened.push({ key, prompt, name });
      return { ok: true, pane: "%9" } as const;
    },
  };
});

const { Waiting } = await import("@/components/dashboard");
const { parseFixes } = await import("@/lib/server/debug-fix");

const REPO = "dividendsolo/agent-stack";
const card = (number: number, lane: string) => ({
  repo: "agent-stack", // the board names the repo without its owner, as the Unblock 500 showed (2026-11-11)
  number,
  title: `Card ${number}`,
  url: `https://github.com/${REPO}/issues/${number}`,
  lane,
  priority: "P2",
  created: "2026-11-01T00:00:00Z",
  type: null,
  checking: false,
});
const boardOf = (tickets: any[]) => ({
  tickets: { loaded: true, each: ["needs-triage", "needs-info"], working: [], done: [], count: [], tickets },
  work: null,
});

/** One row of the rendered table, by the card it shows. The Card cell names the card (`agent-stack#1`) and opens
 * its journey in Collector (collector#146), so the row no longer carries the issue's GitHub URL. */
const rowOf = (html: string, number: number) =>
  html.split("<tr").find((r) => r.includes(`agent-stack#${number}`)) ?? "";

describe("a needs-triage row's badge", () => {
  beforeEach(() => {
    page.fixes = null;
    page.board = boardOf([card(1, "needs-triage"), card(2, "needs-triage"), card(3, "needs-info")]);
  });

  it("shows the triage button and no check, while a needs-info row keeps the check", () => {
    const html = renderToStaticMarkup(createElement(Waiting));
    const triage = rowOf(html, 1);
    expect(triage).toContain('aria-label="Triage dividendsolo/agent-stack#1 with James"');
    expect(triage).toContain('title="Interactive triage"');
    expect(triage).toContain('href="#i-split"');
    expect(triage).not.toContain("#i-check");
    expect(triage).toContain("needs-triage");
    // The other waiting lane is untouched: the check that moves the card to ready-for-agent is still there.
    const other = rowOf(html, 3);
    expect(other).toContain("#i-check");
    expect(other).toContain('title="Ready for agent"');
    expect(other).not.toContain("#i-split");
    expect((html.match(/#i-split/g) || []).length).toBe(2);
  });

  it("says triaging on the card being triaged and holds the other buttons while it runs", () => {
    page.fixes = {
      triage: { pane: "%9", step: "triaging", state: "working", card: { repo: REPO, number: 1 } },
    };
    const html = renderToStaticMarkup(createElement(Waiting));
    const mine = rowOf(html, 1);
    expect(mine).toContain(">triaging<");
    expect(mine).not.toContain(">needs-triage<");
    expect(mine).toContain('title="Triaging dividendsolo/agent-stack#1 in tmux pane %9"');
    expect(mine).toMatch(/<button[^>]*disabled/);
    const other = rowOf(html, 2);
    expect(other).toContain(">needs-triage<");
    expect(other).toContain('title="A triage session is open"');
    expect(other).toMatch(/<button[^>]*disabled/);
    // The other lanes' checks are not held by a triage session.
    expect(rowOf(html, 3)).not.toMatch(/<button[^>]*disabled/);
  });

  it("has no check in a needs-triage badge at all, session open or not", () => {
    for (const fixes of [
      null,
      { triage: { pane: "%9", step: "triaging", state: "working", card: { repo: REPO, number: 1 } } },
    ]) {
      page.fixes = fixes;
      const triage = rowOf(renderToStaticMarkup(createElement(Waiting)), 1);
      expect(triage).not.toContain("#i-check");
    }
  });
});

describe("the triage pane's card", () => {
  it("is read from the pane's own name, so one session is one card", () => {
    expect(parseFixes("%9|triage|starting|triage dividendsolo/agent-stack#1\n")).toEqual({
      triage: {
        pane: "%9",
        step: "triaging",
        state: "working",
        card: { repo: REPO, number: 1 },
      },
    });
    // A pane opened before this change carries no name: the session still reads, its card unknown.
    expect(parseFixes("%9|triage|starting\n")).toEqual({
      triage: { pane: "%9", step: "triaging", state: "working" },
    });
  });

  it("adds nothing to the other panes' records", () => {
    expect(parseFixes("%2|ezio/abc|fixing|Debug and fix · ezio\n")).toEqual({
      "ezio/abc": { pane: "%2", step: "fixing", state: "working" },
    });
  });

  it("is asked for on every read of the open panes", async () => {
    // The real read, not the route test's mock of it.
    const real = await vi.importActual<typeof import("@/lib/server/debug-fix")>("@/lib/server/debug-fix");
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      return { ok: true, stdout: "%9|triage|starting|triage dividendsolo/agent-stack#1\n", error: null };
    };
    const open = await real.openFixes(run as any);
    expect(calls[0].join(" ")).toContain("#{@collector_name}");
    expect(open.triage.card).toEqual({ repo: REPO, number: 1 });
  });
});

const post = async (body: unknown) => {
  const { POST } = await import("@/app/api/debug-fix/route");
  return POST(
    new Request("http://127.0.0.1:4000/api/debug-fix", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
};

describe("POST /api/debug-fix with a triage card", () => {
  beforeEach(() => {
    api.open = {};
    api.opened = [];
  });

  it("opens the session for any card in needs-triage, not only when one waits", async () => {
    api.view = { each: ["needs-triage"], tickets: [card(1, "needs-triage"), card(2, "needs-triage")] };
    const r = await post({ triage: { repo: REPO, number: 2 } });
    expect(r.status).toBe(200);
    expect(api.opened).toHaveLength(1);
    expect(api.opened[0].key).toBe("triage");
    expect(api.opened[0].name).toBe("triage dividendsolo/agent-stack#2");
    // The same session the Priority tasks Triage button opens: the triage skill's own command, then the request.
    expect(api.opened[0].prompt.startsWith("/skill:triage ")).toBe(true);
    expect(api.opened[0].prompt).toContain("dividendsolo/agent-stack#2");
  });

  it("refuses a card that is not in needs-triage now", async () => {
    api.view = { each: ["needs-triage", "needs-info"], tickets: [card(3, "needs-info")] };
    const r = await post({ triage: { repo: REPO, number: 3 } });
    expect(r.status).toBe(409);
    expect((await r.json()).why).toContain("not in needs-triage");
    const gone = await post({ triage: { repo: REPO, number: 99 } });
    expect(gone.status).toBe(409);
    const bad = await post({ triage: { repo: "o/a; rm -rf ~", number: 1 } });
    expect(bad.status).toBe(409);
    expect(api.opened).toHaveLength(0);
  });

  it("refuses a second card while the one triage session is open", async () => {
    api.view = { each: ["needs-triage"], tickets: [card(1, "needs-triage"), card(2, "needs-triage")] };
    api.open = {
      triage: { pane: "%9", step: "triaging", state: "working", card: { repo: REPO, number: 1 } },
    };
    const r = await post({ triage: { repo: REPO, number: 2 } });
    expect(r.status).toBe(409);
    const why = (await r.json()).why;
    expect(why).toContain("already open");
    expect(why).toContain("dividendsolo/agent-stack#1");
    expect(api.opened).toHaveLength(0);
  });
});
