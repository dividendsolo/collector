import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countDeploys } from "@/lib/server/workstats";

/**
 * James, 2026-11-11: "it should be reading those". The Work panel counted deploys from GitHub only, so a Kamal app
 * that ezio deploys itself (pull-deploy) showed none. collect.py now reads pull-deploy's state file, and a commit
 * deployed both ways (zero-phase: Vercel and Kamal) counts once.
 */
const read = (state: unknown) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-pull-deploy-"));
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state));
  const code = `import json,sys; sys.path.insert(0, ${JSON.stringify(process.cwd())}); import collect; print(json.dumps(collect.pull_deploys(${JSON.stringify(path.join(dir, "state.json"))})))`;
  return JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8" }));
};

describe("collect.py's pull-deploy reader", () => {
  it("lists every deploy in the history with its repo", () => {
    expect(
      read({
        apps: { situation: { sha: "b", at: "2026-11-11T20:00:00Z", how: "deploy" } },
        history: [
          { app: "situation", sha: "a", at: "2026-11-11T03:12:37Z" },
          { app: "situation", sha: "b", at: "2026-11-11T20:00:00Z" },
        ],
      }),
    ).toEqual([
      { app: "situation", sha: "a", at: "2026-11-11T03:12:37Z" },
      { app: "situation", sha: "b", at: "2026-11-11T20:00:00Z" },
    ]);
  });

  it("falls back to each app's last deploy when there is no history yet", () => {
    expect(
      read({
        apps: {
          pageroast: { sha: "p", at: "2026-11-11T15:41:01Z", how: "deploy" },
          abide: { sha: "q", at: "2026-11-09T16:53:50Z", how: "found" },
        },
      }),
    ).toEqual([{ app: "pageroast", sha: "p", at: "2026-11-11T15:41:01Z" }]);
  });

  it("reads no file as no deploys", () => {
    const code = `import json,sys; sys.path.insert(0, ${JSON.stringify(process.cwd())}); import collect; print(json.dumps(collect.pull_deploys("/nonexistent/state.json")))`;
    expect(JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8" }))).toEqual([]);
  });
});

describe("deploys today", () => {
  const since = "2026-11-11T05:00:00Z";
  it("adds ezio's Kamal deploys to GitHub's, a commit once per repo", () => {
    const github = { "dividendsolo/zero-phase": ["z1", "z2"] };
    const kamal = [
      { app: "zero-phase", sha: "z2", at: "2026-11-11T19:07:35Z" },
      { app: "situation", sha: "s1", at: "2026-11-11T20:00:00Z" },
      { app: "situation", sha: "s0", at: "2026-11-11T03:12:37Z" },
    ];
    expect(countDeploys(["dividendsolo/situation", "dividendsolo/zero-phase"], github, kamal, since)).toEqual([
      { repo: "zero-phase", n: 2 },
      { repo: "situation", n: 1 },
    ]);
  });

  it("counts a Kamal app that is not in the project list", () => {
    expect(countDeploys([], {}, [{ app: "pageroast", sha: "p", at: "2026-11-11T15:41:01Z" }], since)).toEqual([
      { repo: "pageroast", n: 1 },
    ]);
  });
});
