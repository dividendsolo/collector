import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRows, type Svc } from "@/components/services";
import { type Roast, roastLink, roastText } from "@/lib/roast";
import { latestRoast, ROAST_RETRY_MS, ROAST_TTL_MS, readLatest } from "@/lib/server/roast";

const BASE = "https://pageroast.dividendsolo.com";
const ROAST = { id: "abc123", score: 72, created: Date.UTC(2026, 10, 16, 15) };

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the PageRoast admin read (collector#185)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks for the newest roast of the url with the admin header, and reads its id, score and date", async () => {
    const fetch = vi.fn(async () => answer(200, ROAST));
    vi.stubGlobal("fetch", fetch);
    expect(await readLatest(BASE, "k3y", "https://zerophase.app/")).toEqual(ROAST);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/latest?url=${encodeURIComponent("https://zerophase.app/")}`);
    expect((init.headers as Record<string, string>)["x-admin"]).toBe("k3y");
  });

  it("reads a 404 as no roast yet, not as a score of 0 or an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(404, { error: "not found" })),
    );
    expect(await readLatest(BASE, "k3y", "https://example.com")).toBeNull();
  });

  it("reads an answer that is not { id, score, created } as no roast", async () => {
    for (const body of [{ id: "x", score: "72", created: 1 }, { id: "../x", score: 72, created: 1 }, { score: 72 }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => answer(200, body)),
      );
      expect(await readLatest(BASE, "k3y", "https://example.com")).toBeNull();
    }
  });

  it("throws on a refusal, so the cache keeps the last good score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(401)),
    );
    await expect(readLatest(BASE, "k3y", "https://example.com")).rejects.toThrow("401");
  });

  it("makes no call at all without the admin key", () => {
    const fetch = vi.fn(async () => answer(200, ROAST));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("PAGEROAST_ADMIN", "");
    expect(latestRoast("https://nokey.example.com")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never holds the health check: the first check answers no score and starts the read", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    vi.stubEnv("PAGEROAST_ADMIN", "k3y");
    expect(latestRoast("https://hung.example.com")).toBeNull();
  });

  it("reads each service once a day, not on every health check", async () => {
    const fetch = vi.fn(async () => answer(200, ROAST));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("PAGEROAST_ADMIN", "k3y");
    latestRoast("https://once.example.com");
    await vi.waitFor(() => expect(latestRoast("https://once.example.com")).toEqual(ROAST));
    expect(latestRoast("https://once.example.com")).toEqual(ROAST);
    expect(fetch).toHaveBeenCalledTimes(1);
    latestRoast("https://other.example.com");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  const checks = async (url: string, n: number) => {
    const seen: (Roast | null)[] = [];
    for (let i = 0; i < n; i++) {
      seen.push(latestRoast(url));
      await new Promise((r) => setTimeout(r, 0));
    }
    return seen;
  };

  for (const status of [401, 500]) {
    it(`sends one read per back-off window after a ${status}, never one per health check`, async () => {
      const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const fetch = vi.fn(async () => answer(status));
      vi.stubGlobal("fetch", fetch);
      vi.stubEnv("PAGEROAST_ADMIN", "k3y");
      const url = `https://refused-${status}.example.com`;
      expect(await checks(url, 20)).toEqual(Array(20).fill(null));
      expect(fetch).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_000_000 + ROAST_RETRY_MS - 1);
      await checks(url, 20);
      expect(fetch).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_000_000 + ROAST_RETRY_MS + 1);
      await checks(url, 20);
      expect(fetch).toHaveBeenCalledTimes(2);
      now.mockRestore();
    });
  }

  it("keeps the last good score through a failed read, and never throws into the health check", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(5_000_000);
    const fetch = vi.fn(async () => answer(200, ROAST));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("PAGEROAST_ADMIN", "k3y");
    const url = "https://flaky.example.com";
    await checks(url, 2);
    expect(latestRoast(url)).toEqual(ROAST);
    fetch.mockImplementation(async () => answer(500));
    now.mockReturnValue(5_000_000 + ROAST_TTL_MS + 1);
    expect(await checks(url, 20)).toEqual(Array(20).fill(ROAST));
    expect(fetch).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});

describe("a service row's roast score (collector#185)", () => {
  beforeEach(() => {
    vi.stubEnv("TZ", "America/New_York");
  });
  afterEach(() => vi.unstubAllEnvs());

  const svc = (roast: Svc["roast"]): Svc => ({
    name: "ZeroPhase",
    url: "https://zerophase.app",
    status: "online",
    ms: 120,
    error: null,
    hosting: null,
    roast,
  });
  const render = (list: Svc[]) => renderToStaticMarkup(createElement(ServiceRows, { list }));

  it("links the score and the roast date to the roast report", () => {
    expect(roastLink(ROAST.id)).toBe("https://pageroast.dividendsolo.com/r/abc123");
    expect(roastText(ROAST, "America/New_York")).toBe("Roast 72 · Nov 16");
    const html = render([svc(ROAST)]);
    expect(html).toContain('href="https://pageroast.dividendsolo.com/r/abc123"');
    expect(html).toContain("Roast 72");
  });

  it("keeps the score and the date on one line, so a narrow row breaks only before the roast", () => {
    expect(render([svc(ROAST)])).toMatch(/<a class="roast" href="https:\/\/pageroast\.dividendsolo\.com\/r\/abc123"/);
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
    const rule = css.match(/\.health \.sub a\.roast\s*\{([^}]*)\}/);
    expect(rule?.[1]).toContain("white-space: nowrap");
  });

  it("shows nothing for a service with no roast yet", () => {
    for (const roast of [null, undefined]) {
      const html = render([svc(roast)]);
      expect(html).not.toContain("Roast");
      expect(html).not.toContain("pageroast");
    }
  });
});
