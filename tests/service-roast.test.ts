import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceRows, type Svc } from "@/components/services";
import { roastLink, roastText } from "@/lib/roast";
import { latestRoast, readLatest } from "@/lib/server/roast";

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

  it("keeps no score after a failed read, and never throws into the health check", async () => {
    const fetch = vi.fn(async () => answer(500));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("PAGEROAST_ADMIN", "k3y");
    expect(latestRoast("https://down.example.com")).toBeNull();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(latestRoast("https://down.example.com")).toBeNull();
  });
});

describe("a service row's roast score (collector#185)", () => {
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

  it("shows nothing for a service with no roast yet", () => {
    for (const roast of [null, undefined]) {
      const html = render([svc(roast)]);
      expect(html).not.toContain("Roast");
      expect(html).not.toContain("pageroast");
    }
  });
});
