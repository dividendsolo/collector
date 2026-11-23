import { spawn } from "node:child_process";
import type { Machine } from "./config";

const PROVIDERS = new Set(["nous"]);
const NAME = /^[a-z0-9-]+$/;
const SIGN_IN = (provider: string, machine: string) =>
  `~/.local/bin/hermes auth add ${provider} --type oauth --no-browser --timeout 600 && ` +
  `printf '%s\\n' '${JSON.stringify({ resolved: true, machine, provider }).replace(/":/g, '": ').replace(/,"/g, ', "')}' >> ~/.hermes/notices/model-login.jsonl`;
const LINK = /https:\/\/portal\.nousresearch\.com\/[^\s"'<>]+/;

export function loginCommand(machine: Machine, provider: string): string[] | null {
  if (!PROVIDERS.has(provider) || !NAME.test(machine.name)) return null;
  if (!machine.ssh) return ["/bin/sh", "-c", SIGN_IN(provider, machine.name)];
  return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", machine.ssh, SIGN_IN(provider, machine.name)];
}

export function loginLink(output: string): string | null {
  return LINK.exec(output)?.[0] ?? null;
}

export type LoginStart = { ok: boolean; link?: string; signedIn?: boolean; why?: string };

export function startLogin(cmd: string[], waitMs = 20_000): Promise<LoginStart> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const child = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const finish = (r: LoginStart) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners("data");
      child.stderr?.removeAllListeners("data");
      child.stdout?.resume();
      child.stderr?.resume();
      child.unref();
      resolve(r);
    };
    const read = (chunk: Buffer) => {
      out += chunk.toString();
      const link = loginLink(out);
      if (link) finish({ ok: true, link });
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (e) => finish({ ok: false, why: e.message }));
    child.on("exit", (code) =>
      finish(
        code === 0
          ? { ok: true, signedIn: true }
          : { ok: false, why: out.trim().split("\n").pop()?.slice(0, 200) || "the sign-in ended" },
      ),
    );
    const timer = setTimeout(() => finish({ ok: false, why: "no approval link within 20 s" }), waitMs);
  });
}
