import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reposToSave } from "@/lib/repos";

const stamp = (p: string) => {
  try {
    const s = fs.statSync(p);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "missing";
  }
};

const REAL_CONFIG = path.join(process.cwd(), "config.json");
const realBefore = stamp(REAL_CONFIG);

const envBefore = process.env.COLLECTOR_CONFIG;
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
  it("writes the chosen repos into projects, keeps every other key, and never touches the real config.json", () => {
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
    expect(JSON.parse(fs.readFileSync(TEST_CONFIG, "utf8"))).toEqual({
      ...before,
      projects: { "acme/a": {}, "acme/b": {} },
    });
    expect(stamp(REAL_CONFIG)).toBe(realBefore);
  });

  it("refuses a config.json that does not parse, naming the file, and leaves it byte for byte", () => {
    const broken = '{\n  "machines": [{ "name": "laptop" }],\n  "board": { "project_id": "PVT_example" },\n}\n';
    fs.writeFileSync(TEST_CONFIG, broken);
    expect(() => saveProjects(["acme/a"])).toThrow(TEST_CONFIG);
    expect(fs.readFileSync(TEST_CONFIG, "utf8")).toBe(broken);
  });

  it("refuses a config.json that is not an object", () => {
    fs.writeFileSync(TEST_CONFIG, '["acme/a"]\n');
    expect(() => saveProjects(["acme/b"])).toThrow(TEST_CONFIG);
    expect(fs.readFileSync(TEST_CONFIG, "utf8")).toBe('["acme/a"]\n');
  });

  it("answers the page's Save with a 409 whose why names the file, and writes nothing", async () => {
    const broken = '{ "machines": [], }\n';
    fs.writeFileSync(TEST_CONFIG, broken);
    const { POST } = await import("@/app/api/projects/route");

    const res = await POST(
      new Request("http://127.0.0.1:4000/api/projects", {
        method: "POST",
        headers: { host: "127.0.0.1:4000", "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ repos: ["acme/a"] }),
      }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).why).toContain(TEST_CONFIG);
    expect(fs.readFileSync(TEST_CONFIG, "utf8")).toBe(broken);
  });

  it("starts a config.json that is not there yet, and leaves no temp file beside it", () => {
    fs.rmSync(TEST_CONFIG, { force: true });

    expect(saveProjects(["acme/a"])).toEqual(["acme/a"]);
    expect(JSON.parse(fs.readFileSync(TEST_CONFIG, "utf8"))).toEqual({ projects: { "acme/a": {} } });
    expect(fs.readdirSync(dir)).toEqual(["config.json"]);
  });

  it("keeps the stage a repo already had, so choosing repos never drops one", () => {
    fs.writeFileSync(
      TEST_CONFIG,
      `${JSON.stringify({ projects: { "acme/a": { stage: "production" }, "acme/gone": { stage: "idea" } } }, null, 2)}\n`,
    );

    expect(saveProjects(["acme/a", "acme/b"])).toEqual(["acme/a", "acme/b"]);
    expect(JSON.parse(fs.readFileSync(TEST_CONFIG, "utf8")).projects).toEqual({
      "acme/a": { stage: "production" },
      "acme/b": {},
    });
  });
});
