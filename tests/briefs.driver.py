#!/usr/bin/env python3
"""Print, as JSON, what collect.py's briefs readers say about one case on stdin (collector#64).

`tests/briefs.test.ts` drives this: a case holds the files of a Briefs folder under the writer's own names, and the
one brief to read whole, so the reading a machine does is tested without a folder of its own. By hand:

    printf '%s' '{"files": {"2026-11-08T141717Z-lead-watch-ab12cd.md": {"content": "---\\nbrief: Lead Watch\\n---\\n# Hi\\n"}},
                    "read": "2026-11-08T141717Z-lead-watch-ab12cd.md"}' | python3 tests/briefs.driver.py
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def main():
    case = json.load(sys.stdin)
    folder = tempfile.mkdtemp()
    outside = tempfile.mkdtemp()
    for name, spec in (case.get("files") or {}).items():
        if "link" in spec:
            # A symlink in the folder to a file outside it that holds `link` (collector#125).
            target = os.path.join(outside, name)
            with open(target, "w") as f:
                f.write(spec["link"])
            os.symlink(target, os.path.join(folder, name))
            continue
        if spec.get("fifo"):
            os.mkfifo(os.path.join(folder, name))
            continue
        with open(os.path.join(folder, name), "w") as f:
            f.write(spec.get("content", ""))
    print(
        json.dumps(
            {
                "rows": collect.briefs_read(folder),
                "one": collect.brief_file(case.get("read") or "", folder),
                "missing": collect.brief_file(case.get("missing") or "", folder),
            }
        )
    )


if __name__ == "__main__":
    main()
