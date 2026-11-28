#!/usr/bin/env python3
"""Print, as JSON, what collect.py's inbox reader says about one case on stdin (collector#250).

`tests/inbox.test.ts` drives this: a case holds the files to write into a throwaway home, under `inbox/`, so the
reading a machine does is tested without James's own `~/.hermes/inbox`. By hand:

    printf '%s' '{"files": {"inbox/signal.jsonl": {"content": "{\\"text\\": \\"a message\\"}\\n"}}}' \\
      | python3 tests/inbox.driver.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect


def main():
    case = json.load(sys.stdin)
    home = tempfile.mkdtemp()
    for rel, spec in (case.get("files") or {}).items():
        path = os.path.join(home, ".hermes", rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(spec.get("content", ""))
    print(json.dumps(collect.inbox_rows(home=home, tail=case.get("tail", collect.INBOX_TAIL))))


if __name__ == "__main__":
    main()
