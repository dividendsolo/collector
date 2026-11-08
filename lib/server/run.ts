import { spawn } from "node:child_process";
import { attemptsFor, backoffDelay, type RetryOptions } from "./retry";

export interface RunResult {
  ok: boolean;
  stdout: string;
  error: string | null;
}

export interface RunOptions extends RetryOptions {
  /** The process is killed with SIGKILL after this many seconds. Default 20. */
  timeout?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

function once(cmd: string[], opts: RunOptions): Promise<RunResult> {
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

/**
 * Run a command with no shell. stdin is optional; the process is killed after `timeout` seconds (20 unless given),
 * so no command — a hung `gh`, a machine that stopped answering ssh — can hold a read open (repo standard S2).
 * `attempts` is how many tries this call may take: 1 (the default here) means one, no retry. Give it more only for
 * a read that can be asked twice without a consequence; a call that starts something must be left at one try.
 */
export async function runText(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const attempts = attemptsFor(opts.attempts, 1);
  let last: RunResult = { ok: false, stdout: "", error: "no attempt made" };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await once(cmd, opts);
    if (last.ok) return last;
    if (attempt < attempts) await new Promise<void>((r) => setTimeout(r, backoffDelay(attempt + 1, opts)));
  }
  return last;
}

/**
 * Run a command that prints JSON: [data, null] on success, [null, error] otherwise. Every call through here is a
 * read — `gh api`, a machine read over ssh, the Nous portal script — so it gets one retry by default, with the same
 * capped, jittered backoff as an HTTP call. Pass `attempts: 1` where a second try would be wrong.
 */
export async function run<T = any>(cmd: string[], opts: RunOptions = {}): Promise<[T | null, string | null]> {
  const r = await runText(cmd, { attempts: 2, ...opts });
  if (!r.ok) return [null, r.error];
  try {
    return [JSON.parse(r.stdout) as T, null];
  } catch (e) {
    return [null, String((e as Error).message).slice(0, 300)];
  }
}
