import { describe, expect, it } from "vitest";

describe("attentionTag", () => {
  const job = {
    level: "error",
    text: "Lead Watch on ezio: last run error",
    group: "jobs",
    ack: { key: "k1", next: null },
  };
  const port = { level: "error", text: "1 port on ezio is open", group: "security" };
  const triage = [{ lane: "needs-triage" }];

  it("counts the needs-triage row with the server's rows", async () => {
    const { attentionTag } = await import("@/components/app");
    expect(attentionTag([job, port], triage, [])).toEqual({ text: "3", hot: true });
  });

  it("leaves an acknowledged row out", async () => {
    const { attentionTag } = await import("@/components/app");
    expect(attentionTag([job, port], triage, ["k1"])).toEqual({ text: "2", hot: true });
  });

  it("is not red for the triage row alone", async () => {
    const { attentionTag } = await import("@/components/app");
    expect(attentionTag([], triage, [])).toEqual({ text: "1", hot: false });
    expect(attentionTag([], [], [])).toEqual({ text: "", hot: false });
  });
});

describe("attentionTag with briefs", () => {
  it("counts the unread briefs row too", async () => {
    const { attentionTag } = await import("@/components/app");
    expect(attentionTag([], [], [], [{ read: false }, { read: true }])).toEqual({ text: "1", hot: false });
  });
});

describe("attentionTag with P0s", () => {
  it("counts each P0 card, in red", async () => {
    const { attentionTag } = await import("@/components/app");
    const p0 = { lane: "ready-for-human", priority: "P0", repo: "o/r", number: 1, title: "t", url: "u" };
    expect(attentionTag([], [p0, { lane: "needs-triage" }], [])).toEqual({ text: "2", hot: true });
  });
});
