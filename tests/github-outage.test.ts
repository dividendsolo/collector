import { describe, expect, it } from "vitest";
import { warnings } from "@/lib/server/warnings";

/**
 * James, 2026-11-11, on two rows "omarchy4mac: the checks fail on main at altair / ezio (Jog CI ci.yml, at 6994081):
 * failed to get run log: log not found" during GitHub's Actions outage: "those two items should show that it's because
 * of GitHub ... maybe we shouldn't even have them there at all". A run with no log at all, while GitHub has an open
 * incident naming Actions, is GitHub's, not ours: the rows fold into the GitHub incident row, which names the builds
 * that wait on it, and one Acknowledge covers both. When the incident ends, a main that still fails shows again.
 * The foreman rechecks main on its own, so nobody has to do anything when GitHub recovers.
 */
const broken = {
  repo: "omarchy4mac",
  line: "Jog CI ci.yml: base 699408145ffa",
  error: "failed to get run log: log not found",
};
const base = {
  github: {},
  services: [],
  domains: [],
  ticketsError: null,
  x: null,
  ai: [],
  cfg: { vendors: [{ name: "GitHub", url: "https://www.githubstatus.com", attention: true }] },
  machines: [
    { name: "altair", host_broken: [broken] },
    { name: "ezio", host_broken: [broken] },
  ],
} as any;
const github = (where: string[]) => ({
  name: "GitHub",
  url: "https://www.githubstatus.com",
  state: "critical",
  incidents: [{ name: "Impact across multiple GitHub products", impact: "critical", url: "u", where }],
});
const texts = (w: any[]) => w.map((x) => x.text);

describe("main's checks during a GitHub Actions incident", () => {
  it("fold into the GitHub incident row, which names the builds that wait", () => {
    const w = warnings({ ...base, vendors: [github(["Webhooks", "Actions", "Pages"])] });
    expect(texts(w).some((t) => t.includes("the checks fail on main"))).toBe(false);
    const row = w.find((x) => x.text.startsWith("GitHub incident"));
    expect(row?.text).toContain("omarchy4mac builds wait on it (altair, ezio)");
  });

  it("change the incident's Acknowledge key, so a new wait shows again", () => {
    const quiet = warnings({ ...base, machines: [], vendors: [github(["Actions"])] });
    const waiting = warnings({ ...base, vendors: [github(["Actions"])] });
    const key = (w: any[]) => w.find((x) => x.text.startsWith("GitHub incident"))?.ack?.key;
    expect(key(waiting)).not.toBe(key(quiet));
  });

  it("stay their own rows when the incident does not name Actions", () => {
    const w = warnings({ ...base, vendors: [github(["Pages"])] });
    expect(texts(w).filter((t) => t.includes("the checks fail on main"))).toHaveLength(2);
  });

  it("stay their own rows when the run has a log: that is a real failure", () => {
    const real = { ...broken, error: "tests/menu-test.sh failed" };
    const w = warnings({
      ...base,
      machines: [{ name: "altair", host_broken: [real] }],
      vendors: [github(["Actions"])],
    });
    expect(texts(w).filter((t) => t.includes("the checks fail on main"))).toHaveLength(1);
  });

  it("stay their own rows with no GitHub incident", () => {
    const w = warnings({ ...base, vendors: [] });
    expect(texts(w).filter((t) => t.includes("the checks fail on main"))).toHaveLength(2);
  });

  it("drops the period that ends a vendor's incident name before its impact", () => {
    const v = github(["Actions"]);
    v.incidents[0].name = "Impact across multiple GitHub products.";
    const row = warnings({ ...base, machines: [], vendors: [v] }).find((x) => x.text.startsWith("GitHub incident"));
    expect(row?.text).toBe("GitHub incident: Impact across multiple GitHub products (critical)");
  });
});
