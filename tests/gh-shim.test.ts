import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { commandEnv, GH_CALLER, shimDir } from "@/lib/server/gh";
import { runText } from "@/lib/server/run";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-gh-shim-"));
const realBin = fakeBin('echo "plain $*"');
const base: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [realBin, "/usr/bin:/bin"].join(path.delimiter),
  GH_CALLER: undefined,
};
const CALL = ["gh", "api", "graphql", "-f", "query={viewer{login}}"];

function fakeBin(body: string): string {
  const bin = fs.mkdtempSync(path.join(dir, "bin-"));
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return bin;
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("Collector runs gh through agent-stack's shim (collector#215)", () => {
  it("names the tools copy the shim lives in", () => {
    expect(shimDir(base)).toBe(path.join(os.homedir(), ".local", "share", "agent-stack", "current", "vps", "bin"));
  });

  it("puts the shim first on the PATH it gives gh, with GH_CALLER=collector", () => {
    const bin = fakeBin(":");
    const env = commandEnv("gh", { ...base, COLLECTOR_GH_BIN: bin });
    expect(env.PATH?.split(path.delimiter)).toEqual([bin, realBin, "/usr/bin", "/bin"]);
    expect(env.GH_CALLER).toBe(GH_CALLER);
    expect(env.GH_CALLER).toBe("collector");
  });

  it("leaves every other command's environment as it was", () => {
    const before = { ...base, COLLECTOR_GH_BIN: fakeBin(":") };
    expect(commandEnv("git", before)).toBe(before);
    expect(commandEnv("/bin/sh", before)).toBe(before);
    expect(commandEnv("status", before).GH_CALLER).toBeUndefined();
  });

  it("leaves the environment as it was where no shim is installed", () => {
    const noShim = { ...base, COLLECTOR_GH_BIN: path.join(dir, "not-a-shim") };
    expect(commandEnv("gh", noShim)).toBe(noShim);
    const noPath = { ...base, PATH: undefined, COLLECTOR_GH_BIN: fakeBin(":") };
    expect(commandEnv("gh", noPath)).toBe(noPath);
  });

  it("runs the call a Collector read runs through the shim, as the collector caller", async () => {
    const bin = fakeBin('echo "$GH_CALLER $(command -v gh) $*"');
    const r = await runText(CALL, { env: { ...base, COLLECTOR_GH_BIN: bin }, timeout: 10 });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe(`collector ${path.join(bin, "gh")} api graphql -f query={viewer{login}}`);
  });
});
