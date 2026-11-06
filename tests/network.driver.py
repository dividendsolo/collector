#!/usr/bin/env python3
"""Print, as JSON, what collect.py's network reader says about one case on stdin (collector#65).

`tests/network.test.ts` drives this: a case holds the text `ss` or `lsof` prints, or the socket rows themselves,
so the marks a machine's reader works out are tested on the exact lines those tools write, without a socket of our
own and without a host name or port of ours in the repo. By hand:

    echo '{"fn": "ss", "text": "tcp LISTEN 0 128 0.0.0.0:5432 0.0.0.0:*"}' | python3 tests/network.driver.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def main():
    case = json.load(sys.stdin)
    fn = case["fn"]
    if fn == "ss":
        out = collect.parse_ss(case["text"])
    elif fn == "lsof":
        out = collect.parse_lsof(case["text"])
    elif fn == "mark":
        out = collect.mark_of(case["port"], case["address"], case.get("allow") or collect.DEFAULT_ALLOW)
    elif fn == "local":
        out = collect.is_local_address(case["address"])
    elif fn == "ssh":
        out = collect.sshd_flags(case["text"])
    elif fn == "section":
        out = collect.network_section(
            case["sockets"], ssh_text=case.get("ssh_text"), ssh_source=case.get("ssh_source"),
            allow=case.get("allow"),
        )
    else:
        raise SystemExit(f"unknown fn: {fn}")
    json.dump(out, sys.stdout)
    print()


if __name__ == "__main__":
    main()
