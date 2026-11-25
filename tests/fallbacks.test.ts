import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyNote, providerSlug, removalPlan, removalQuestion, removalRefusal } from "@/lib/providers";
import { pythonOver } from "@/lib/server/machines";

const ROOT = process.cwd();
const DAY = (() => {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
})();

const CHAIN = `fallback_providers:
  - provider: kimi-coding
    model: kimi-k3
  - provider: minimax
    model: MiniMax-M3
  - provider: anthropic
    model: claude-opus-5-5
`;

const WITH_CHAIN = `model:
  base_url: ''
  default: claude-opus-5-5
  provider: anthropic
${CHAIN}toolsets:
  - hermes-cli
`;

const EMPTY_CHAIN = `model:
  default: claude-opus-5-5
  provider: anthropic
fallback_providers: []
toolsets: []
`;

const NO_KEY = `model:
  default: claude-opus-5-5
  provider: anthropic
toolsets: []
`;

const MODEL_ONLY = `fallback_providers:
  - provider: kimi-coding
    model: kimi-k3
toolsets: []
`;

function home(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collector-fallbacks-"));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return dir;
}

interface Answer {
  changed: { profile: string; file: string; backup: string; entries: number }[];
  skipped: { profile: string; why: string }[];
  errors: { profile: string; why: string }[];
  error?: string;
}

