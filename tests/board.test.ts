import { describe, expect, it } from "vitest";
import {
  blockerQuery,
  blockersOf,
  boardQuery,
  diffBoard,
  isEmpty,
  laneSet,
  looksLikeEmptyGlitch,
  parseBoard,
  type Row,
  reasonOf,
  workCards,
} from "@/lib/server/board";
import type { Board } from "@/lib/server/config";

const board: Board = {
  project_id: "PVT_x",
  lanes: { "needs-info": "o1", "ready-for-agent": "o2", "verify-in-progress": null },
  priorities: { P0: "p0", P1: "p1", P2: "p2" },
  label_repos: ["acme/labels"],
};
const issue = (repo: string, number: number, labels: string[] = [], state = "OPEN") => ({
  number,
  title: `T${number}`,
  url: `https://github.com/acme/${repo}/issues/${number}`,
  createdAt: "2026-10-01T00:00:00Z",
  state,
  repository: { name: repo },
  labels: { nodes: labels.map((name) => ({ name })) },
});

describe("parseBoard", () => {
  const data = {
    rateLimit: { cost: 1, remaining: 4900, resetAt: "x" },
    node: {
      items: {
        pageInfo: { hasNextPage: true, endCursor: "c1" },
        nodes: [
          { status: { optionId: "o1" }, priority: { optionId: "p0" }, content: issue("app", 1, ["bug"]) },
          { status: { optionId: "o2" }, priority: null, content: issue("app", 2) },
          { status: { optionId: "zzz" }, priority: null, content: issue("app", 3) }, // a lane we do not list
          { status: { optionId: "o1" }, priority: null, content: {} }, // a draft or a PR
          { status: { optionId: "o1" }, priority: null, content: issue("app", 4, [], "CLOSED") },
          { status: { optionId: "o1" }, priority: null, content: issue("labels", 5) }, // label repo: label wins
        ],
      },
    },
    search: {
      pageInfo: { hasNextPage: false, endCursor: "s1" },
      nodes: [
        issue("labels", 6, ["enhancement", "verify-in-progress", "P2", "P1"]),
        issue("labels", 7, ["enhancement"]), // no lane label
      ],
    },
  };
  const page = parseBoard(data, board, laneSet(board, ["needs-triage"]));

  it("maps Status and Priority option ids to slugs", () => {
    expect(page.rows.map((r) => [r.number, r.lane, r.priority])).toEqual([
      [1, "needs-info", "P0"],
      [2, "ready-for-agent", null],
      [6, "verify-in-progress", "P1"],
    ]);
  });
  it("keeps the issue's labels and the paging state", () => {
    expect(page.rows[0].labels).toEqual(["bug"]);
    expect(page.items).toEqual({ hasNextPage: true, endCursor: "c1" });
    expect(page.search?.hasNextPage).toBe(false);
    expect(page.cost?.cost).toBe(1);
  });
});

describe("boardQuery", () => {
  it("asks only for the lists that still have pages", () => {
    const both = boardQuery(true, true);
    expect(both).toContain("node(id:$p)");
    expect(both).toContain("search(query:$q");
    expect(both).toContain("rateLimit");
    const items = boardQuery(true, false);
    expect(items).not.toContain("search(");
    expect(items).toContain("query($p:ID!,$c:String)");
    expect(boardQuery(false, true)).not.toContain("node(id");
  });
});

describe("diffBoard", () => {
  const row = (n: number, lane: string, extra: Partial<Row> = {}): Row => ({
    repo: "app",
    number: n,
    title: `T${n}`,
    url: `u${n}`,
    lane,
    priority: null,
    created: "",
    labels: [],
    ...extra,
  });
  it("sees moves, new and gone tickets, and edits", () => {
    const d = diffBoard(
      [row(1, "a"), row(2, "a"), row(3, "a")],
      [row(1, "b"), row(3, "a", { priority: "P0" }), row(4, "a")],
    );
    expect(d.moved.map((m) => [m.row.number, m.from, m.row.lane])).toEqual([[1, "a", "b"]]);
    expect(d.added.map((r) => r.number)).toEqual([4]);
    expect(d.removed.map((r) => r.number)).toEqual([2]);
    expect(d.changed.map((r) => r.number)).toEqual([3]);
  });
  it("is empty when nothing changed", () => {
    expect(isEmpty(diffBoard([row(1, "a")], [row(1, "a")]))).toBe(true);
  });
});

describe("reasonOf", () => {
  const comments = [
    { createdAt: "2026-10-01T00:00:00Z", url: "c1", body: "Started the build." },
    { createdAt: "2026-10-02T00:00:00Z", url: "c2", body: "## Note\nThe tests pass. I need your call on the copy." },
    { createdAt: "2026-10-03T00:00:00Z", url: "c3", body: "Later chatter." },
  ];
  it("takes the comment just before the lane label went on, and its strongest sentence", () => {
    const r = reasonOf(
      {
        comments: { nodes: comments },
        timelineItems: { nodes: [{ createdAt: "2026-10-02T01:00:00Z", label: { name: "needs-info" } }] },
      },
      "needs-info",
    );
    expect(r).toEqual({ text: "I need your call on the copy.", url: "c2", at: "2026-10-02T00:00:00Z" });
  });
  it("falls back to the newest comment that reads like a reason", () => {
    const r = reasonOf({ comments: { nodes: comments }, timelineItems: { nodes: [] } }, "needs-info");
    expect(r?.url).toBe("c2");
  });
});

