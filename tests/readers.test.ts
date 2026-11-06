import { describe, expect, it } from "vitest";
import { clock, nousTopup, renewsText } from "@/lib/server/ai";
import { perMonth, polarRevenue, stripeRevenue } from "@/lib/server/billing";
import { daysLeft, parseRdap, parseWhois } from "@/lib/server/domains";
import { parseEnv } from "@/lib/server/env";
import { actionsBilled, mergeMachines } from "@/lib/server/machines";
import { hostingOf } from "@/lib/server/projects";
import { hostFromHeaders } from "@/lib/server/services";
import { gemsOf, near, stackChips } from "@/lib/server/stack";
import { cardText, sentences } from "@/lib/server/text";
import { readFeed } from "@/lib/server/vendors";
import { warnings } from "@/lib/server/warnings";

describe("readFeed", () => {
  const at = Date.parse("2026-11-01T12:00:00Z");
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
  // Card #46: MongoDB Atlas sat at "major" all week on a 2026-09-03 incident it never updated, in regions we do
  // not use. An incident with no update in 7 days is stale, carries its age and the regions it names, and sits
  // below the fresh ones.
  it("marks an incident with no update in 7 days stale, with its dates, its regions and its components", () => {
    expect(
      readFeed(
        {
          page: {},
          incidents: [
            {
              name: "Impaired Cluster operations in AWS me-central-1 and AWS me-south-1",
              impact: "major",
              status: "monitoring",
              shortlink: "https://status.mongodb.com/incidents/x",
              created_at: "2026-09-03T16:44:43.835Z",
              updated_at: "2026-09-03T16:47:21.743Z",
              components: [{ name: "MongoDB Cloud" }],
              incident_updates: [{ body: "We are continuing to <b>monitor</b>." }],
            },
            {
              name: "Errors loading issues",
              impact: "minor",
              status: "investigating",
              shortlink: "https://www.githubstatus.com/incidents/y",
              created_at: "2026-10-31T20:00:00Z",
              updated_at: "2026-11-01T09:00:00Z",
              components: [{ name: "Issues" }],
            },
          ],
        },
        "u",
        at,
      ),
    ).toEqual([
      {
        name: "Errors loading issues",
        impact: "minor",
        url: "https://www.githubstatus.com/incidents/y",
        opened: "2026-10-31T20:00:00Z",
        updated: "2026-11-01T09:00:00Z",
        stale: false,
        where: ["Issues"],
      },
      {
        name: "Impaired Cluster operations in AWS me-central-1 and AWS me-south-1",
        impact: "major",
        url: "https://status.mongodb.com/incidents/x",
        opened: "2026-09-03T16:44:43.835Z",
        updated: "2026-09-03T16:47:21.743Z",
        stale: true,
        where: ["me-central-1", "me-south-1"],
      },
    ]);
  });
  it("is stale at exactly 7 days without an update, and fresh at 6", () => {
    const feed = (updated: string) => ({
      page: {},
      incidents: [{ name: "n", impact: "minor", status: "investigating", updated_at: updated }],
    });
    expect(readFeed(feed("2026-10-26T11:59:00Z"), "u", at)?.[0].stale).toBe(false);
    expect(readFeed(feed("2026-10-25T12:00:00Z"), "u", at)?.[0].stale).toBe(true);
  });
  it("names what the incident mentions: a cloud region from its own text, else its components", () => {
    expect(
      readFeed({ page: {}, incidents: [{ name: "Network issue in us-east-1", status: "monitoring" }] }, "u", at),
    ).toEqual([{ name: "Network issue in us-east-1", impact: "none", url: "u", where: ["us-east-1"] }]);
    expect(
      readFeed(
        { page: {}, incidents: [{ name: "Errors", status: "monitoring", components: [{ name: "API" }] }] },
        "u",
        at,
      ),
    ).toEqual([{ name: "Errors", impact: "none", url: "u", where: ["API"] }]);
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
  it("reads the dates and the places a Datadog page and a Google Cloud incident name", () => {
    expect(
      readFeed(
        {
          pageType: "x",
          components: [],
          incidents: [
            {
              title: "Down",
              componentsAffected: [{ status: "partial_outage", name: "Chat (/api/v1/chat/completions)" }],
              publishedDate: "2026-10-31T09:00:00Z",
              lastModifiedAt: "2026-11-01T09:00:00Z",
            },
          ],
        },
        "u",
        at,
      ),
    ).toEqual([
      {
        name: "Down",
        url: "u",
        impact: "major",
        opened: "2026-10-31T09:00:00Z",
        updated: "2026-11-01T09:00:00Z",
        stale: false,
        where: ["Chat (/api/v1/chat/completions)"],
      },
    ]);
    expect(
      readFeed(
        [
          {
            begin: "2026-10-30T09:00:00+00:00",
            modified: "2026-11-01T08:00:00+00:00",
            external_desc: "Degraded in us-central1",
            severity: "high",
            uri: "i/9",
            currently_affected_locations: [{ title: "Iowa (us-central1)" }],
            affected_products: [{ title: "Cloud Run" }],
          },
        ],
        "u",
        at,
      ),
    ).toEqual([
      {
        name: "Degraded in us-central1",
        url: "u/i/9",
        impact: "major",
        opened: "2026-10-30T09:00:00+00:00",
        updated: "2026-11-01T08:00:00+00:00",
        stale: false,
        where: ["Iowa (us-central1)"],
      },
    ]);
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
  it("shows a host-broken marker as a row with the repo, the host and the marker's line", () => {
    const w = warnings({
      machines: [{ name: "laptop", host_broken: [{ repo: "collector", line: "bun run build: base 7f3a2b1" }] }],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([{ level: "error", text: "host broken: collector on laptop: bun run build: base 7f3a2b1" }]);
  });
  it("shows no host-broken row without a marker", () => {
    const w = warnings({
      machines: [{ name: "laptop" }, { name: "vps", host_broken: [] }],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([]);
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
  it("puts a machine's ports open to everyone in one row, naming them once each, and the two sshd settings (collector#65)", () => {
    // The same socket is bound on IPv4 and IPv6, which ss prints twice: one thing to fix, named once.
    const network = {
      allow: [22, 80, 443],
      sockets: [
        { proto: "tcp", address: "0.0.0.0", port: 5432, process: "postgres", pid: "911", mark: "open" },
        { proto: "tcp", address: "::", port: 5432, process: "postgres", pid: "911", mark: "open" },
        { proto: "udp", address: "*", port: 5353, process: null, pid: null, mark: "open" },
        { proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "700", mark: "allowed" },
        { proto: "tcp", address: "127.0.0.1", port: 8080, process: "java", pid: "1350", mark: "local" },
      ],
      ssh: { source: "/etc/ssh/sshd_config", passwordauthentication: true, permitrootlogin: true },
    };
    const w = warnings({
      machines: [{ name: "vps", network }],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w.map((x) => [x.level, x.text])).toEqual([
      ["error", "2 ports are open to everyone on vps: tcp 5432, udp 5353"],
      ["error", "SSH on vps: password authentication is on"],
      ["error", "SSH on vps: root login is on"],
    ]);
  });
  it("names the first ten open ports and counts the rest, so one busy machine cannot bury the panel (collector#65)", () => {
    const sockets = Array.from({ length: 13 }, (_, i) => ({
      proto: "udp",
      address: "*",
      port: 5000 + i,
      process: null,
      pid: null,
      mark: "open",
    }));
    const w = warnings({
      machines: [{ name: "vps", network: { allow: [22], sockets, ssh: null } }],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([
      {
        level: "error",
        text: "13 ports are open to everyone on vps: udp 5000, udp 5001, udp 5002, udp 5003, udp 5004, udp 5005, udp 5006, udp 5007, udp 5008, udp 5009, and 3 more (see the Network page)",
      },
    ]);
  });
  it("says a single port is open in the singular, and nothing at all for a machine whose ports are all expected (collector#65)", () => {
    const one = warnings({
      machines: [
        {
          name: "vps",
          network: {
            allow: [22],
            sockets: [{ proto: "tcp", address: "0.0.0.0", port: 6379, process: "redis", pid: "4", mark: "open" }],
            ssh: null,
          },
        },
      ],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(one.map((x) => x.text)).toEqual(["A port is open to everyone on vps: tcp 6379"]);
    expect(
      warnings({
        machines: [
          {
            name: "vps",
            network: {
              allow: [22],
              sockets: [{ proto: "tcp", address: "0.0.0.0", port: 22, process: "sshd", pid: "7", mark: "allowed" }],
              ssh: null,
            },
          },
        ],
        github: {},
        cfg: {},
        services: [],
        domains: [],
        ticketsError: null,
        x: null,
        ai: [],
      }),
    ).toEqual([]);
  });
  it("alarms on nothing when every port is expected public or local, or when there is no network read (collector#65)", () => {
    const w = warnings({
      machines: [
        {
          name: "vps",
          network: {
            allow: [22, 443],
            sockets: [
              { proto: "tcp", address: "0.0.0.0", port: 443, process: "nginx", pid: "99", mark: "allowed" },
              { proto: "tcp", address: "::1", port: 5432, process: "postgres", pid: "911", mark: "local" },
            ],
            ssh: { source: "sshd -T", passwordauthentication: false, permitrootlogin: false },
          },
        },
        { name: "laptop" },
      ],
      github: {},
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([]);
  });
  it("puts the month's Actions bill on the right of the Actions row", () => {
    const w = warnings({
      machines: [],
      github: { actions: { used: 2100, limit: 2000, billed: 0.51 } },
      cfg: {},
      services: [],
      domains: [],
      ticketsError: null,
      x: null,
      ai: [],
    });
    expect(w).toEqual([
      {
        level: "error",
        text: "GitHub Actions: 2,100 of 2,000 included minutes used this month (each extra minute is billed)",
        url: "https://github.com/settings/billing",
        aside: "$0.51 billed",
      },
    ]);
  });
  it("says $0.00 billed on the Actions row when nothing is billed yet, and sets no other row's aside", () => {
    const w = warnings({
      machines: [],
      github: { actions: { used: 1900, limit: 2000 } },
      cfg: {},
      services: [],
      domains: [],
      ticketsError: "board down",
      x: null,
      ai: [],
    });
    expect(w.map((x) => [x.level, x.aside])).toEqual([
      ["warn", "$0.00 billed"],
      ["warn", undefined],
    ]);
  });
});

describe("actionsBilled", () => {
  it("sums netAmount over the Actions items of a usage report and leaves other products out", () => {
    expect(
      actionsBilled({
        usageItems: [
          { product: "Actions", sku: "actions_linux", unitType: "minutes", grossQuantity: 1000, netAmount: 8 },
          { product: "Actions", sku: "actions_macos", unitType: "minutes", grossQuantity: 70, netAmount: 0.51 },
          { product: "Packages", sku: "packages_storage", unitType: "gigabyte-hours", netAmount: 3.2 },
        ],
      }),
    ).toBe(8.51);
  });
  it("is zero for a report with no Actions items, for an empty report, and for no report at all", () => {
    expect(actionsBilled({ usageItems: [{ product: "Copilot", netAmount: 12 }] })).toBe(0);
    expect(actionsBilled({ usageItems: [] })).toBe(0);
    expect(actionsBilled(undefined)).toBe(0);
  });
});

describe("a machine whose read fails keeps its last good read, marked stale (card #41)", () => {
  const ezio = { name: "ezio", running: [{ repo: "dividend-solo", card: 140 }], error: null };
  it("stamps every good read with its time", () => {
    expect(mergeMachines(undefined, [ezio], 100)).toEqual([{ ...ezio, read_at: 100, stale: false }]);
  });
  it("keeps the last good read, with the error and its own time, when a read fails", () => {
    const prev = mergeMachines(undefined, [ezio, { name: "altair", running: [], error: null }], 100);
    const next = mergeMachines(
      prev,
      [
        { name: "ezio", error: "timed out after 20 s" },
        { name: "altair", error: null },
      ],
      400,
    );
    expect(next[0]).toEqual({ ...ezio, error: "timed out after 20 s", read_at: 100, stale: true });
    expect(next[1]).toEqual({ name: "altair", error: null, read_at: 400, stale: false });
    // A second failure still carries the first good read, not the failed one.
    expect(mergeMachines(next, [{ name: "ezio", error: "exit 255" }], 700)[0]).toMatchObject({
      read_at: 100,
      stale: true,
    });
  });
  it("says a machine never read is stale, with no read time", () => {
    expect(mergeMachines(undefined, [{ name: "ezio", error: "exit 255" }], 100)).toEqual([
      { name: "ezio", error: "exit 255", read_at: null, stale: true },
    ]);
  });
});

describe("nousTopup", () => {
  it("reads the balance as the share of the current $25 top-up used", () => {
    expect(nousTopup(15.35)).toMatchObject({ label: "Top-up ($25)", used: 39, left: "$15.35 of $25 left" });
  });
  it("counts the full top-ups still waiting behind the current one", () => {
    expect(nousTopup(40)).toMatchObject({ used: 40, left: "$15.00 of $25 left · 1 more $25 top-up waiting" });
    expect(nousTopup(75)).toMatchObject({ used: 0, left: "$25.00 of $25 left · 2 more $25 top-ups waiting" });
  });
  it("shows a spent top-up as 100% used", () => {
    expect(nousTopup(0)).toMatchObject({ used: 100, left: "$0.00 of $25 left" });
  });
});
