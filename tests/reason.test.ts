import { describe, expect, it } from "vitest";
import { pickReason } from "@/lib/server/text";

const c = (createdAt: string, body: string) => ({ createdAt, url: `https://x/${createdAt}`, body });
const ASK = "**Ask (decision):** Read the post and say yes or no: is the voice yours?\n\n> *Posted by lane set.*";
const NEW_ASK = "**Ask (account):** Warm up the HN account dividend_solo with a few real comments.";

describe("pickReason", () => {
  it("shows the Ask line, with its kind, over a later plain comment from before the move", () => {
    const r = pickReason(
      [c("2026-10-22T10:00:00Z", ASK), c("2026-10-22T10:00:05Z", "Review done.")],
      ["2026-10-22T10:00:10Z"],
    );
    expect(r?.text).toBe("decision: Read the post and say yes or no: is the voice yours?");
    expect(r?.at).toBe("2026-10-22T10:00:00Z");
  });

  it("shows a new Ask posted while the card already waits, over the one that moved it in", () => {
    const r = pickReason(
      [c("2026-11-12T22:54:05Z", ASK), c("2026-11-13T16:50:00Z", NEW_ASK)],
      ["2026-11-12T22:54:06Z"],
    );
    expect(r?.text).toBe("account: Warm up the HN account dividend_solo with a few real comments.");
    expect(r?.at).toBe("2026-11-13T16:50:00Z");
  });

  it("shows the newest Ask, so an Ask from an earlier stay in the lane does not come back", () => {
    // agent-stack#392: the Ask of its stay on 2026-11-12, and the Ask that moved it back into the lane on 2026-11-13.
    const r = pickReason(
      [c("2026-11-12T22:54:05Z", ASK), c("2026-11-13T17:41:59Z", NEW_ASK)],
      ["2026-11-12T18:34:11Z", "2026-11-12T22:54:05Z", "2026-11-13T17:42:55Z"],
    );
    expect(r?.text).toBe("account: Warm up the HN account dividend_solo with a few real comments.");
    expect(r?.at).toBe("2026-11-13T17:41:59Z");
  });

  it("keeps today's reason when there is no Ask", () => {
    const r = pickReason([c("2026-10-22T10:00:00Z", "This cannot run without the key.")], ["2026-10-22T10:00:10Z"]);
    expect(r?.text).toBe("This cannot run without the key.");
  });
});