function write(dir: string, args: string[]): Answer {
  return JSON.parse(
    execFileSync("python3", [path.join(ROOT, "fallbacks.py"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, HOME: dir },
    }),
  ) as Answer;
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");

describe("every machine's profiles: removing a provider", () => {
  it("keeps the other fallbacks in the order they were, and the rest of the file byte for byte", () => {
    const dir = home({ ".hermes/config.yaml": WITH_CHAIN, ".hermes/profiles/abide-builder/config.yaml": WITH_CHAIN });
    const answer = write(dir, ["remove", "minimax"]);
    expect(answer.errors).toEqual([]);
    expect(answer.skipped).toEqual([]);
    expect(answer.changed.map((c) => c.profile)).toEqual(["default", "abide-builder"]);
    const want = WITH_CHAIN.replace("  - provider: minimax\n    model: MiniMax-M3\n", "");
    expect(read(dir, ".hermes/config.yaml")).toBe(want);
    expect(read(dir, ".hermes/profiles/abide-builder/config.yaml")).toBe(want);
    expect(answer.changed[0].entries).toBe(2);
  });

  it("leaves a dated copy of each file it changed", () => {
    const dir = home({ ".hermes/config.yaml": WITH_CHAIN });
    const [changed] = write(dir, ["remove", "minimax"]).changed;
    expect(changed.backup).toBe(path.join(dir, ".hermes", `config.yaml.${DAY}`));
    expect(fs.readFileSync(changed.backup, "utf8")).toBe(WITH_CHAIN);
  });

  it("moves one file once a day: the copy stays the file as it was before the day's first change", () => {
    const dir = home({ ".hermes/config.yaml": WITH_CHAIN });
    write(dir, ["remove", "minimax"]);
    write(dir, ["remove", "kimi-coding"]);
    expect(fs.readFileSync(path.join(dir, ".hermes", `config.yaml.${DAY}`), "utf8")).toBe(WITH_CHAIN);
  });

  it("says which profiles were left alone rather than writing them", () => {
    const dir = home({ ".hermes/config.yaml": WITH_CHAIN, ".hermes/profiles/empty/config.yaml": EMPTY_CHAIN });
    const answer = write(dir, ["remove", "minimax"]);
    expect(answer.changed.map((c) => c.profile)).toEqual(["default"]);
    expect(answer.skipped).toEqual([{ profile: "empty", why: "no such fallback provider" }]);
    expect(read(dir, ".hermes/profiles/empty/config.yaml")).toBe(EMPTY_CHAIN);
  });

  it("empties the chain Hermes's own default config shows, and never touches model.provider", () => {
    const dir = home({ ".hermes/config.yaml": MODEL_ONLY });
    const answer = write(dir, ["remove", "kimi-coding"]);
    expect(answer.errors).toEqual([]);
    expect(read(dir, ".hermes/config.yaml")).toBe("fallback_providers: []\ntoolsets: []\n");
  });

  it("refuses a value it cannot read, rather than rewriting it", () => {
    const odd = MODEL_ONLY.replace("fallback_providers:\n", "fallback_providers: kept\n");
    const dir = home({ ".hermes/config.yaml": odd });
    const answer = write(dir, ["remove", "kimi-coding"]);
    expect(answer.changed).toEqual([]);
    expect(answer.skipped[0].why).toContain("not a list");
    expect(read(dir, ".hermes/config.yaml")).toBe(odd);
  });
});

describe("every machine's profiles: adding a provider", () => {
  it("appends one entry to each profile's own chain", () => {
    const dir = home({
      ".hermes/config.yaml": WITH_CHAIN,
      ".hermes/profiles/empty/config.yaml": EMPTY_CHAIN,
      ".hermes/profiles/bare/config.yaml": NO_KEY,
    });
    const answer = write(dir, ["add", "zai", "GLM-5"]);
    expect(answer.errors).toEqual([]);
    expect(answer.changed.map((c) => c.profile)).toEqual(["default", "bare", "empty"]);
    expect(read(dir, ".hermes/config.yaml")).toBe(
      WITH_CHAIN.replace("toolsets:", "  - provider: zai\n    model: GLM-5\ntoolsets:"),
    );
    expect(read(dir, ".hermes/profiles/empty/config.yaml")).toBe(
      EMPTY_CHAIN.replace("fallback_providers: []\n", "fallback_providers:\n  - provider: zai\n    model: GLM-5\n"),
    );
    expect(read(dir, ".hermes/profiles/bare/config.yaml")).toBe(
      NO_KEY.replace("toolsets: []\n", "fallback_providers:\n  - provider: zai\n    model: GLM-5\ntoolsets: []\n"),
    );
  });

  it("does not add the same provider and model twice", () => {
    const dir = home({ ".hermes/config.yaml": WITH_CHAIN });
    const answer = write(dir, ["add", "minimax", "MiniMax-M3"]);
    expect(answer.changed).toEqual([]);
    expect(answer.skipped).toEqual([{ profile: "default", why: "already a fallback of this profile" }]);
    expect(read(dir, ".hermes/config.yaml")).toBe(WITH_CHAIN);
  });

  it("leaves every config.yaml as it was once the entry is removed again", () => {
    const dir = home({
      ".hermes/config.yaml": WITH_CHAIN,
      ".hermes/profiles/empty/config.yaml": EMPTY_CHAIN,
    });
    write(dir, ["add", "zai", "GLM-5"]);
    const removed = write(dir, ["remove", "zai"]);
    expect(removed.errors).toEqual([]);
    expect(read(dir, ".hermes/config.yaml")).toBe(WITH_CHAIN);
    expect(read(dir, ".hermes/profiles/empty/config.yaml")).toBe(EMPTY_CHAIN);
  });

  it("restores a profile that had no fallback key to the empty list Hermes's own config writes", () => {
    const dir = home({ ".hermes/profiles/bare/config.yaml": NO_KEY });
    write(dir, ["add", "zai", "GLM-5"]);
    write(dir, ["remove", "zai"]);
    expect(read(dir, ".hermes/profiles/bare/config.yaml")).toBe(
      NO_KEY.replace("toolsets: []", "fallback_providers: []\ntoolsets: []"),
    );
  });
});

const machines = [
  {
    name: "altair",
    profiles: [
      { name: "darndest-builder", provider: "anthropic", fallbacks: ["kimi-coding", "minimax"] },
      { name: "minimax-only", provider: "anthropic", fallbacks: ["minimax"] },
    ],
  },
  {
    name: "ezio",
    profiles: [
      { name: "darndest-builder", provider: "anthropic", fallbacks: ["minimax", "kimi-coding"] },
      { name: "main-one", provider: "minimax", fallbacks: ["kimi-coding"] },
    ],
  },
];

describe("what a row's remove would touch", () => {
  it("counts the profiles and names the machines the confirmation asks about", () => {
    const plan = removalPlan(machines, "minimax");
    expect(plan.profiles).toBe(3);
    expect(plan.machines).toEqual(["altair", "ezio"]);
    expect(removalQuestion(plan, "MiniMax")).toBe("Remove MiniMax from the fallbacks of 3 agents on altair and ezio?");
  });

  it("names the profiles that would have no fallback left", () => {
    const plan = removalPlan(machines, "minimax");
    expect(plan.empty).toEqual([{ machine: "altair", name: "minimax-only" }]);
    expect(emptyNote(plan)).toBe("Left with no fallback: minimax-only.");
  });

  it("names a profile once, however many machines it is on", () => {
    const twice = [
      { name: "altair", profiles: [{ name: "solo", provider: "anthropic", fallbacks: ["minimax"] }] },
      { name: "ezio", profiles: [{ name: "solo", provider: "anthropic", fallbacks: ["minimax"] }] },
    ];
    expect(emptyNote(removalPlan(twice, "minimax"))).toBe("Left with no fallback: solo.");
  });

  it("refuses a provider that is a profile's main provider, and names those profiles", () => {
    const plan = removalPlan(machines, "minimax");
    expect(plan.blocked).toEqual([{ machine: "ezio", name: "main-one" }]);
    expect(removalRefusal(plan, "MiniMax")).toContain("main provider of main-one");
  });

  it("refuses a provider no profile names, and one a profile only uses as its main provider", () => {
    expect(removalRefusal(removalPlan(machines, "grok"), "Grok")).toContain("nothing to remove");
    const main = [{ name: "ezio", profiles: [{ name: "main-one", provider: "minimax", fallbacks: [] }] }];
    const plan = removalPlan(main, "minimax");
    expect(plan.providers).toEqual(["minimax"]);
    expect(removalRefusal(plan, "MiniMax")).toContain("main provider of main-one");
  });

  it("catches every name a claude login is written under, so the row and the files agree", () => {
    const claude = [
      {
        name: "altair",
        profiles: [
          { name: "a", provider: "claude-subscription-directsdk-experimental", fallbacks: ["kimi-coding"] },
          { name: "b", provider: "nous", fallbacks: ["claude-sdk"] },
        ],
      },
    ];
    const plan = removalPlan(claude, providerSlug("claude-sdk"));
    expect(plan.profiles).toBe(2);
    expect(plan.providers).toEqual(["claude-sdk", "anthropic"]);
    expect(plan.named).toBe(1);
    expect(plan.blocked).toEqual([{ machine: "altair", name: "a" }]);
  });

  it("finds nothing to remove on a machine that was not read", () => {
    expect(removalPlan([{ name: "ezio" }], "minimax").profiles).toBe(0);
  });
});

describe("the write reaches a machine", () => {
  const script = path.join(ROOT, "fallbacks.py");

  it("as one word per argument over ssh, so a name a machine reported cannot run a command", () => {
    const { cmd, input } = pythonOver({ name: "ezio", ssh: "div@ezio" } as any, script, [
      "remove",
      "kimi; rm -rf ~",
      "a'b",
    ]);
    expect(cmd.slice(-3)).toEqual(["'remove'", "'kimi; rm -rf ~'", `'a'\\''b'`]);
    expect(cmd[cmd.length - 4]).toBe("-");
    expect(input).toContain("fallback_providers");
  });

  it("as a plain argument on this machine, where no shell reads the line", () => {
    const { cmd, input } = pythonOver({ name: "this machine" } as any, script, ["remove", "minimax"]);
    expect(cmd).toEqual(["python3", script, "remove", "minimax"]);
    expect(input).toBeUndefined();
  });
});
