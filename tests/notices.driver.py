#!/usr/bin/env python3
"""Print, as JSON, what collect.py's `notices` reader says about one case on stdin (collector#82).

`tests/notices.test.ts` drives this: a case holds the files to write into a throwaway home, under `notices/`, and the
`now` they are read against, so the reading a machine does is tested without James's own `~/.hermes/notices`. By hand:

    echo '{"now": "2026-11-09T12:00:00-05:00",
           "files": {"notices/directory-listings.jsonl": {"content": "{\\"text\\": \\"a listing\\"}"}}}' \
      | python3 tests/notices.driver.py
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def main():
    case = json.load(sys.stdin)
    home = tempfile.mkdtemp()
    now = datetime.datetime.fromisoformat(case["now"])
    for rel, spec in (case.get("files") or {}).items():
        # A case names its files the way the reader finds them: `notices/<job>.jsonl` under the case's home's .hermes.
        path = os.path.join(home, ".hermes", rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(spec.get("content", ""))
    rows = collect.notices_rows(now, home=home, keep_s=case.get("keep_s", collect.NOTICE_KEEP_S))
    print(json.dumps(rows))


if __name__ == "__main__":
    main()
