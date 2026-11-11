import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * James, 2026-11-11: "the call for the incidents takes longer than the other calls in the priority panel, is there a
 * better way to wait for it other than just filling in everything and then popping a new row on the top??" He picked
 * the saved read: the last vendor read is kept on disk, so the incident row is there from the first second after a
 * restart, and a fresh read replaces it in the background.
 *
 * And the bug found with it: the dashboard read the vendors through `lastVendors()`, which never asked for a fresh
 * read, so an incident stayed on Priority tasks after the vendor resolved it until a restart or a Vendors page visit.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendors-seen-"));
const file = path.join(dir, "vendors.json");
process.env.COLLECTOR_VENDORS_SEEN = file;

const incident = { name: "Project Lifecycle Issues", impact: "minor", url: "u", opened: "2026-11-11T16:44:20Z" };
const saved = { at: 1_794_400_000, vendors: [{ name: "Supabase", url: "u", state: "minor", incidents: [incident] }] };

describe("the vendor read", () => {
  it("serves the saved read at once after a restart, before any status page answers", async () => {
    fs.writeFileSync(file, JSON.stringify(saved));
    vi.resetModules();
    (globalThis as any)["__collector:swr:vendors"] = undefined;
    for (const k of Object.keys(globalThis)) if (k.startsWith("__collector:")) delete (globalThis as any)[k];
    const { lastVendors } = await import("@/lib/server/vendors");
    expect(lastVendors().map((v) => v.incidents.map((i) => i.name))).toEqual([["Project Lifecycle Issues"]]);
  });

  it("saves each fresh read to disk", async () => {
    const { saveVendors } = await import("@/lib/server/vendors");
    fs.rmSync(file, { force: true });
    saveVendors(saved as any);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(saved);
  });

  it("asks for a fresh read when the dashboard reads a stale one", async () => {
    const src = fs.readFileSync("lib/server/vendors.ts", "utf8");
    expect(src).toMatch(/export const lastVendors = \(\) => \{[^}]*vendors\(\)/s);
  });
});

describe("a seeded cache", () => {
  it("serves the seed at once and refreshes behind it", async () => {
    const { swr } = await import("@/lib/server/cache");
    let calls = 0;
    const c = swr(
      `seeded-${Math.random()}`,
      1000,
      async () => ++calls,
      () => 0,
    );
    expect(await c.get({ key: "k" })).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
    expect(await c.get({ key: "k" })).toBe(1);
  });
});
