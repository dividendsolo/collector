#!/usr/bin/env python3
"""Print, as JSON, what collect.py's Claude Code and Codex helpers say about one case on stdin.

`tests/tools.test.ts` drives this: a case holds a fixture `ps` list and fixture folders, so the parsing the reader
does on a machine is tested without a running session. By hand:

    echo '{"fn": "place", "cwd": "/home/me/code/x", "branch": "agent/7", "root": "/home/me/code/x"}' \
      | python3 tests/tools.driver.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def facts_of(case):
    """pid -> (folder, branch, top level), the facts collect.py reads from the machine."""
    return {pid: (f.get("cwd"), f.get("branch"), f.get("root")) for pid, f in case.get("facts", {}).items()}


def models_of(case):
    """(tool, folder) -> {"model": ...}, what the tools' own session files hold."""
    return {(tool, cwd): model for tool, cwd, model in case.get("models", [])}


def main():
    case = json.load(sys.stdin)
    fn = case["fn"]
    if fn == "rows":
        out = collect.tool_rows(case["ps"], facts_of(case), models_of(case))
    elif fn == "place":
        out = collect.session_place(case.get("cwd"), case.get("branch"), case.get("root"))
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
