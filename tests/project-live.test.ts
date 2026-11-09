import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * A project's live link (collector#86). `lib/server/projects.ts` took a repo's GitHub `homepage` — a field of a
 * repo the user may not own — straight onto the row, and `components/projects.tsx`'s `liveSite` puts it in an
 * `<a href>` on Collector's own origin, where `POST /api/update` swaps a build in and restarts the server,
 * `/api/hermes` and `/api/tailscale` start things and `POST /api/projects` rewrites `config.json`. React writes a
 * known attribute straight through, so a `javascript:` homepage runs there when it is clicked. Only a web address
 * is a link (`lib/links.ts`'s `webUrl`, the same rule collector#84 kept on a vendor's feed), and a homepage that is
 * not one reads exactly like a repo with no homepage at all.
 *
 * The `gh` reads are mocked, so this test makes no API call, and `COLLECTOR_CONFIG` points at a throwaway folder:
 * the real `config.json` is never read or written (AGENTS.md, Dangers).
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-live-"));
const envBefore = process.env.COLLECTOR_CONFIG;
process.env.COLLECTOR_CONFIG = path.join(dir, "config.json");

/** The three repos the page reads, and one service whose own url is not a web address. */
fs.writeFileSync(
  process.env.COLLECTOR_CONFIG,
  `${JSON.stringify(
    {
      projects: ["acme/web", "acme/bad-homepage", "acme/bad-service", "acme/no-homepage"],
      services: [{ name: "bad-service", url: "javascript:alert(1)" }],
    },
    null,
    2,
  )}\n`,
);

vi.mock("@/lib/server/run", () => {
  /** What GitHub answers for each repo's `homepage`; a repo not named here has none. */
  const HOMEPAGES: Record<string, string> = {
    "acme/web": "https://example.com",
    "acme/bad-homepage": "javascript:alert(1)",
  };
  const info = (repo: string) => ({
    name: repo.split("/")[1],
    html_url: `https://github.com/${repo}`,
    homepage: HOMEPAGES[repo] ?? "",
    default_branch: "main",
    open_issues_count: 0,
    private: false,
    pushed_at: "2026-11-01T00:00:00Z",
    archived: false,
  });
  return {
    run: async (cmd: string[]) => {
      const what = String(cmd[2] ?? "");
      const repo = what.split("/").slice(1, 3).join("/");
      if (what === `repos/${repo}`) return [info(repo), null];
      if (what.startsWith(`repos/${repo}/pulls`)) return [[], null];
      if (what.startsWith(`repos/${repo}/actions`)) return [{ workflow_runs: [] }, null];
      if (what.startsWith(`repos/${repo}/deployments`)) return [[], null];
      if (what.startsWith(`repos/${repo}/git/trees`)) return [{ tree: [] }, null];
      return [null, "not found"];
    },
  };
});

/** The two readers `projects()` also makes; both reach the network, so neither runs here. */
vi.mock("@/lib/server/datafast", () => ({ datafast: { get: async () => ({ sites: {}, error: null }) } }));
vi.mock("@/lib/server/billing", () => ({ billing: async () => ({}) }));

const run = async () => {
  const { projects } = await import("@/lib/server/projects");
  const { projects: rows } = await projects(true);
  const row = (repo: string) => rows.find((p: any) => p.repo === repo);
  return { rows, row };
};

afterAll(() => {
  if (envBefore === undefined) delete process.env.COLLECTOR_CONFIG;
  else process.env.COLLECTOR_CONFIG = envBefore;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a project's live site (collector#86)", () => {
  it("keeps a homepage that is a web address", async () => {
    const { row } = await run();
    expect(row("acme/web")).toMatchObject({ homepage: "https://example.com", live: "https://example.com" });
  });

  // The card's own case: the href this row builds is `live` first and `homepage` second (components/projects.tsx),
  // so both fields are read here — sanitising one alone would leave the page's fallback with the raw value.
  it("gives no href when the repo's homepage runs script, and reads like a repo with no homepage", async () => {
    const { row } = await run();
    expect(row("acme/bad-homepage")).toMatchObject({ homepage: "", live: "" });
    expect(row("acme/bad-homepage")?.live).toBe(row("acme/no-homepage")?.live);
  });

  it("gives no href when the service url is not a web address either", async () => {
    const { row } = await run();
    expect(row("acme/bad-service")).toMatchObject({ homepage: "", live: "" });
  });
});
