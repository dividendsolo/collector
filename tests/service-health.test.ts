import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceHealthPanel, type Svc } from "@/components/services";

const EMPTY = "No services in config.json yet.";
const render = (svc: Svc[] | null) => renderToStaticMarkup(createElement(ServiceHealthPanel, { svc }));

describe("Service health panel on the Dashboard", () => {
  it("says there are no services once, not in both the summary and the list", () => {
    expect(render([]).split(EMPTY).length - 1).toBe(1);
  });

  it("shows the summary and the rows when there are services", () => {
    const html = render([
      { name: "API", url: "https://api.example.com", status: "online", ms: 120, error: null, hosting: null },
      { name: "Site", url: "https://example.com", status: "down", ms: 900, error: "timeout", hosting: null },
    ]);
    expect(html).toContain("1 of 2");
    expect(html).toContain("slowest Site at 900 ms");
    expect(html).not.toContain(EMPTY);
  });
});
