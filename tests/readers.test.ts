import { describe, expect, it } from "vitest";
import { clock, renewsText } from "@/lib/server/ai";
import { perMonth, polarRevenue, stripeRevenue } from "@/lib/server/billing";
import { daysLeft, parseRdap, parseWhois } from "@/lib/server/domains";
import { parseEnv } from "@/lib/server/env";
import { hostingOf } from "@/lib/server/projects";
import { hostFromHeaders } from "@/lib/server/services";
import { gemsOf, near, stackChips } from "@/lib/server/stack";
import { cardText, sentences } from "@/lib/server/text";
import { readFeed } from "@/lib/server/vendors";
import { warnings } from "@/lib/server/warnings";

describe("readFeed", () => {
  it("reads Statuspage incidents and a bare status indicator", () => {
    expect(
      readFeed(
        {
          page: {},
          incidents: [
            { name: "API errors", impact: "major", shortlink: "s", status: "investigating" },
            { name: "old", status: "resolved" },
          ],
        },
        "u",
      ),
    ).toEqual([{ name: "API errors", impact: "major", url: "s" }]);
    expect(readFeed({ page: {}, incidents: [], status: { indicator: "minor", description: "Slow" } }, "u")).toEqual([
      { name: "Slow", impact: "minor", url: "u" },
    ]);
  });
  it("reads Datadog, Better Stack, Stripe, X, and Google Cloud shapes", () => {
    expect(
      readFeed(
        {
          pageType: "x",
          components: [],
          incidents: [{ title: "Down", componentsAffected: [{ status: "major_outage" }] }],
        },
        "u",
      ),
    ).toEqual([{ name: "Down", url: "u", impact: "critical" }]);
    expect(readFeed({ data: { type: "status_page", attributes: { aggregate_state: "operational" } } }, "u")).toEqual(
      [],
    );
    expect(
      readFeed(
        {
          data: { type: "status_page", attributes: { aggregate_state: "degraded" } },
          included: [{ type: "status_page_resource", attributes: { public_name: "API", status: "downtime" } }],
        },
        "u",
      ),
    ).toEqual([{ name: "API: downtime", url: "u", impact: "major" }]);
    expect(readFeed({ largestatus: "up" }, "u")).toEqual([]);
    expect(readFeed({ largestatus: "degraded", message: "m" }, "u")).toEqual([
      { name: "m", url: "u", impact: "minor" },
    ]);
    expect(readFeed({ overall: "degraded" }, "u")).toEqual([{ name: "X API: degraded", url: "u", impact: "minor" }]);
    expect(
      readFeed(
        [
          { begin: "x", external_desc: "GCE", uri: "i/1", severity: "high" },
          { begin: "x", end: "y" },
        ],
        "u",
      ),
    ).toEqual([{ name: "GCE", url: "u/i/1", impact: "major" }]);
    expect(readFeed({ something: 1 }, "u")).toBeNull();
  });
});

describe("domains", () => {
  it("reads RDAP events and the registrar's vCard name", () => {
    const j = {
      events: [
        { eventAction: "registration", eventDate: "2020-01-02T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2027-01-02T00:00:00Z" },
      ],
      entities: [
        {
          roles: ["registrar"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "Cloudflare, Inc."],
            ],
          ],
        },
      ],
    };
    expect(parseRdap(j)).toEqual({
      registered: true,
      registrar: "Cloudflare, Inc",
      expires: "2027-01-02",
      since: "2020-01-02",
    });
    expect(parseRdap({ events: [] })).toBeNull();
  });
  it("reads whois text", () => {
    expect(
      parseWhois(
        "Registry Expiry Date: 2027-03-04T00:00:00Z\nRegistrar: Example Registrar.\nCreation Date: 2019-05-06",
      ),
    ).toEqual({
      registered: true,
      registrar: "Example Registrar",
      expires: "2027-03-04",
      since: "2019-05-06",
    });
    expect(parseWhois("NOT FOUND")).toEqual({ registered: false });
    expect(parseWhois("Registrar: X")).toEqual({ error: "whois shows no expiry date" });
  });
  it("counts days left to local midnight, counting today", () => {
    const now = new Date(2026, 9, 21, 15, 0).getTime();
    expect(daysLeft("2026-10-22", now)).toBe(1);
    expect(daysLeft("2026-10-31", now)).toBe(10);
    expect(daysLeft(null, now)).toBeNull();
  });
});

