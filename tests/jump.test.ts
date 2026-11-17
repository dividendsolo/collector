import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jumpHref, jumpTargetOf, withoutJump } from "@/lib/jump";
import { checkToasts, githubToasts, serviceToasts } from "@/lib/toasts";

const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const src = (f: string) => readFileSync(path.join(process.cwd(), "components", f), "utf8");

function reducedMotionBlocks(source: string): string[] {
  const needle = "@media (prefers-reduced-motion: reduce)";
  const blocks: string[] = [];
  for (let at = source.indexOf(needle); at > -1; at = source.indexOf(needle, at + 1)) {
    let depth = 0;
    for (let i = source.indexOf("{", at); i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) {
        blocks.push(source.slice(at, i + 1));
        break;
      }
    }
  }
  return blocks;
}

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

describe("the jump flash under reduced motion", () => {
  it("flashes the target for every user", () => {
    expect(css).toMatch(/\.jump-flash,\s*\n?\s*tr\.jump-flash td \{\s*\n?\s*animation: jump-flash 1\.6s ease-out;/);
  });

  it("keeps the flash when a user asks for less motion, since it is colour and not movement", () => {
    const flash = reducedMotionBlocks(css).filter((b) => b.includes("jump-flash"));
    expect(flash.join("\n")).not.toMatch(/animation:\s*none/);
  });

  it("still drops the glide, which is the movement", () => {
    expect(reducedMotionBlocks(css).join("\n")).toMatch(/html \{\s*scroll-behavior:\s*auto;/);
    expect(src("jump.tsx")).toMatch(/behavior: still \? "auto" : "smooth"/);
  });
});
