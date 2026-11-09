import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { money } from "@/lib/format";
import { API_CRITICALITIES, badConfigValues, PROJECT_STAGES, projectRepos, projectStage } from "@/lib/server/config";
import { renewalDays, warnings } from "@/lib/server/warnings";
import { vendorOrder } from "@/lib/vendors";

/** The three hand-kept fields Mission Control had and Collector did not (collector#78): a project's stage, a
 * vendor's criticality, and a subscription's renewal date. Each is a setting in config.json, so each is one
 * value read off the file, refused by the config check when it is not one Collector knows, and shown where it
 * belongs. */

/** The file a new user copies or pastes, read as text. */
const file = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("a project's stage (collector#78)", () => {
  it("shows the stage config.json sets for a repo, and nothing for a project without one", () => {
    const cfg = { projects: { "acme/app": { stage: "production" }, "acme/lib": {} } };
    expect(projectRepos(cfg)).toEqual(["acme/app", "acme/lib"]);
    expect(projectStage(cfg, "acme/app")).toBe("production");
    expect(projectStage(cfg, "acme/lib")).toBeUndefined();
  });

  it("still reads the list the repo picker writes, where no repo has a stage", () => {
    const cfg = { projects: ["acme/app"] };
    expect(projectRepos(cfg)).toEqual(["acme/app"]);
    expect(projectStage(cfg, "acme/app")).toBeUndefined();
  });

  it("refuses a stage outside the allowed values", () => {
    expect(badConfigValues({ projects: { "acme/app": { stage: "shipping" } } })).toEqual([
      `projects["acme/app"].stage "shipping" is not one of ${PROJECT_STAGES.join(", ")}`,
    ]);
    expect(badConfigValues({ projects: { "acme/app": { stage: "production" } } })).toEqual([]);
    expect(badConfigValues({ projects: ["acme/app"] })).toEqual([]);
  });
});

describe("a vendor's criticality (collector#78)", () => {
  const vendor = (name: string, criticality?: string, incident = false) => ({
    name,
    url: `https://${name.toLowerCase()}.example`,
    state: incident ? "major" : "ok",
    incidents: incident ? [{ name: "API errors", impact: "major", url: "" }] : [],
    criticality,
  });
  const names = (rows: ReturnType<typeof vendor>[]) => vendorOrder(rows).map((v) => v.name);

  it("sorts a vendor we depend on heavily that shows an incident to the top", () => {
    expect(names([vendor("Railway", "low"), vendor("Cloudflare", "critical", true), vendor("GitHub")])).toEqual([
      "Cloudflare",
      "GitHub",
      "Railway",
    ]);
  });

  it("leaves a heavy vendor with no incident, and a light one with an incident, where they were", () => {
    expect(
      names([vendor("Vercel", "critical"), vendor("Stripe", "high", true), vendor("Railway", "low", true)]),
    ).toEqual(["Stripe", "Railway", "Vercel"]);
  });

  it("keeps a heavy vendor whose only incident is stale below a live outage", () => {
    const github = { ...vendor("GitHub", "critical"), incidents: [{ name: "Old notice", impact: "none", url: "" }] };
    expect(names([github, vendor("Stripe", "medium", true)])).toEqual(["Stripe", "GitHub"]);
  });

  it("refuses a criticality outside the allowed values", () => {
    expect(badConfigValues({ vendors: [{ name: "GitHub", url: "u", criticality: "urgent" }] })).toEqual([
      `vendors[0] (GitHub).criticality "urgent" is not one of ${API_CRITICALITIES.join(", ")}`,
    ]);
    expect(badConfigValues({ vendors: [{ name: "GitHub", url: "u", criticality: "high" }] })).toEqual([]);
    expect(badConfigValues({ vendors: [{ name: "GitHub", url: "u" }] })).toEqual([]);
  });
});

/** A date `days` from today, written the way config.json writes one. */
const inDays = (days: number) => {
  const d = new Date(Date.now() + days * 864e5);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

describe("a subscription's renewal date (collector#78)", () => {
  const rows = (sub: Record<string, unknown>) =>
    warnings({
      machines: [],
      github: {},
      cfg: { subscriptions: [{ name: "Hosting", amount: 20, ...sub }] } as never,
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });

  it("warns for a renewal inside the week, and says nothing for one outside it", () => {
    expect(rows({ renews: inDays(3) })).toEqual([
      { level: "warn", text: `Hosting renews on ${inDays(3)} for ${money(20)}` },
    ]);
    expect(rows({ renews: inDays(30) })).toEqual([]);
    expect(rows({})).toEqual([]);
  });

  it("counts whole calendar days, so an evening is not another day", () => {
    expect(renewalDays("2026-11-15", Date.parse("2026-11-12T23:50:00"))).toBe(3);
    expect(renewalDays("2026-11-15", Date.parse("2026-11-15T00:10:00"))).toBe(0);
  });

  it("refuses a renewal date that is not a date", () => {
    expect(
      badConfigValues({ subscriptions: [{ name: "Hosting", amount: 20, renews: "next tuesday" }] as never }),
    ).toEqual([`subscriptions[0] (Hosting).renews "next tuesday" is not a date (YYYY-MM-DD)`]);
    expect(
      badConfigValues({ subscriptions: [{ name: "Hosting", amount: 20, renews: "2026-11-15" }] as never }),
    ).toEqual([]);
  });
});

describe("the files a new user reads (collector#78)", () => {
  it("names the three fields in config.example.json, README.md and SETUP.md", () => {
    for (const p of ["config.example.json", "README.md", "SETUP.md"]) {
      for (const field of ["stage", "criticality", "renews"]) expect(file(p)).toContain(field);
    }
  });

  it("config.example.json sets each field to a value Collector knows", () => {
    const cfg = JSON.parse(file("config.example.json"));
    const stages: string[] = Object.values(cfg.projects || {}).map((p: any) => p?.stage);
    expect(stages.filter(Boolean).length).toBeGreaterThan(0);
    for (const s of stages.filter(Boolean)) expect(PROJECT_STAGES).toContain(s);
    expect((cfg.vendors || []).filter((v: any) => v.criticality).length).toBeGreaterThan(0);
    for (const v of cfg.vendors || []) if (v.criticality) expect(API_CRITICALITIES).toContain(v.criticality);
    expect((cfg.subscriptions || []).filter((s: any) => s.renews).length).toBeGreaterThan(0);
    for (const s of cfg.subscriptions || []) if (s.renews) expect(s.renews).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
