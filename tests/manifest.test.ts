import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("Collector added to a phone's home screen (collector#232)", () => {
  it("links a manifest from the layout", () => {
    expect(read("app/layout.tsx")).toMatch(/manifest:\s*"\/manifest\.webmanifest"/);
  });

  it("names it, gives it a 192 and a 512 icon, and opens full screen", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.name).toBe("Collector");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("ships both icons as PNGs of exactly those sizes", () => {
    const pairs: [string, number][] = [
      ["public/icons/icon-192.png", 192],
      ["public/icons/icon-512.png", 512],
    ];
    for (const [file, size] of pairs) {
      const b = fs.readFileSync(path.join(process.cwd(), file));
      expect(b.subarray(0, 8), file).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      expect(b.readUInt32BE(16), file).toBe(size);
      expect(b.readUInt32BE(20), file).toBe(size);
    }
  });
});
