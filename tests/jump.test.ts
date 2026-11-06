import { describe, expect, it } from "vitest";
import { jumpHref, jumpTargetOf, withoutJump } from "@/lib/jump";
import { checkToasts, githubToasts, serviceToasts } from "@/lib/toasts";

/**
 * Every toast links to its page and the element on it (James, 2026-11-06: "they need to go to the page that it's
 * on, and it needs to scroll down to the section ... consistent throughout all the toast notifications").
 */
describe("the toast links", () => {
  it("names the page and the element id, and reads the id back", () => {
    const href = jumpHref("network", "check:vps:ssh");
    expect(href).toBe("#/network?to=check%3Avps%3Assh");
    expect(jumpTargetOf(href)).toBe("check:vps:ssh");
    expect(jumpTargetOf("#/network")).toBeNull();
  });
  it("takes the target off the address and keeps the rest of the query", () => {
    expect(withoutJump("#/network?to=x")).toBe("#/network");
    expect(withoutJump("#/network?a=1&to=x")).toBe("#/network?a=1");
    expect(withoutJump("#/network")).toBe("#/network");
  });
  it("gives every kind of toast a link with a target", () => {
    const all = [
      ...serviceToasts([{ name: "S", url: "https://s.example.com", status: "down", error: "502" }]),
      ...checkToasts([
        {
          name: "vps",
          checks: [
            { id: "check:vps:ssh", label: "SSH", value: "on", level: "red", about: "", facts: [] },
            { id: "check:vps:internet", label: "Ports", value: "22", level: "red", about: "", facts: [] },
          ] as never,
        },
      ]),
      ...githubToasts({ core: { used: 5000, limit: 5000, reset: 0 } }, () => "t"),
    ];
    expect(all.map((t) => jumpTargetOf(t.href))).toEqual([
      "service:https://s.example.com",
      "check:vps:ssh",
      "ports:vps:internet",
      "github-limit",
    ]);
  });
});
