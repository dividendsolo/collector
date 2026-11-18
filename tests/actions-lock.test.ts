import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS = path.join(process.cwd(), ".github", "workflows");
const LOCKFILE = path.join(WORKFLOWS, "actions.lock");

const workflowNames = () =>
  fs
    .readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
    .sort();

const read = (name: string) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

const usesIn = (src: string) =>
  src.split("\n").flatMap((line) => {
    const m = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/);
    return m && !m[1].startsWith("./") ? [m[1]] : [];
  });

const lockedFor = (name: string) => {
  const lines = fs.readFileSync(LOCKFILE, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === `'.github/workflows/${name}':`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = line.match(/^\s+-\s+'([^']+)'\s*$/);
    if (!item) break;
    out.push(item[1]);
  }
  return out;
};

const pinned = () => {
  const block = fs.readFileSync(LOCKFILE, "utf8").split(/^dependencies:\s*$/m)[1] ?? "";
  const out = new Map<string, string>();
  for (const chunk of block.split(/^ {4}'/m).slice(1)) {
    const key = chunk.slice(0, chunk.indexOf("'"));
    const commit = chunk.match(/commit:\s*'sha1-([0-9a-f]{40})'/);
    if (commit) out.set(key, commit[1]);
  }
  return out;
};

describe("the workflows in this repo", () => {
  it("pins every action they use to a commit in actions.lock", () => {
    const names = workflowNames();
    expect(names).toContain("ci.yml");
    for (const name of names) {
      for (const use of usesIn(read(name))) {
        expect(lockedFor(name), `${name} uses ${use}, which actions.lock does not list`).toContain(use);
        expect(pinned().get(use), `${use} has no commit in actions.lock`).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });
});

describe("ci.yml", () => {
  const lineOf = (re: RegExp) =>
    read("ci.yml")
      .split("\n")
      .findIndex((l) => re.test(l));

  it("checks the lockfile, and only after the step that puts the code on the runner", () => {
    const checkout = lineOf(/^\s*(?:-\s+)?uses:\s*['"]?actions\/checkout@/);
    const verify = lineOf(/^\s+gh actions-lock --verify\s*$/);
    expect(checkout, "ci.yml has no actions/checkout step").toBeGreaterThan(-1);
    expect(verify, "ci.yml does not run `gh actions-lock --verify`").toBeGreaterThan(checkout);
  });

  it("installs the extension at one release tag, never at latest", () => {
    expect(read("ci.yml")).toMatch(/gh extension install github\/gh-actions-lock --pin v\d+\.\d+\.\d+/);
  });
});
