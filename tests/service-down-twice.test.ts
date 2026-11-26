import { describe, expect, it } from "vitest";
import { type Checked, confirmDown } from "@/lib/server/services";

const row = (status: Checked["status"], error: string | null = null): Checked => ({
  name: "Abide",
  url: "https://abide.dividendsolo.com",
  status,
  code: error ? null : 200,
  ms: error ? 10001 : 200,
  error,
  checked_at: 1794426137,
  hosting: null,
  paid: false,
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
