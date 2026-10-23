import { describe, expect, it } from "vitest";
import { pickReason } from "@/lib/server/text";

const c = (createdAt: string, body: string) => ({ createdAt, url: `https://x/${createdAt}`, body });
const ASK = "**Ask (decision):** Read the post and say yes or no: is the voice yours?\n\n> *Posted by lane set.*";

describe("pickReason", () => {
  it("shows the Ask line, with its kind, over a later plain comment from before the move", () => {
    const r = pickReason(
      [c("2026-10-22T10:00:00Z", ASK), c("2026-10-22T10:00:05Z", "Review done.")],
      ["2026-10-22T10:00:10Z"],
    );
    expect(r?.text).toBe("decision: Read the post and say yes or no: is the voice yours?");
    expect(r?.at).toBe("2026-10-22T10:00:00Z");
  });

  it("ignores an Ask posted after the move", () => {
    const r = pickReason(
      [c("2026-10-22T10:00:00Z", "Blocked by situation#9."), c("2026-10-22T11:00:00Z", ASK)],
      ["2026-10-22T10:00:10Z"],
    );
    expect(r?.text).toBe("Blocked by situation#9.");
  });

  it("keeps today's reason when there is no Ask", () => {
    const r = pickReason([c("2026-10-22T10:00:00Z", "This cannot run without the key.")], ["2026-10-22T10:00:10Z"]);
    expect(r?.text).toBe("This cannot run without the key.");
  });
});
