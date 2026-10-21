import { spawn } from "node:child_process";

export interface RunResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

/** Run a command with no shell. stdin is optional; the process is killed after `timeout` seconds. */
export function runText(cmd: string[], opts: { timeout?: number; input?: string; env?: NodeJS.ProcessEnv } = {}) {
  return new Promise<RunResult>((resolve) => {
    let out = "";
    let err = "";
    let done = false;
    const finish = (r: RunResult) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd[0], cmd.slice(1), { env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, stdout: "", error: String((e as Error).message).slice(0, 300) });
      return;
    }
    const timer = setTimeout(
      () => {
        child.kill("SIGKILL");
        finish({ ok: false, stdout: out, error: `timed out after ${opts.timeout ?? 20} s` });
      },
      (opts.timeout ?? 20) * 1000,
    );
    child.stdout?.setEncoding("utf8").on("data", (d: string) => {
      out += d;
    });
    child.stderr?.setEncoding("utf8").on("data", (d: string) => {
      err += d;
    });
    child.on("error", (e) => finish({ ok: false, stdout: "", error: String(e.message).slice(0, 300) }));
    child.on("close", (code) =>
      finish(
        code === 0
          ? { ok: true, stdout: out, error: null }
          : { ok: false, stdout: out, error: (err.trim() || `exit ${code}`).slice(0, 300) },
      ),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.input ?? "");
  });
}

/** Run a command that prints JSON: [data, null] on success, [null, error] otherwise. */
export async function run<T = any>(
  cmd: string[],
  opts: { timeout?: number; input?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<[T | null, string | null]> {
  const r = await runText(cmd, opts);
  if (!r.ok) return [null, r.error];
  try {
    return [JSON.parse(r.stdout) as T, null];
  } catch (e) {
    return [null, String((e as Error).message).slice(0, 300)];
  }
}
