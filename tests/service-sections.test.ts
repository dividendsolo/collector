import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ServicesPage, type Svc, serviceSections } from "@/components/services";
import { badConfigValues } from "@/lib/server/config";
import { check } from "@/lib/server/services";

const svc = (name: string, paid: boolean, status: Svc["status"] = "online", ms = 100): Svc => ({
  name,
  url: `https://${name.toLowerCase()}.example.com`,
  status,
  ms,
  error: null,
  hosting: null,
  paid,
});

const names = (list: Svc[]) => list.map((x) => x.name);

vi.mock("@/components/data", () => ({
  useApi: () => ({ data: (globalThis as { services?: Svc[] }).services }),
  useLive: () => ({ tick: () => {} }),
}));

const renderPage = (list: Svc[]) => {
  (globalThis as { services?: Svc[] }).services = list;
  return renderToStaticMarkup(createElement(ServicesPage));
};

describe("the Services page splits paid from non-paid (collector#263)", () => {
  it("draws a Paid section above a Non-paid one, not one flat list", () => {
    const html = renderPage([svc("Free", false), svc("Shop", true)]);
    expect(html).toContain("<h2>Paid</h2>");
    expect(html).toContain("<h2>Non-paid</h2>");
    expect(html.indexOf("<h2>Paid</h2>")).toBeLessThan(html.indexOf("Shop"));
    expect(html.indexOf("Shop")).toBeLessThan(html.indexOf("<h2>Non-paid</h2>"));
    expect(html.indexOf("<h2>Non-paid</h2>")).toBeLessThan(html.indexOf("Free"));
  });

  it("keeps the status sort inside each section", () => {
    const [paid, free] = serviceSections([
      svc("PaidUp", true, "online", 50),
      svc("FreeDown", false, "down", 10),
      svc("PaidDown", true, "down", 900),
      svc("PaidSlow", true, "slow", 4000),
      svc("FreeUp", false, "online", 80),
    ]);
    expect(paid.title).toBe("Paid");
    expect(names(paid.list)).toEqual(["PaidDown", "PaidSlow", "PaidUp"]);
    expect(free.title).toBe("Non-paid");
    expect(names(free.list)).toEqual(["FreeDown", "FreeUp"]);
  });

  it("leaves an empty section out, heading and all", () => {
    expect(serviceSections([svc("Free", false)]).map((s) => s.title)).toEqual(["Non-paid"]);
    expect(serviceSections([svc("Shop", true)]).map((s) => s.title)).toEqual(["Paid"]);
    const html = renderPage([svc("Free", false)]);
    expect(html).not.toContain("<h2>Paid</h2>");
    expect(html).toContain("<h2>Non-paid</h2>");
  });

  it("says once that there are no services when the list is empty", () => {
    const html = renderPage([]);
    expect(html).not.toContain("<h2>");
    expect(html.split("No services in config.json yet.").length - 1).toBe(1);
  });
});

describe("a service's paid flag in config.json", () => {
  it("reads a service with no flag as non-paid, on the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null)),
    );
    expect((await check({ name: "Site", url: "https://example.com" })).paid).toBe(false);
    expect((await check({ name: "Shop", url: "https://example.com", paid: true })).paid).toBe(true);
    vi.unstubAllGlobals();
  });

  it("refuses a paid flag that is not true or false", () => {
    expect(badConfigValues({ services: [{ name: "Shop", url: "https://example.com", paid: "yes" }] })).toEqual([
      'services[0] (Shop).paid "yes" is not true or false',
    ]);
    expect(badConfigValues({ services: [{ name: "Shop", url: "https://example.com", paid: false }] })).toEqual([]);
  });
});
