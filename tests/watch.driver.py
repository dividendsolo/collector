#!/usr/bin/env python3
"""Print, as JSON, what collect.py's `watch` reader says about one case on stdin (collector#54).

`tests/watch.test.ts` drives this: a case holds the watch entries, a fixture `ps` list, fixture `launchctl list`
output per label, and files to write into a throwaway home, so the reading a machine does is tested without a
process, a launchd job or a file of its own. By hand:

    echo '{"entries": [{"name": "Backup", "heartbeat": "~/beat", "idle_after": 600}],
           "files": {"beat": {"age_s": 900}}}' | python3 tests/watch.driver.py
"""
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import collect  # noqa: E402  (the app's own reader, imported once the repo root is on the path)


def write_files(case, home, now):
    """The case's files, written into the throwaway home: `content` as given, and `age_s` as the mtime an idle
    heartbeat or an old log has. The age is measured back from the case's own `now`, not from this machine's
    clock, so a fixture reads the same on every machine and at every hour."""
    for rel, spec in (case.get("files") or {}).items():
        path = os.path.join(home, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(spec.get("content", ""))
        if spec.get("age_s") is not None:
            when = now.timestamp() - spec["age_s"]
            os.utime(path, (when, when))


def launchd_reader(case):
    """What `launchctl list <label>` answers in this case: the label's own dictionary, or launchd not knowing it
    (exit 113), which a label left out of the fixtures stands for."""
    fixtures = case.get("launchd") or {}
    if not fixtures:
        return None

    def read(label):
        spec = fixtures.get(label)
        return (False, "") if spec is None else (spec.get("ok", True), spec.get("out", ""))

    return read


def main():
    case = json.load(sys.stdin)
    home = tempfile.mkdtemp()
    now = datetime.datetime.fromisoformat(case["now"])
    # `~` in an entry is this case's own home, the way it is the user's on a machine.
    os.environ["HOME"] = home
    write_files(case, home, now)
    if case.get("ok_exits") is not None:
        collect.OK_EXITS = case["ok_exits"]
    rows = collect.watch_rows(
        now,
        entries=case["entries"],
        ps_out=case.get("ps", ""),
        jobs=launchd_reader(case),
        self_pid=case.get("self_pid"),
    )
    print(json.dumps(rows))


if __name__ == "__main__":
    main()
