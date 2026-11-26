import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ServiceHealthPanel, ServiceRows, type Svc } from "@/components/services";
import { type Checked, check, serviceLogLines } from "@/lib/server/services";

const EMPTY = "No services in config.json yet.";
const render = (svc: Svc[] | null) => renderToStaticMarkup(createElement(ServiceHealthPanel, { svc }));

describe("the services log (collector#94)", () => {
  const row = (status: Checked["status"], ms: number, error: string | null = null): Checked => ({
    name: "Site",
    url: "https://example.com/?key=secret",
    status,
    code: error ? null : 200,
    ms,
    error,
    checked_at: 1794300000,
    hosting: null,
    paid: false,
  });

  it("writes one stamped line per Slow or Down check, and none for an online one", () => {
    expect(
      serviceLogLines([row("online", 200), row("slow", 3640), row("down", 10001, "timed out after 10 s")]),
    ).toEqual([
      "[services] 2026-11-10T08:40:00.000Z Site slow 3640 ms",
      "[services] 2026-11-10T08:40:00.000Z Site down 10001 ms timed out after 10 s",
    ]);
    expect(serviceLogLines([row("slow", 3640)])[0]).not.toContain("secret");
  });
});

describe("Service health panel on the Dashboard", () => {
  it("says there are no services once, not in both the summary and the list", () => {
    expect(render([]).split(EMPTY).length - 1).toBe(1);
  });

  it("shows the summary and the rows when there are services", () => {
    const html = render([
      {
        name: "API",
        url: "https://api.example.com",
        status: "online",
        ms: 120,
        error: null,
        hosting: null,
        paid: false,
      },
      {
        name: "Site",
        url: "https://example.com",
        status: "down",
        ms: 900,
        error: "timeout",
        hosting: null,
        paid: false,
      },
    ]);
    expect(html).toContain("1 of 2");
    expect(html).toContain("slowest Site at 900 ms");
    expect(html).not.toContain(EMPTY);
  });
});

describe("a service row's hosting (collector#262)", () => {
  const svc = (hosting: string | null): Svc => ({
    name: "ZeroPhase",
    url: "https://zerophase.app",
    status: "online",
    ms: 120,
    error: null,
    hosting,
    paid: false,
  });
  const renderRows = (hosting: string | null) =>
    renderToStaticMarkup(createElement(ServiceRows, { list: [svc(hosting)] }));

  it("shows where the service is hosted, after its url", () => {
    const html = renderRows("Vercel");
    expect(html).toContain("Vercel");
    expect(html.indexOf("Vercel")).toBeGreaterThan(html.indexOf("zerophase.app"));
  });

  it("reads Self-hosted for a service that sends no platform header, the Projects panel's wording", () => {
    expect(renderRows(null)).toContain("Self-hosted");
  });

  it("reads the hosting off the response's own headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { headers: { "x-vercel-id": "fra1::abc" } })),
    );
    expect((await check({ name: "Site", url: "https://example.com" })).hosting).toBe("Vercel");
    vi.unstubAllGlobals();
  });
});
