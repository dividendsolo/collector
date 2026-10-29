#!/usr/bin/env python3
"""Print, as JSON, what collect.py's worktree, Claude Code and Codex helpers say about one case on stdin.

`tests/tools.test.ts` drives this: a case holds a fixture `ps` list and fixture folders, so the parsing the reader
does on a machine is tested without a running session. By hand:

    echo '{"fn": "place", "cwd": "/home/me/code/x", "branch": "agent/7", "root": "/home/me/code/x"}' \
      | python3 tests/tools.driver.py
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def facts_of(case):
    """pid -> (folder, branch, top level), the facts collect.py reads from the machine."""
    return {pid: (f.get("cwd"), f.get("branch"), f.get("root")) for pid, f in case.get("facts", {}).items()}


def models_of(case):
    """(tool, folder) -> {"model": ...}, what the tools' own session files hold."""
    return {(tool, cwd): model for tool, cwd, model in case.get("models", [])}


def cwd_without_proc(case):
    """The folder process_cwd reads where there is no /proc — macOS, where it runs lsof. /proc is hidden for the call,
    so the branch a Mac takes is the branch that runs, and the case carries real `lsof -a -p <pid> -d cwd -Fn` output,
    or the error of a machine with no lsof at all."""
    real_exists, real_run = os.path.exists, subprocess.run
    os.path.exists = lambda p: False if str(p).startswith("/proc/") else real_exists(p)

    def run(*args, **kwargs):
        if case.get("lsof_error"):
            raise OSError(case["lsof_error"])
        return subprocess.CompletedProcess(args[0] if args else "", 0, case.get("lsof") or "", "")

    subprocess.run = run
    try:
        return collect.process_cwd(case["pid"])
    finally:
        os.path.exists, subprocess.run = real_exists, real_run


def main():
    case = json.load(sys.stdin)
    fn = case["fn"]
    if fn == "rows":
        out = collect.tool_rows(case["ps"], facts_of(case), models_of(case), parents=case.get("parents", {}))
    elif fn == "worktrees":
        out = collect.worktree_rows(
            case["ps"],
            steps=case.get("steps", []),
            verifying={tuple(k) for k in case.get("verifying", [])},
            ports=case.get("ports", {}),
            children=case.get("children", {}),
        )
    elif fn == "sessions":
        out = collect.tool_sessions(case["ps"], skip=set(case.get("skip", [])), parents=case.get("parents", {}))
    elif fn == "droid":
        pids, rows = collect.lab_droid(case["ps"])
        out = {"pids": [[pid, secs] for pid, secs in pids], "rows": rows}
    elif fn == "place":
        out = collect.session_place(case.get("cwd"), case.get("branch"), case.get("root"))
    elif fn == "cwd_lsof":
        out = cwd_without_proc(case)
    elif fn == "claude_model":
        out = collect.claude_model(case["cwd"], case["home"])
    elif fn == "codex_model":
        out = collect.codex_model(case["cwd"], case["home"])
    else:
        raise SystemExit(f"unknown fn: {fn}")
    json.dump(out, sys.stdout)
    print()


if __name__ == "__main__":
    main()
