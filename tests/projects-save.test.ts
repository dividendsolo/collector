import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reposToSave } from "@/lib/repos";

/** size:mtime, or "missing": a file that never existed and one left alone read the same twice. */
const stamp = (p: string) => {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "missing";
  }
};

/** The file saveProjects would write with COLLECTOR_CONFIG unset. Gitignored, holds the real projects: never touched. */
const REAL_CONFIG = path.join(process.cwd(), "config.json");
const realBefore = stamp(REAL_CONFIG);

const envBefore = process.env.COLLECTOR_CONFIG;
/** A temp config, pointed at before the module that resolves the path at import time (lib/server/paths.ts) loads:
 * COLLECTOR_CONFIG is read once, so setting it after a static import is too late (AGENTS.md, Dangers). */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-save-"));
const TEST_CONFIG = path.join(dir, "config.json");
process.env.COLLECTOR_CONFIG = TEST_CONFIG;

let saveProjects: typeof import("@/lib/server/projects").saveProjects;

beforeAll(async () => {
  saveProjects = (await import("@/lib/server/projects")).saveProjects;
});

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reposToSave", () => {
  it("keeps a chosen repo the list on screen no longer shows, A to Z by repo name", () => {
    // acme/gone is chosen but missing from the cached list: the 2026-10-21 drop. The choice wins.
    expect(reposToSave(["acme/zulu", "acme/gone", "acme/alpha", "acme/delta"])).toEqual([
      "acme/alpha",
      "acme/delta",
      "acme/gone",
      "acme/zulu",
    ]);
  });
  it("reads a Set, and sorts by repo name, not by owner", () => {
    expect(reposToSave(new Set(["zed/alpha", "acme/zulu"]))).toEqual(["zed/alpha", "acme/zulu"]);
  });
  it("saves nothing when nothing is chosen", () => {
    expect(reposToSave([])).toEqual([]);
  });
});

describe("saveProjects", () => {
  it("writes owner/repo strings into projects, keeps every other key, and never touches the real config.json", () => {
    const before = {
      machines: [{ name: "laptop" }],
      projects: ["old/one"],
      actions_minutes: 3000,
      board: { project_id: "PVT_example", lanes: {}, priorities: {} },
      agent_notes: { collector: "keep me" },
    };
    fs.writeFileSync(TEST_CONFIG, `${JSON.stringify(before, null, 2)}\n`);

    expect(saveProjects(["acme/a", "bad", 3, "acme/b"])).toEqual(["acme/a", "acme/b"]);

    expect(TEST_CONFIG).not.toBe(REAL_CONFIG);
    expect(JSON.parse(fs.readFileSync(TEST_CONFIG, "utf8"))).toEqual({ ...before, projects: ["acme/a", "acme/b"] });
    expect(stamp(REAL_CONFIG)).toBe(realBefore);
  });
});
