import { describe, expect, it } from "vitest";
import {
  AGENT_STACK_STATUSES,
  isAgentStack,
  STATUS_GROUPS,
  statusSets,
  waitingList,
  waitingOrder,
  waitingRank,
} from "@/lib/statuses";

/** A ticket in the shape the board read hands the page. */
const ticket = (id: string, lane: string, extra: Record<string, unknown> = {}) => ({
  id,
  lane,
  priority: null,
  created: "2026-10-01",
  ...extra,
});

describe("statusSets", () => {
  it("is the agent stack's own statuses when config.json sets nothing", () => {
    expect(statusSets({})).toEqual(AGENT_STACK_STATUSES);
    expect(statusSets()).toEqual({
      waiting: ["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage"],
      working: ["agent-in-progress", "verify-in-progress"],
      done: ["closed"],
    });
    expect(isAgentStack(statusSets({}))).toBe(true);
  });

  it("takes the set the file names, and the agent stack's for the sets it does not", () => {
    const s = statusSets({ statuses: { waiting: ["blocked-on-me", "review-me"] } });
    expect(s.waiting).toEqual(["blocked-on-me", "review-me"]);
    expect(s.working).toEqual(AGENT_STACK_STATUSES.working);
    expect(s.done).toEqual(AGENT_STACK_STATUSES.done);
    expect(isAgentStack(s)).toBe(false);
    expect(isAgentStack(statusSets({ statuses: { done: ["shipped"] } }))).toBe(false);
  });

  it("keeps tickets.each as the waiting set, so a config that already set it changes not at all", () => {
    // The older name for the same list (README's `tickets`): the page watched these lanes before the setting.
    expect(statusSets({ tickets: { each: ["needs-info"] } }).waiting).toEqual(["needs-info"]);
    // The setting wins over it, and an empty list is a set of none rather than "unset".
    expect(statusSets({ tickets: { each: ["needs-info"] }, statuses: { waiting: ["blocked-on-me"] } }).waiting).toEqual(
      ["blocked-on-me"],
    );
    expect(statusSets({ statuses: { waiting: [] } }).waiting).toEqual([]);
  });

  it("sorts tickets.each by the agent stack's order, so the list matches main card for card", () => {
    // On main `tickets.each` only chose the lanes; the fixed agent-stack order sorted them (James, 2026-10-22).
    const each = ["needs-triage", "my-own-lane", "needs-info", "needs-manual-qa", "ready-for-human"];
    const s = statusSets({ tickets: { each } });
    expect(s.waiting).toEqual(["ready-for-human", "needs-manual-qa", "needs-info", "needs-triage", "my-own-lane"]);
    const tickets = [
      ticket("#4", "needs-triage", { priority: "P1" }),
      ticket("#3", "needs-info", { priority: "P1" }),
      ticket("#2", "needs-manual-qa", { priority: "P1" }),
      ticket("#1", "ready-for-human", { priority: "P1" }),
      ticket("#5", "my-own-lane", { priority: "P1" }),
    ];
    expect(waitingList(tickets, s.waiting).map((t) => t.id)).toEqual(["#1", "#2", "#3", "#4", "#5"]);
    // An explicit statuses.waiting keeps its own order.
    expect(statusSets({ tickets: { each }, statuses: { waiting: ["needs-triage", "needs-info"] } }).waiting).toEqual([
      "needs-triage",
      "needs-info",
    ]);
  });

  it("ignores a set that is not a list of names", () => {
    expect(statusSets({ statuses: { waiting: "blocked-on-me" as never } }).waiting).toEqual(
      AGENT_STACK_STATUSES.waiting,
    );
    expect(statusSets({ statuses: { waiting: ["blocked-on-me", 3 as never] } }).waiting).toEqual(["blocked-on-me"]);
  });
});

describe("waitingList", () => {
  it("shows only the set's lanes, in the set's order", () => {
    // The card's own example: a user's set of two statuses, in the order the user wrote them.
    const tickets = [
      ticket("a", "needs-triage", { priority: "P0" }),
      ticket("b", "review-me"),
      ticket("c", "ready-for-human"),
      ticket("d", "blocked-on-me", { priority: "P2" }),
      ticket("e", "blocked-on-me", { priority: "P1" }),
    ];
    expect(waitingList(tickets, ["blocked-on-me", "review-me"]).map((t) => t.id)).toEqual(["e", "d", "b"]);
    // A P0 in a lane the set does not name never jumps the set: needs-triage is not on this list at all.
    expect(waitingList(tickets, ["blocked-on-me", "review-me"]).map((t) => t.lane)).not.toContain("needs-triage");
  });

  it("sorts by priority, then the set's order, then oldest", () => {
    const rows = [
      ticket("p1-triage", "needs-triage", { priority: "P1" }),
      ticket("p2-human", "ready-for-human", { priority: "P2" }),
      ticket("p1-info", "needs-info", { priority: "P1" }),
      ticket("p1-human-new", "ready-for-human", { priority: "P1", created: "2026-10-20" }),
      ticket("p1-qa", "needs-manual-qa", { priority: "P1" }),
      ticket("p1-human-old", "ready-for-human", { priority: "P1", created: "2026-10-02" }),
      ticket("p0-triage", "needs-triage", { priority: "P0", created: "2026-10-21" }),
    ];
    expect(waitingList(rows, AGENT_STACK_STATUSES.waiting).map((r) => r.id)).toEqual([
      "p0-triage",
      "p1-human-old",
      "p1-human-new",
      "p1-qa",
      "p1-info",
      "p1-triage",
      "p2-human",
    ]);
  });

  it("leaves the list it was given alone", () => {
    const rows = [ticket("b", "review-me"), ticket("a", "blocked-on-me")];
    const before = rows.map((r) => r.id);
    waitingList(rows, ["blocked-on-me", "review-me"]);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("waitingRank and waitingOrder", () => {
  it("ranks a lane the set does not name last, and a missing lane too", () => {
    expect(waitingRank(["blocked-on-me"], "blocked-on-me")).toBe(0);
    expect(waitingRank(["blocked-on-me"], "needs-info")).toBe(1);
    expect(waitingRank(["blocked-on-me"], null)).toBe(1);
  });
  it("is the comparator the list is sorted with", () => {
    const rows = [ticket("b", "review-me"), ticket("a", "blocked-on-me")];
    expect([...rows].sort(waitingOrder(["blocked-on-me", "review-me"])).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("waitingList and the waiting crew", () => {
  it("leaves out a card the crew is checking, and shows it again once the label is off", () => {
    const rows = [
      { id: "a", lane: "needs-info", created: "2026-11-01", checking: true },
      { id: "b", lane: "needs-info", created: "2026-11-02" },
    ];
    expect(waitingList(rows, ["needs-info"]).map((r) => r.id)).toEqual(["b"]);
    expect(waitingList([{ ...rows[0], checking: false }, rows[1]], ["needs-info"]).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("the Card flow page's groups", () => {
  it("names the three sets in the order the page reads them", () => {
    expect(STATUS_GROUPS.map((g) => g.key)).toEqual(["waiting", "working", "done"]);
    expect(STATUS_GROUPS.every((g) => g.label && g.does)).toBe(true);
  });
});