describe("billing", () => {
  it("turns prices into monthly amounts", () => {
    expect(perMonth(1200, "year")).toBe(1);
    expect(perMonth(500, "month", 1)).toBe(5);
    expect(perMonth(500, "month", 3)).toBeCloseTo(5 / 3);
    expect(perMonth(500, "lifetime")).toBe(0);
  });
  it("counts Stripe subscriptions, paid charges, and Clerk term charges", () => {
    const now = 1_800_000_000;
    const subs = [
      { items: { data: [{ price: { unit_amount: 1000, recurring: { interval: "month" } }, quantity: 2 }] } },
    ];
    const charges = [
      {
        paid: true,
        status: "succeeded",
        amount: 12000,
        amount_refunded: 0,
        description: "Pro (annual)",
        created: now - 86400,
      },
      { paid: true, status: "succeeded", amount: 500, amount_refunded: 100, description: "one-off", created: now },
      { paid: false, status: "failed", amount: 999, created: now },
    ];
    expect(stripeRevenue(subs, charges, now)).toEqual({ mrr: 30, subscribers: 2, revenue: 124, payments: 2 });
  });
  it("counts Polar subscriptions and paid orders", () => {
    expect(
      polarRevenue(
        [{ amount: 1200, recurring_interval: "year" }],
        [
          { paid: true, total_amount: 1200, refunded_amount: 200 },
          { paid: false, total_amount: 5 },
        ],
      ),
    ).toEqual({ mrr: 1, subscribers: 1, revenue: 10, payments: 1 });
  });
});

describe("projects", () => {
  it("finds hosting from the deploy bot, else from a host file", () => {
    expect(hostingOf("vercel[bot]", [])).toBe("Vercel");
    expect(hostingOf("github-actions[bot]", ["web/config/deploy.yml"])).toBe("Self-hosted (Kamal)");
    expect(hostingOf("", ["fly.toml"])).toBe("Fly.io");
    expect(hostingOf("", ["src/a.ts"])).toBeNull();
    expect(hostFromHeaders((n) => (n === "fly-request-id" ? "1" : null))).toBe("Fly.io");
  });
  it("groups stack chips by category, in table order", () => {
    const paths = [
      "package.json",
      "tsconfig.json",
      "bun.lock",
      "web/package.json",
      "a/b/package.json",
      "components.json",
    ];
    expect(near(paths, "package.json")).toEqual(["package.json", "web/package.json"]);
    const chips = stackChips(
      paths,
      new Set(["next", "react", "@radix-ui/react-dialog", "stripe"]),
      gemsOf("gem 'rails'\n"),
      "Vercel",
    );
    expect(chips).toEqual([
      { category: "Language", items: ["TypeScript"] },
      { category: "Runtime", items: ["Bun"] },
      { category: "Framework", items: ["Next.js", "Rails", "React"] },
      { category: "UI", items: ["shadcn/ui", "Radix"] },
      { category: "Payments", items: ["Stripe"] },
      { category: "Hosting", items: ["Vercel"] },
    ]);
  });
});

describe("text", () => {
  it("keeps prose sentences only", () => {
    expect(
      sentences("# Head\n> quote\nForeman on laptop: **Built** it. See /a/b/c/d.\n- [ ] box\n- It costs $5. Done!"),
    ).toEqual(["Built it.", "Done!"]);
  });
  it("prefers the Agent Brief summary for a card", () => {
    expect(cardText("## Agent Brief\n**Summary:** Replace the server. Keep the look.\n## What\nOther.")).toBe(
      "Replace the server. Keep the look.",
    );
    expect(cardText("## What\nFix the bar. It is red.\n## Why\nNo.")).toBe("Fix the bar. It is red.");
  });
});

