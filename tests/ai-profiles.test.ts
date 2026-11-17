import { describe, expect, it } from "vitest";
import { profilesByProvider } from "@/lib/server/ai";

describe("profilesByProvider", () => {
  it("counts a profile on two machines once", () => {
    const machines = [
      {
        name: "altair",
        profiles: [
          { name: "darndest-builder", provider: "anthropic" },
          { name: "waiting-crew", provider: "claude-sdk" },
        ],
      },
      { name: "ezio", profiles: [{ name: "darndest-builder", provider: "anthropic" }] },
    ];
    expect(Object.fromEntries(profilesByProvider(machines))).toEqual({ anthropic: 2 });
  });

  it("still counts a fallback provider, once per name, and sorts the most used first", () => {
    const machines = [
      {
        name: "altair",
        profiles: [
          { name: "a", provider: "anthropic", fallbacks: ["kimi"] },
          { name: "b", provider: "kimi" },
        ],
      },
      { name: "ezio", profiles: [{ name: "a", provider: "anthropic", fallbacks: ["kimi"] }] },
    ];
    expect(profilesByProvider(machines)).toEqual([
      ["kimi", 2],
      ["anthropic", 1],
    ]);
  });
});
