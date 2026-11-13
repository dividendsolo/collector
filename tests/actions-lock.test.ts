import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every GitHub Action a workflow runs is pinned to a commit (collector#144).
 *
 * `uses: actions/checkout@v5` follows a tag, and a tag is a mutable pointer: whoever can move it runs their
 * own code on the runner with the whole job's token — which is what the week of 2026-11-13 did to more than
 * 1,800 repositories. `gh actions-lock` (github/gh-actions-lock) narrows a partial ref to its highest full
 * semver tag and writes `.github/workflows/actions.lock`, the commit each one resolves to. The runner checks
 * that lockfile at job start, and `ci.yml` runs `gh actions-lock --verify` right after its checkout step, so
 * a `uses:` the lockfile does not cover fails the CI run.
 *
 * This test is the same rule on this machine, where a new `uses:` costs no CI run to catch: it reads the
 * workflows and the lockfile the way `tests/request-guard.test.ts` reads every route file, so an action a
 * workflow adds or changes has to be pinned on purpose. `--verify` in CI stays the enforcement.
 */

const WORKFLOWS = path.join(process.cwd(), ".github", "workflows");
const LOCKFILE = path.join(WORKFLOWS, "actions.lock");

/** Every workflow in the repo, by name, A to Z: a new one is covered without an edit here. */
const workflowNames = () =>
  fs
    .readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"))
    .sort();

const read = (name: string) => fs.readFileSync(path.join(WORKFLOWS, name), "utf8");

/**
 * Every `uses:` a workflow runs, as `owner/repo@ref`. A commented-out line is not one, and a local action
 * (`./.github/actions/...`) is this repo's own code, so it needs no pin.
 */
const usesIn = (src: string) =>
  src.split("\n").flatMap((line) => {
    const m = line.match(/^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/);
    return m && !m[1].startsWith("./") ? [m[1]] : [];
  });

/** The action refs the lockfile lists under one workflow's own path. */
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

/** The commit each action ref resolves to, from the lockfile's `dependencies:` block. */
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
    // One job, so the line order is the step order: until the checkout runs, the workspace has no
    // `.github/workflows/` and `--verify` exits 2 ("no workflow files found") on every run.
    const checkout = lineOf(/^\s*(?:-\s+)?uses:\s*['"]?actions\/checkout@/);
    const verify = lineOf(/^\s+gh actions-lock --verify\s*$/);
    expect(checkout, "ci.yml has no actions/checkout step").toBeGreaterThan(-1);
    expect(verify, "ci.yml does not run `gh actions-lock --verify`").toBeGreaterThan(checkout);
  });

  it("installs the extension at one release tag, never at latest", () => {
    // An unpinned install would put a mutable third-party binary on every runner, which is the thing this
    // lock exists to remove.
    expect(read("ci.yml")).toMatch(/gh extension install github\/gh-actions-lock --pin v\d+\.\d+\.\d+/);
  });
});
