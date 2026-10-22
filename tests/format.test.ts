import { describe, expect, it } from "vitest";
import { ago, daysAgo, duration, moneyParts, schedule, shortRole, status, waitingOrder } from "@/lib/format";

describe("format", () => {
  it("says how long ago", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(ago("2026-10-21T11:59:30Z", now)).toBe("30 s ago");
    expect(ago("2026-10-21T11:00:00Z", now)).toBe("1 h ago");
    expect(ago("2026-10-20T12:00:00Z", now)).toBe("1 day ago");
    expect(ago(null, now)).toBe("—");
    expect(daysAgo("2026-10-21T08:00:00Z", now)).toBe("today");
    expect(daysAgo("2026-10-18T08:00:00Z", now)).toBe("3 days ago");
  });
  it("formats durations", () => {
    expect(duration(600)).toBe("10 min");
    expect(duration(3900)).toBe("1 h 5 min");
  });
  it("reads cron and launchd schedules", () => {
    expect(schedule("*/5 * * * *")).toBe("every 5 min");
    expect(schedule("0 9 * * 1-5")).toBe("weekdays 09:00");
    expect(schedule("30 7 * * *", "UTC", "EDT")).toBe("daily 07:30 UTC");
    expect(schedule("0 8 * * 1")).toBe("Mon 08:00");
    expect(schedule('{"Hour":6,"Minute":5}')).toBe("daily 06:05");
    expect(schedule("every 120m")).toBe("every 120m");
  });
  it("names job status", () => {
    expect(status({ enabled: false, state: "completed" })).toBe("Done");
    expect(status({ enabled: true, last_status: "delivery_failed" })).toBe("Warning");
    expect(status({ enabled: true, last_status: "error" })).toBe("Failed");
    expect(status({ enabled: true, last_status: "ok (opened a PR)" })).toBe("OK");
  });
  it("splits dollar amounts out of a sentence for the blur", () => {
    expect(moneyParts("usable on the $22/month plan")).toEqual([
      { text: "usable on the ", money: false },
      { text: "$22/month", money: true },
      { text: " plan", money: false },
    ]);
  });
  it("shortens a role", () => {
    expect(shortRole("The builder (Mac): builds cards")).toBe("builder");
  });
});

describe("waitingOrder", () => {
  it("sorts by priority, then ready-for-human, needs-manual-qa, needs-info, needs-triage, then oldest", () => {
    const rows = [
      { id: "p1-triage", priority: "P1", lane: "needs-triage", created: "2026-10-01" },
      { id: "p2-human", priority: "P2", lane: "ready-for-human", created: "2026-10-01" },
      { id: "p1-info", priority: "P1", lane: "needs-info", created: "2026-10-01" },
      { id: "p1-human-new", priority: "P1", lane: "ready-for-human", created: "2026-10-20" },
      { id: "p1-qa", priority: "P1", lane: "needs-manual-qa", created: "2026-10-01" },
      { id: "p1-human-old", priority: "P1", lane: "ready-for-human", created: "2026-10-02" },
      { id: "p0-triage", priority: "P0", lane: "needs-triage", created: "2026-10-21" },
    ];
    expect(rows.sort(waitingOrder).map((r) => r.id)).toEqual([
      "p0-triage",
      "p1-human-old",
      "p1-human-new",
      "p1-qa",
      "p1-info",
      "p1-triage",
      "p2-human",
    ]);
  });
});