describe("env and AI", () => {
  it("parses .env lines", () => {
    expect(parseEnv("# c\nA=1\nB = \"two\"\nC='3'\nnot a pair\n")).toEqual({ A: "1", B: "two", C: "3" });
  });
  it("formats reset times and renewals in local time", () => {
    const t = new Date(2026, 9, 22, 9, 5);
    expect(clock(t.toISOString(), false)).toBe("9:05 AM");
    expect(clock(t.toISOString(), true)).toBe("Thu 9 AM");
    expect(clock(null, false)).toBe("?");
    expect(renewsText(new Date(2026, 9, 30, 12).toISOString(), new Date(2026, 9, 21, 12))).toBe("in 9 days (Oct 30)");
  });
});

describe("warnings", () => {
  const at = (seconds: number[]) => seconds.map((s) => 1_700_000_000 + s);
  it("lists errors before warnings and tags each job with its machine and note", () => {
    const machines = [
      {
        name: "m1",
        work_starts_10m: at([0, 10, 20, 30, 40]),
        jobs: [
          { name: "a", enabled: true, last_status: "error", last_error: "boom", script: "x.py" },
          { name: "b", enabled: true, last_status: "ok", script: "x.py" },
        ],
      },
    ];
    const w = warnings({
      machines,
      github: { graphql: { used: 4800, limit: 5000, reset: 0 } },
      cfg: { jobs: { a: "Does A" }, work_script: { label: "Foreman", max_starts_60s: 5 } },
      services: [],
      domains: [{ name: "x.com", registered: true, days: 5, expires: "2026-10-26", registrar: "R", ssl_days: 40 }],
      ticketsError: "board down",
      x: { credits: { total: 2, free: 0, prepaid: 2, free_expires: null } },
      ai: [],
    });
    expect(w.map((x) => x.level)).toEqual(["error", "error", "error", "error", "error", "warn", "warn"]);
    expect(w[0].text).toBe("a on m1: last run error (boom)");
    expect(w.some((x) => x.text.startsWith("The same script (x.py) starts from 2 jobs on m1"))).toBe(true);
    expect(machines[0].jobs[0]).toMatchObject({ machine: "m1", what: "Does A" });
  });
  it("raises open incidents only for vendors marked attention", () => {
    const inc = (name: string) => ({
      name,
      url: `https://${name}.example.com`,
      state: "minor",
      incidents: [{ name: "Errors loading issues", impact: "minor", url: "" }],
    });
    const w = warnings({
      machines: [],
      github: {},
      cfg: {
        vendors: [
          { name: "GitHub", url: "", attention: true },
          { name: "OpenAI", url: "" },
        ],
      },
      services: [],
      domains: [],
      ticketsError: null,
      vendors: [inc("GitHub"), inc("OpenAI")],
      x: null,
      ai: [],
    });
    expect(w.map((x) => x.text)).toEqual(["GitHub incident: Errors loading issues (minor)"]);
  });
  it("says the board read is degraded when GitHub's board list misses cards", () => {
    const w = warnings({
      machines: [],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      boardGap: ["collector#10", "studio#42"],
      x: null,
      ai: [],
    });
    expect(w.map((x) => x.text)).toEqual([
      "Board read degraded: GitHub's board list is missing 2 open cards that search finds (collector#10, studio#42). The panels and the lanes leave them out until GitHub catches up",
    ]);
  });
  it("does not alarm on 17 starts spread over ten minutes (cron each minute plus hand-offs)", () => {
    const starts = at([0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 5, 65, 125, 185, 245, 305, 365]);
    expect(starts).toHaveLength(17);
    const w = warnings({
      machines: [{ name: "m1", work_starts_10m: starts }],
      github: {},
      cfg: { work_script: { label: "Foreman" } },
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w.map((x) => x.text)).toEqual([]);
  });
  it("alarms when 5 starts fall within 40 seconds", () => {
    const w = warnings({
      machines: [{ name: "m1", work_starts_10m: at([0, 10, 20, 30, 40]) }],
      github: {},
      cfg: { work_script: { label: "Foreman" } },
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([
      { level: "error", text: "Foreman on m1 started 5 times in 60 s: it is starting itself in a loop" },
    ]);
  });
});
