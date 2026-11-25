import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(process.cwd(), "tests");
const needle = new RegExp("echo" + "[-_ ]?form", "i");

const walk = (root: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
};

describe("the retired-app removal (collector#256)", () => {
  it("leaves no fixture in tests/ naming the retired app", () => {
    const offenders = walk(dir).filter((file) => needle.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
