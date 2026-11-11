import { describe, expect, it } from "vitest";
import { type Checked, confirmDown } from "@/lib/server/services";

/**
 * James, 2026-11-11, on a screenshot of "Abide is down: HTTP 520" and "Dividend Solo is down: timed out": "this has
 * happened a few times today, can you investigate". Both sites were up: at 19:42 UTC four sites behind Cloudflare
 * failed in the same second from the Mac (Abide on ezio, Dividend Solo on Vercel), and ezio's proxy saw no request.
 * A one-check blip on the way out is not an outage. A site shows Down only when two checks in a row fail; the first
 * failure shows as Slow with its error, and every failure is still logged.
 */
const row = (status: Checked["status"], error: string | null = null): Checked => ({
  name: "Abide",
  url: "https://abide.dividendsolo.com",
  status,
  code: error ? null : 200,
  ms: error ? 10001 : 200,
  error,
  checked_at: 1794426137,
  hosting: null,
});

describe("a site's Down", () => {
  it("waits for a second failed check in a row", () => {
    const first = confirmDown([row("down", "HTTP 520")], []);
    expect(first[0].status).toBe("slow");
    expect(first[0].error).toBe("HTTP 520");
    const second = confirmDown([row("down", "timed out")], first);
    expect(second[0].status).toBe("down");
  });

  it("starts over after a good check", () => {
    const blip = confirmDown([row("down", "HTTP 520")], []);
    const ok = confirmDown([row("online")], blip);
    expect(confirmDown([row("down", "HTTP 520")], ok)[0].status).toBe("slow");
  });

  it("stays Down while it keeps failing", () => {
    let list = confirmDown([row("down", "x")], []);
    for (let i = 0; i < 3; i++) list = confirmDown([row("down", "x")], list);
    expect(list[0].status).toBe("down");
  });

  it("keeps the check's own result for the log", () => {
    const first = confirmDown([row("down", "HTTP 520")], []);
    expect(first[0].checked).toBe("down");
  });
});
