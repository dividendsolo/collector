import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The rebuild job builds into `.next-rebuild` while the page serves `.next`. Its type check must not read the served
 * build's generated types: those were made from an older commit and can name a route that is gone since. On
 * 2026-11-09 the served `.next/types/validator.ts` still named `app/api/network/seen/route.ts` (removed in #76), every
 * rebuild failed on it, and the old build was never replaced.
 */
const ROOT = process.cwd();

async function configWith(dist: string | undefined) {
  const before = process.env.COLLECTOR_DIST_DIR;
  if (dist === undefined) delete process.env.COLLECTOR_DIST_DIR;
  else process.env.COLLECTOR_DIST_DIR = dist;
  try {
    vi.resetModules();
    const mod = await import("../next.config");
    return mod.default;
  } finally {
    if (before === undefined) delete process.env.COLLECTOR_DIST_DIR;
    else process.env.COLLECTOR_DIST_DIR = before;
  }
}

function includes(tsconfigFile: string): string[] {
  const own = JSON.parse(fs.readFileSync(path.join(ROOT, tsconfigFile), "utf8"));
  return own.include ?? [];
}

describe("the rebuild's type check (Needs attention: collector-rebuild exit 1)", () => {
  it("reads only its own build's generated types, never the served .next", async () => {
    const config = await configWith(".next-rebuild");
    const file = config.typescript?.tsconfigPath ?? "tsconfig.json";
    const list = includes(file);
    expect(list.some((p) => p.startsWith(".next/"))).toBe(false);
    expect(list).toContain(".next-rebuild/types/**/*.ts");
  });

  it("a normal build and dev keep the usual tsconfig", async () => {
    const config = await configWith(undefined);
    expect(config.typescript?.tsconfigPath ?? "tsconfig.json").toBe("tsconfig.json");
  });
});
