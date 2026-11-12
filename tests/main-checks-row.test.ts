import { describe, expect, it } from "vitest";
import { mainChecksPrompt } from "@/lib/server/debug-fix";
import { warnings } from "@/lib/server/warnings";

/**
 * James, 2026-11-11, on "omarchy4mac: the checks fail on main at altair (Jog CI ci.yml, at 6994081): failed to get run
 * log: log not found": "what is that? Is that a verify ... what is causing the checks to fail on main? ... Why is it
 * getting triggered? And then why is it failing? ... There's no way to fix it. There's no info on it." And: "if there's
 * nothing I can do except wait ... then they shouldn't be in there."
 */
const base = {
  github: {},
  services: [],
  domains: [],
  ticketsError: null,
  x: null,
  ai: [],
  cfg: { projects: ["dividendsolo/omarchy4mac"] },
} as any;
const at = (b: any, name = "altair") => warnings({ ...base, machines: [{ name, host_broken: [b] }] });

describe("the row for a main that fails its checks", () => {
  const real = { repo: "omarchy4mac", line: "Jog CI ci.yml: base 699408145ffa", error: "tests/menu-test.sh failed" };

  it("says what runs the check, why, what failed, and what it stops", () => {
    const [row] = at(real);
    expect(row.text).toBe(
      "omarchy4mac: main fails its own checks on altair. The foreman tests main before it builds a card, so altair builds no omarchy4mac cards until main passes. Failed: the unit tests in GitHub Actions (ci.yml) at 6994081: tests/menu-test.sh failed",
    );
  });

  it("links to main's CI runs when the unit tests failed", () => {
    expect(at(real)[0].url).toBe(
      "https://github.com/dividendsolo/omarchy4mac/actions/workflows/ci.yml?query=branch%3Amain",
    );
  });

  it("carries a Debug and fix button for that repo on that machine", () => {
    expect(at(real)[0].fixMain).toEqual({ machine: "altair", repo: "omarchy4mac" });
  });

  it("names a local step as the command it ran", () => {
    const [row] = at({ repo: "omarchy4mac", line: "bun run build: base 7f3a2b1" });
    expect(row.text).toContain("Failed: `bun run build` at 7f3a2b1.");
    expect(row.url).toBeUndefined();
  });

  it("never shows when GitHub kept no log of the run: nothing to fix, it clears itself", () => {
    const w = at({ ...real, error: "failed to get run log: log not found" });
    expect(w.some((x) => x.text.includes("omarchy4mac"))).toBe(false);
  });
});

/**
 * agent-stack#398: a red main a builder can fix goes to a builder. The foreman files a P0 `ready-for-agent` card in
 * the repo and writes its number at the end of the marker line (` card #<n>`, agent-stack PR #401). The card is on the
 * board like any other P0, so the fixMain row would be a second place to fix the same thing.
 */
describe("a red main the foreman filed a card for", () => {
  const carded = {
    repo: "omarchy4mac",
    line: "Jog CI ci.yml: base 699408145ffa card #398",
    error: "tests/menu-test.sh failed",
  };

  it("gives no Priority tasks row: the card on the board is the work", () => {
    expect(at(carded).some((x) => x.fixMain)).toBe(false);
    expect(at(carded).some((x) => x.text.includes("omarchy4mac"))).toBe(false);
  });

  it("keeps the row when the filing wrote no card: a failed filing is never silent", () => {
    const uncarded = { ...carded, line: "Jog CI ci.yml: base 699408145ffa" };
    expect(at(uncarded)[0].fixMain).toEqual({ machine: "altair", repo: "omarchy4mac" });
  });

  it("keeps the row for a preflight marker, card or not, and never shows the card tail", () => {
    const plain = at({ repo: "zero-phase", line: "preflight: missing bun" });
    expect(plain[0].fixMain).toEqual({ machine: "altair", repo: "zero-phase" });
    expect(plain[0].text).toContain("Failed: `preflight: missing bun`.");
    const withCard = at({ repo: "zero-phase", line: "preflight: missing bun card #401" });
    expect(withCard[0].fixMain).toEqual({ machine: "altair", repo: "zero-phase" });
    expect(withCard[0].text).not.toContain("card #401");
  });
});

describe("the Debug and fix session for a failing main", () => {
  const p = mainChecksPrompt(
    { machine: "ezio", ssh: "div@ezio", local: false },
    { repo: "omarchy4mac", step: "Jog CI ci.yml", sha: "6994081", error: "tests/menu-test.sh failed" },
  );

  it("names the repo, the machine, the step and the error", () => {
    expect(p).toContain("omarchy4mac");
    expect(p).toContain("ezio");
    expect(p).toContain("Jog CI ci.yml");
    expect(p).toContain("tests/menu-test.sh failed");
  });

  it("points at the foreman's log and marker on that machine", () => {
    expect(p).toContain("ssh div@ezio");
    expect(p).toContain("~/.hermes/foreman/base-gate-omarchy4mac.log");
    expect(p).toContain("~/.hermes/foreman/host-broken-omarchy4mac");
  });

  it("asks for a failing test first and a ship", () => {
    expect(p).toMatch(/failing test/);
    expect(p).toMatch(/shipit/);
  });

  it("refuses a repo name that is not one", () => {
    expect(() =>
      mainChecksPrompt({ machine: "ezio", ssh: null, local: true }, { repo: "a; rm -rf ~", step: "", sha: "" }),
    ).toThrow();
  });
});
