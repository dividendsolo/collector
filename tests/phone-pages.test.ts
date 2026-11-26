import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SideProvider } from "@/components/side";

const api = vi.hoisted(() => ({ data: {} as Record<string, any> }));

vi.mock("@/components/data", async () => {
  const actual = await vi.importActual<typeof import("@/components/data")>("@/components/data");
  return {
    ...actual,
    useApi: (key: string) => ({ data: api.data[key], mutate: async () => {} }),
  };
});

const { ProjectsPage } = await import("@/components/projects");
const { ProposalsPage } = await import("@/components/pages");

api.data = {
  "/api/projects": {
    at: 0,
    projects: [
      {
        repo: "dividendsolo/situation",
        name: "situation",
        title: "Situation",
        url: "",
        live: "https://situation.example",
      },
    ],
  },
  "/api/services": [],
  "/api/proposals": {
    proposals: [
      {
        id: "p1",
        client: "Acme",
        title: "Site rebuild",
        amount: 1000,
        currency: "USD",
        status: "pending",
        sent_at: null,
        decided_at: null,
        notes: "",
      },
    ],
    pipeline: [],
  },
};

const draw = (page: () => any, side: "mac" | "phone") =>
  renderToStaticMarkup(createElement(SideProvider, { side }, createElement(page)));

describe("the Projects page", () => {
  it("draws Choose repos on the Mac", () => {
    expect(draw(ProjectsPage, "mac")).toContain("Choose repos");
  });

  it("reads the projects on the phone, with no Choose repos", () => {
    const html = draw(ProjectsPage, "phone");
    expect(html).toContain("Situation");
    expect(html).not.toContain("Choose repos");
  });
});

describe("the Proposals page", () => {
  const WRITES = ["Add proposal", 'aria-label="Edit ', 'aria-label="Delete '];

  it("draws Add proposal, Edit and Delete on the Mac", () => {
    const html = draw(ProposalsPage, "mac");
    for (const text of WRITES) expect(html, text).toContain(text);
  });

  it("reads the proposals on the phone, with no Add proposal, Edit or Delete", () => {
    const html = draw(ProposalsPage, "phone");
    expect(html).toContain("Site rebuild");
    for (const text of WRITES) expect(html, text).not.toContain(text);
  });
});
