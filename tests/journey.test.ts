import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { journeyVisits, journeyWalk, moveTime, nowLine, stayText } from "@/lib/journey";
import { journeyMoves, readTimeline, timelineQuery } from "@/lib/server/journey";

const FIXTURE = path.join(process.cwd(), "tests", "fixtures", "dividend-solo-146.json");
const recorded = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as {
  repo: string;
  number: number;
  recorded: string;
  issue: { title: string; url: string; state: string; createdAt: string };
  pages: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }[];
};

const HOSTS = ["ezio", "altair"];

const moves = journeyMoves(recorded.pages, HOSTS);
const recordedAt = Date.parse(recorded.recorded);
const at = (iso: string) => moves.find((m) => m.at === iso);

describe("the fold over dividend-solo#146's recorded timeline", () => {
  it("is one step per move, the label pair folded into one", () => {
    expect(journeyWalk(moves)).toEqual([
      "needs-triage",
      "scheduled",
      "needs-triage",
      "scheduled",
      "needs-triage",
      "scheduled",
      "ready-for-human",
      "blocked",
      "ready-for-agent",
      "agent-in-progress",
      "verify-in-progress",
      "ready-for-agent",
      "agent-in-progress",
      "verify-in-progress",
      "ready-for-agent",
      "agent-in-progress",
      "verify-in-progress",
      "needs-info",
      "blocked",
      "ready-for-agent",
      "agent-in-progress",
      "needs-info",
      "blocked",
    ]);
  });

  it("folds the housekeeping labels away: the `ezio` flap and `waiting-check` are never steps", () => {
    expect(moves.some((m) => m.status === "ezio" || m.status === "waiting-check")).toBe(false);
    expect(moves.some((m) => m.status === "P2" || m.status === "enhancement")).toBe(false);
    expect(moves.filter((m) => m.who === "ezio")).toHaveLength(11);
  });

  it("carries who moved it, when, and how long it stayed", () => {
    const first = moves[0];
    expect(first.status).toBe("needs-triage");
    expect(first.from).toBeNull();
    expect(first.at).toBe("2026-10-29T15:11:42Z");
    expect(first.who).toBe("dividendsolo");
    expect(first.seconds).toBe(18923);
    expect(moves.at(-1)?.seconds).toBeNull();
    expect(moves.at(-1)?.from).toBe("needs-info");
  });

  it("puts the claim and the Ask on the steps they caused (2026-11-13)", () => {
    const claimed = at("2026-11-13T19:21:49Z");
    expect(claimed).toMatchObject({
      status: "agent-in-progress",
      from: "ready-for-agent",
      who: "ezio",
      why: "Claimed for a build run on ezio.",
    });
    expect(claimed?.url).toBe("https://github.com/dividendsolo/dividend-solo/issues/146#issuecomment-6862668677");
    const asked = at("2026-11-13T19:39:16Z");
    expect(asked).toMatchObject({ status: "needs-info", from: "agent-in-progress", who: "ezio" });
    expect(asked?.why).toBe(
      "decision: Cut the rest of #146 into agent cards and move the card back to ready-for-agent; the builder comment is one cut of it",
    );
    expect(at("2026-11-13T16:09:55Z")).toMatchObject({
      status: "blocked",
      from: "needs-info",
      who: "Housekeeping",
      why: "Blocked by analytics#27, analytics#25 (merged, not deployed yet): moved to blocked.",
    });
    expect(at("2026-11-13T19:11:03Z")).toMatchObject({
      status: "ready-for-agent",
      from: "blocked",
      who: "James, by hand",
      why: "Released by hand (James, 2026-11-13): both blockers are live.",
    });
    expect(at("2026-11-13T21:02:32Z")).toMatchObject({
      status: "blocked",
      from: "needs-info",
      who: "Housekeeping",
      why: "Blocked by dividend-solo#276, agent-stack#420, analytics#39, analytics#38, analytics#37, analytics#36, rep-sheet#287, abide#34, zero-phase#553, situation#984, dividend-solo#275, analytics#35, analytics#34: moved to blocked.",
    });
  });

  it("gives every move the reason nearest to it, and no comment two steps", () => {
    expect(at("2026-11-12T21:28:40Z")?.why).toBe(
      "The verify gate did not pass (try 1 of 3), so no PR was opened or updated.",
    );
    expect(at("2026-11-12T21:29:51Z")?.why).toBe(
      "The verify gate did not pass (try 2 of 3), so no PR was opened or updated.",
    );
    expect(at("2026-11-12T21:28:40Z")?.who).toBe("ezio");
    expect(at("2026-11-12T21:30:46Z")?.why).toBeNull();
    expect(at("2026-11-12T21:31:15Z")?.why).toBe(
      "decision: Read the failing gate above (3 tries) and decide: fix the card, split it, or close it; then move it back to ready-for-agent.",
    );
    const urls = moves.map((m) => m.url).filter(Boolean);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("counts the visits, so a status the card passed twice says so", () => {
    expect(journeyVisits(moves)).toEqual({
      "needs-triage": 3,
      scheduled: 3,
      "ready-for-human": 1,
      blocked: 3,
      "ready-for-agent": 4,
      "agent-in-progress": 4,
      "verify-in-progress": 3,
      "needs-info": 2,
    });
  });

  it("answers the question the view is opened for, from the last step", () => {
    const asked = moves.findIndex((m) => m.at === "2026-11-13T19:39:16Z");
    expect(nowLine(moves.slice(0, asked + 1), { now: recordedAt, zone: "America/New_York" })).toBe(
      "In needs-info since 14:39 EST, because decision: Cut the rest of #146 into agent cards and move the card back to ready-for-agent; the builder comment is one cut of it",
    );
    expect(nowLine(moves, { now: recordedAt, zone: "America/New_York" })).toBe(
      "In blocked since 16:02 EST, because Blocked by dividend-solo#276, agent-stack#420, analytics#39, analytics#38, analytics#37, analytics#36, rep-sheet#287, abide#34, zero-phase#553, situation#984, dividend-solo#275, analytics#35, analytics#34: moved to blocked.",
    );
  });
});

describe("a timeline that is not this card's", () => {
  const node = (type: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    __typename: type,
    createdAt,
    ...extra,
  });
  const pages = (nodes: any[]) => [{ nodes, pageInfo: { hasNextPage: false, endCursor: null } }];

  it("reads a close and a reopen as moves the drawing has", () => {
    const m = journeyMoves(
      pages([
        node("LabeledEvent", "2026-01-01T00:00:00Z", { label: { name: "ready-to-merge" } }),
        node("ClosedEvent", "2026-01-01T01:00:00Z", { actor: { login: "dividendsolo" } }),
        node("ReopenedEvent", "2026-01-02T00:00:00Z", { actor: { login: "dividendsolo" } }),
      ]),
      [],
    );
    expect(journeyWalk(m)).toEqual(["ready-to-merge", "closed", "needs-triage"]);
    expect(m[1].who).toBe("dividendsolo");
    expect(m[1].seconds).toBe(82800);
  });

  it("asks for the events the journey reads, and not the project board's own", () => {
    const q = timelineQuery("acme", "app", 7, null);
    for (const t of [
      "LABELED_EVENT",
      "UNLABELED_EVENT",
      "ISSUE_COMMENT",
      "CLOSED_EVENT",
      "REOPENED_EVENT",
      "CROSS_REFERENCED_EVENT",
    ])
      expect(q, t).toContain(t);
    expect(q).not.toContain("PROJECT_V2_ITEM_STATUS_CHANGED_EVENT");
    expect(q).toContain('repository(owner:"acme",name:"app")');
    expect(q).toContain("issue(number:7)");
    expect(timelineQuery("acme", "app", 7, "CUR")).toContain('after:"CUR"');
    expect(timelineQuery("acme", "app", 7, null)).toContain("timelineItems(first:100");
    expect(timelineQuery('a"b', "c", 7, null)).toContain('owner:"a\\"b"');
  });

  it("does not count a label that is not a status, nor a cross reference", () => {
    const m = journeyMoves(
      pages([
        node("CrossReferencedEvent", "2026-01-01T00:00:00Z"),
        node("LabeledEvent", "2026-01-01T00:00:01Z", { label: { name: "ezio" } }),
        node("LabeledEvent", "2026-01-01T00:00:02Z", { label: { name: "blocked" } }),
        node("UnlabeledEvent", "2026-01-01T00:00:03Z", { label: { name: "blocked" } }),
      ]),
      ["ezio"],
    );
    expect(journeyWalk(m)).toEqual(["blocked"]);
  });
});

const gh = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/server/run", () => ({ run: gh.run }));

describe("reading a timeline's pages", () => {
  const page = (nodes: any[], cursor: string | null, more: boolean) => ({
    data: {
      repository: {
        issue: {
          title: "T",
          url: "https://github.com/acme/app/issues/7",
          state: "OPEN",
          createdAt: "2026-01-01T00:00:00Z",
          timelineItems: { pageInfo: { hasNextPage: more, endCursor: cursor }, nodes },
        },
      },
    },
  });

  beforeEach(() => gh.run.mockReset());

  it("follows the cursor until GitHub says there is no more, so the oldest moves are not lost", async () => {
    gh.run
      .mockResolvedValueOnce([
        page(
          [{ __typename: "LabeledEvent", createdAt: "2026-01-02T00:00:00Z", label: { name: "blocked" } }],
          "C1",
          true,
        ),
        null,
      ])
      .mockResolvedValueOnce([
        page(
          [{ __typename: "LabeledEvent", createdAt: "2026-01-01T00:00:00Z", label: { name: "needs-triage" } }],
          null,
          false,
        ),
        null,
      ]);

    const read = await readTimeline("acme/app", 7);
    expect(gh.run).toHaveBeenCalledTimes(2);
    const first = String(gh.run.mock.calls[0][0].at(-1));
    const second = String(gh.run.mock.calls[1][0].at(-1));
    expect(first).not.toContain("after:");
    expect(second).toContain('after:"C1"');
    expect(read?.pages.flatMap((p) => p.nodes).map((n: any) => n.label.name)).toEqual(["blocked", "needs-triage"]);
    expect(read?.issue?.title).toBe("T");
  });

  it("stops on a page GitHub will not answer, rather than losing the moves it already has", async () => {
    gh.run.mockResolvedValueOnce([null, "timed out after 30 s"]);
    const empty = await readTimeline("acme/app", 7);
    expect(empty?.pages).toEqual([]);
    expect(empty?.issue).toBeNull();
  });
});

describe("staying put, in the words the page uses", () => {
  it("reads a stay in seconds, minutes, hours and days", () => {
    expect(stayText(45)).toBe("45 s");
    expect(stayText(1800)).toBe("30 min");
    expect(stayText(3720)).toBe("1 h 2 min");
    expect(stayText(3600)).toBe("1 h");
    expect(stayText(86400 * 3 + 3600 * 4)).toBe("3 days 4 h");
    expect(stayText(86400 * 2)).toBe("2 days");
    expect(stayText(null)).toBe("—");
  });

  it("shows a time in the viewer's own zone, with the day when it is not today", () => {
    const now = Date.parse("2026-11-13T22:00:00Z");
    expect(moveTime("2026-11-13T19:39:16Z", { now, zone: "America/New_York" })).toBe("14:39 EST");
    expect(moveTime("2026-11-12T21:26:05Z", { now, zone: "America/New_York" })).toBe("Nov 12 16:26 EST");
    expect(moveTime("2026-11-13T19:39:16Z", { now })).toMatch(/^\d{2}:\d{2} \w+$/);
  });
});

describe("a comment's url", () => {
  const node = (type: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
    __typename: type,
    createdAt,
    ...extra,
  });
  const pages = (nodes: any[]) => [{ nodes, pageInfo: { hasNextPage: false, endCursor: null } }];

  it("is kept only when it is a web address, and the reason shows either way", () => {
    const m = journeyMoves(
      pages([
        node("IssueComment", "2026-01-01T00:00:00Z", {
          body: "Blocked by acme#1: moved to `blocked`.",
          url: "javascript:alert(1)",
        }),
        node("LabeledEvent", "2026-01-01T00:00:01Z", { label: { name: "blocked" } }),
      ]),
      [],
    );
    expect(m[0].url).toBeNull();
    expect(m[0].why).toBe("Blocked by acme#1: moved to blocked.");
    const ok = journeyMoves(
      pages([
        node("IssueComment", "2026-01-01T00:00:00Z", {
          body: "Blocked by acme#1: moved to `blocked`.",
          url: "https://github.com/acme/app/issues/1#issuecomment-2",
        }),
        node("LabeledEvent", "2026-01-01T00:00:01Z", { label: { name: "blocked" } }),
      ]),
      [],
    );
    expect(ok[0].url).toBe("https://github.com/acme/app/issues/1#issuecomment-2");
  });
});
