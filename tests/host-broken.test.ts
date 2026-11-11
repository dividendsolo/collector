import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * collect.py's host-broken reader on a machine (James, 2026-11-11: "It's not a great error. It doesn't give me a
 * lot of detail"). The row named only the step and a SHA. The reader now adds the first error line of the foreman's
 * base-gate log beside the marker, run through the real Python with the files pageroast left on ezio.
 */
const read = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-host-broken-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const code = `import json,sys; sys.path.insert(0, ${JSON.stringify(process.cwd())}); import collect; print(json.dumps(collect.host_broken(${JSON.stringify(dir)})))`;
  return JSON.parse(execFileSync("python3", ["-c", code], { encoding: "utf8" }));
};

const LOG = `TAP version 13
# node:internal/modules/cjs/loader:1433
#   throw err;
#   ^
# Error: Cannot find module '/home/div/code/pageroast/.worktrees/base-37f16da67b6a/test'
#     at Function._resolveFilename (node:internal/modules/cjs/loader:1430:15)
not ok 1 - test
`;

describe("collect.py's host-broken reader", () => {
  it("adds the first error line of the base-gate log", () => {
    expect(read({ "host-broken-pageroast": "ci: base 37f16da\n", "base-gate-pageroast.log": LOG })).toEqual([
      {
        repo: "pageroast",
        line: "ci: base 37f16da",
        error: "Error: Cannot find module '/home/div/code/pageroast/.worktrees/base-37f16da67b6a/test'",
      },
    ]);
  });

  it("leaves the error empty when there is no log", () => {
    expect(read({ "host-broken-zero-phase": "preflight: missing bun\n" })).toEqual([
      { repo: "zero-phase", line: "preflight: missing bun", error: "" },
    ]);
  });
});