describe("workCards", () => {
  const row = (n: number, lane: string): Row => ({
    repo: "app",
    number: n,
    title: `T${n}`,
    url: `https://github.com/acme/app/issues/${n}`,
    lane,
    priority: null,
    created: "2026-10-01T00:00:00Z",
    labels: [],
  });
  it("holds the `all` lanes, and leaves out the statuses that mean done (collector#53)", () => {
    const rows = [row(1, "agent-in-progress"), row(2, "closed"), row(3, "code-review"), row(4, "needs-triage")];
    expect(workCards(rows, ["agent-in-progress", "closed", "code-review"], ["closed"]).map((c) => c.number)).toEqual([
      1, 3,
    ]);
    // A user's own done status, and the lane list is still the `all` lanes: needs-triage is not on the Work page.
    expect(workCards(rows, ["agent-in-progress", "needs-triage"], ["needs-triage"]).map((c) => c.number)).toEqual([1]);
    // No done status set: every card in `all` is open work, which is what the page did before the setting.
    expect(workCards(rows, ["agent-in-progress", "closed", "code-review"], []).map((c) => c.number)).toEqual([1, 2, 3]);
  });
});

describe("looksLikeEmptyGlitch", () => {
  const row = (repo: string): Row => ({
    repo,
    number: 1,
    title: "T",
    url: `https://github.com/acme/${repo}/issues/1`,
    lane: "needs-info",
    priority: null,
    created: "2026-10-01T00:00:00Z",
    labels: [],
  });
  it("an empty Board right after a read with Board cards is the glitch", () => {
    expect(looksLikeEmptyGlitch({ itemNodes: 0, searchNodes: 5 }, [row("app"), row("labels")], board)).toBe(true);
  });
  it("a Board that answers with items is a real read", () => {
    expect(looksLikeEmptyGlitch({ itemNodes: 30, searchNodes: 5 }, [row("app")], board)).toBe(false);
  });
  it("an empty list is real when the last read had no cards from it, or there was none", () => {
    expect(looksLikeEmptyGlitch({ itemNodes: 0, searchNodes: 5 }, [row("labels")], board)).toBe(false);
    expect(looksLikeEmptyGlitch({ itemNodes: 30, searchNodes: 0 }, [row("app")], board)).toBe(false);
    expect(looksLikeEmptyGlitch({ itemNodes: 0, searchNodes: 0 }, null, board)).toBe(false);
  });
  it("an empty label-repo search right after a read with label-repo cards is the glitch too", () => {
    expect(looksLikeEmptyGlitch({ itemNodes: 30, searchNodes: 0 }, [row("app"), row("labels")], board)).toBe(true);
  });
});

describe("blockersOf", () => {
  const node = (n: number, state: string) => ({
    number: n,
    state,
    url: `https://github.com/acme/analytics/issues/${n}`,
    repository: { name: "analytics" },
  });
  it("names the open blockers of a blocked card", () => {
    const issue = { blockedBy: { nodes: [node(8, "OPEN"), node(5, "CLOSED")] } };
    expect(blockersOf(issue)).toEqual([{ ref: "analytics#8", url: "https://github.com/acme/analytics/issues/8" }]);
  });
  it("names the closed ones when every blocker is closed (code not deployed yet)", () => {
    expect(blockersOf({ blockedBy: { nodes: [node(5, "CLOSED")] } }).map((b) => b.ref)).toEqual(["analytics#5"]);
  });
  it("is empty for an issue with no blockers", () => {
    expect(blockersOf({ blockedBy: { nodes: [] } })).toEqual([]);
    expect(blockersOf(null)).toEqual([]);
  });
  it("asks for the blocked-by cards of each card, one alias per card", () => {
    const q = blockerQuery([{ url: "https://github.com/acme/analytics/issues/7" }]);
    expect(q).toContain('i0: repository(owner:"acme",name:"analytics"){ issue(number:7)');
    expect(q).toContain("blockedBy(first:10)");
  });
});

describe("workCards blocked", () => {
  it("carries a blocked card's blockers to the page", () => {
    const blockers = [{ ref: "analytics#8", url: "https://github.com/acme/analytics/issues/8" }];
    const rows: Row[] = [
      {
        repo: "analytics",
        number: 7,
        title: "T7",
        url: "https://github.com/acme/analytics/issues/7",
        lane: "blocked",
        priority: "P2",
        created: "2026-11-03T00:00:00Z",
        labels: ["blocked", "P2"],
        blockers,
      },
    ];
    expect(workCards(rows, ["blocked"], ["closed"])[0].blockers).toEqual(blockers);
  });
});

describe("the label repos come from status (James, 2026-11-10)", () => {
  it("takes the repo list status prints, so a new repo shows without a config edit", async () => {
    const { labelReposFrom } = await import("@/lib/server/board");
    const board = { label_repos: ["dividendsolo/situation"] } as unknown as Board;
    expect(
      labelReposFrom(board, ["dividendsolo/situation", "dividendsolo/darndest", "dividendsolo/pageroast"]),
    ).toEqual(["dividendsolo/situation", "dividendsolo/darndest", "dividendsolo/pageroast"]);
  });

  it("falls back to config.json when status cannot answer", async () => {
    const { labelReposFrom } = await import("@/lib/server/board");
    const board = { label_repos: ["dividendsolo/situation"] } as unknown as Board;
    expect(labelReposFrom(board, null)).toEqual(["dividendsolo/situation"]);
    expect(labelReposFrom(board, [])).toEqual(["dividendsolo/situation"]);
  });
});
