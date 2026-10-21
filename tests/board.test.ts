import { describe, expect, it } from "vitest";
import { boardQuery, diffBoard, isEmpty, laneSet, parseBoard, type Row, reasonOf } from "@/lib/server/board";
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
