import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loginCommand, loginLink, startLogin } from "@/lib/server/model-login";
import { warnings } from "@/lib/server/warnings";

const ROOT = process.cwd();
const NOW = "2026-11-23T14:00:00-05:00";

function read(content: string) {
  return JSON.parse(
    execFileSync("python3", [path.join(ROOT, "tests", "notices.driver.py")], {
      cwd: ROOT,
      input: JSON.stringify({ now: NOW, files: { "notices/model-login.jsonl": { content } } }),
      encoding: "utf8",
    }),
  );
}

const refused = {
  at: "2026-11-23T18:06:53Z",
  key: "model-login:ezio:nous:2026-11-23T18:06:53Z:a1b2c3",
  level: "error",
  machine: "ezio",
  provider: "nous",
  text: "Nous refused the login on ezio (echo-form-builder): agents fall back to other models until you sign in again",
};
const jsonl = (...lines: object[]) => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
const base = { github: {}, cfg: {}, services: [], domains: [], ticketsError: null, x: null, ai: [] } as any;

describe("a refused model login in Priority tasks", () => {
  it("reads the line with the machine and provider it names", () => {
    const [row] = read(jsonl(refused));
    expect(row.login).toEqual({ machine: "ezio", provider: "nous" });
    expect(row.level).toBe("error");
  });

  it("is a red row in the first group with a button that signs in on that machine", () => {
    const rows = read(jsonl(refused));
    const [w] = warnings({ ...base, machines: [{ name: "ezio", notices: rows }] });
    expect(w.level).toBe("error");
    expect(w.group).toBe("cant-work");
    expect(w.text).toContain("Nous refused the login on ezio");
    expect(w.login).toEqual({ machine: "ezio", provider: "nous", label: "Sign in to Nous on ezio" });
    expect(w.ack).toBeUndefined();
  });

  it("is gone once a sign-in on that machine resolves it, and a later refusal shows again", () => {
    const signedIn = { resolved: true, machine: "ezio", provider: "nous" };
    expect(read(jsonl(refused, signedIn))).toEqual([]);
    expect(read(jsonl(refused, { ...signedIn, machine: "altair" }))).toHaveLength(1);
    const again = { ...refused, key: "model-login:ezio:nous:2026-11-23T19:00:00Z:d4e5f6" };
    expect(read(jsonl(refused, signedIn, again)).map((r: { key: string }) => r.key)).toEqual([again.key]);
  });

  it("starts the Nous device sign-in on that machine, and resolves its notices when it succeeds", () => {
    const signIn =
      "~/.local/bin/hermes auth add nous --type oauth --no-browser --timeout 600 && " +
      `printf '%s\\n' '{"resolved": true, "machine": "ezio", "provider": "nous"}' >> ~/.hermes/notices/model-login.jsonl`;
    expect(loginCommand({ name: "ezio", ssh: "div@ezio" }, "nous")).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "div@ezio",
      signIn,
    ]);
    expect(loginCommand({ name: "altair" }, "nous")?.slice(0, 2)).toEqual(["/bin/sh", "-c"]);
  });

  it("refuses a provider it does not know, so nothing from a file reaches a shell", () => {
    expect(loginCommand({ name: "ezio", ssh: "div@ezio" }, "nous; rm -rf ~")).toBeNull();
    expect(loginCommand({ name: "x'; rm -rf ~; '", ssh: "div@ezio" }, "nous")).toBeNull();
  });

  it("finds the approval page in the sign-in's output, and only a Nous portal address", () => {
    const out =
      "Starting Hermes login via Nous Portal...\nTo continue:\n  1. Open: https://portal.nousresearch.com/manage-subscription?user_code=6CBQ-BP2G\n  2. If prompted, enter code: 6CBQ-BP2G\n";
    expect(loginLink(out)).toBe("https://portal.nousresearch.com/manage-subscription?user_code=6CBQ-BP2G");
    expect(loginLink("Open: javascript:alert(1)")).toBeNull();
    expect(loginLink("Open: https://evil.example/manage-subscription")).toBeNull();
  });

  it("hands back the approval link as soon as the sign-in prints it", async () => {
    const r = await startLogin([
      "/bin/sh",
      "-c",
      "echo '  1. Open: https://portal.nousresearch.com/manage-subscription?user_code=AB12-CD34'; sleep 5",
    ]);
    expect(r).toEqual({ ok: true, link: "https://portal.nousresearch.com/manage-subscription?user_code=AB12-CD34" });
  });

  it("says signed in when the sign-in ends well with no approval needed", async () => {
    const r = await startLogin(["/bin/sh", "-c", "echo 'Imported nous OAuth credentials'; exit 0"]);
    expect(r).toEqual({ ok: true, signedIn: true });
  });

  it("says why when the sign-in fails with no link", async () => {
    const r = await startLogin(["/bin/sh", "-c", "echo 'portal unreachable'; exit 1"]);
    expect(r).toEqual({ ok: false, why: "portal unreachable" });
  });
});
