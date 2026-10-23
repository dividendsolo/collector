import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIG_KEYS, unknownConfigKeys } from "@/lib/server/config";
import { warnings } from "@/lib/server/warnings";

/** A file in the repo, read as text: these are the artifacts a new user copies or pastes. */
const file = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const sorted = (keys: readonly string[]) => [...keys].sort();

describe("unknownConfigKeys", () => {
  it("names a key Collector never reads, and passes a config of keys it does", () => {
    expect(unknownConfigKeys({ machines: [], machines_: [] })).toEqual(["machines_"]);
    expect(unknownConfigKeys(Object.fromEntries(CONFIG_KEYS.map((k) => [k, null])))).toEqual([]);
  });
  it("passes anything that is not a JSON object, and an empty config", () => {
    expect(unknownConfigKeys({})).toEqual([]);
    expect(unknownConfigKeys(null)).toEqual([]);
    expect(unknownConfigKeys("machines")).toEqual([]);
    expect(unknownConfigKeys([{ machines: [] }])).toEqual([]);
  });
});

describe("config.example.json", () => {
  it("holds only keys Collector reads, so copying it as it stands is safe", () => {
    expect(unknownConfigKeys(JSON.parse(file("config.example.json")))).toEqual([]);
  });
});

describe("README", () => {
  it("documents exactly the keys Collector reads in its Configure it table", () => {
    // Row keys only: the table's one `.env` line (X_BEARER_TOKEN) is not a config.json key.
    const table = file("README.md").split("## Configure it")[1].split("\n## ")[0];
    const documented = [...table.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]);
    expect(sorted(documented)).toEqual(sorted(CONFIG_KEYS));
  });
  it("points a new user at SETUP.md before hand editing", () => {
    const readme = file("README.md");
    const runIt = readme.split("## Run it")[1].split("\n## ")[0];
    expect(runIt).toContain("SETUP.md");
    expect(runIt).toContain("config.example.json");
  });
});

describe("SETUP.md", () => {
  const setup = file("SETUP.md");
  const prompt = [...setup.matchAll(/^```text\n([\s\S]*?)^```$/gm)].map((m) => m[1]);

  it("holds one fenced prompt, pasted as it stands", () => {
    expect(prompt).toHaveLength(1);
    expect(prompt[0].trim().length).toBeGreaterThan(600);
  });
  it("names every key Collector reads and checks what it wrote", () => {
    for (const key of CONFIG_KEYS) expect(prompt[0]).toContain(key);
    expect(prompt[0]).toContain("bun run check:config");
  });
  it("writes config.json alone, and no secret into it", () => {
    expect(prompt[0]).toContain("config.json");
    expect(prompt[0]).toMatch(/only file you may (create|write)/i);
    expect(prompt[0]).toMatch(/never (put|write)[^\n]*secret/i);
    expect(setup).toContain("bun run check:config");
  });
  it("starts Collector and reports what it found and skipped", () => {
    expect(prompt[0]).toMatch(/bun start|COLLECTOR_PORT/);
    expect(prompt[0]).toMatch(/skipped/i);
  });
});

describe("Needs attention", () => {
  it("names a config.json key Collector does not read, so a typo is not silent", () => {
    const w = warnings({
      machines: [],
      github: {},
      cfg: { machines: [{ name: "laptop" }], machines_: [] },
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([{ level: "warn", text: "config.json has a key Collector does not read: machines_" }]);
  });
  it("says nothing about a config of keys Collector reads", () => {
    const w = warnings({
      machines: [],
      github: {},
      cfg: Object.fromEntries(CONFIG_KEYS.map((k) => [k, null])) as never,
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([]);
  });
});
