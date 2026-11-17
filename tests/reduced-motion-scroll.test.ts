import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = path.resolve(__dirname, "../components");

const scrollCalls = () =>
  readdirSync(COMPONENTS)
    .filter((f) => f.endsWith(".tsx"))
    .flatMap((f) => {
      const src = readFileSync(path.join(COMPONENTS, f), "utf8");
      return [...src.matchAll(/scrollIntoView\(\{[^}]*\}\)/g)].map((m) => ({ file: f, call: m[0] }));
    });

describe("a scroll glides only when motion is allowed", () => {
  it("finds the scroll calls it checks, the flow tap among them", () => {
    expect(scrollCalls().some((c) => c.file === "flow.tsx")).toBe(true);
  });
  it("asks for smooth scrolling only behind the reduced-motion flag", () => {
    const glides = scrollCalls().filter((c) => c.call.includes('"smooth"'));
    expect(glides.filter((c) => !/still \? "auto" : "smooth"/.test(c.call))).toEqual([]);
  });
});
