#!/usr/bin/env python3
"""Change the fallback provider chain in the Hermes profiles on this machine (collector#218).

Collector sends this file over ssh the way it sends collect.py, and runs it on the machine it asks:

    ssh <host> python3 - remove <provider> [<provider> ...]
    ssh <host> python3 - add <provider> <model>

Every Hermes config.yaml on the machine — the default one at ~/.hermes and each ~/.hermes/profiles/*/ — keeps
everything but its own fallback_providers block: the entries move, the rest of the file's bytes do not. The
block's own order is kept, an entry naming a provider already in the chain is not added twice, and a dated
copy of each file is written beside it before that day's first change. One JSON object comes back:

    {"changed": [{"profile", "file", "backup", "entries"}],
     "skipped": [{"profile", "why"}], "errors": [{"profile", "why"}]}

The script never touches a profile's model.provider: only the fallback chain. An empty chain is written the
way Hermes's own default config writes it, `fallback_providers: []`.
"""
import glob
import json
import os
import re
import shutil
import sys
import tempfile
import time

HERMES = os.path.expanduser("~/.hermes")
KEY = re.compile(r"^fallback_providers:[ \t]*([^\n]*)\n", re.M)
MODEL_BLOCK = re.compile(r"^model:\n(?:[ \t]+.*\n?)*", re.M)
ENTRY = re.compile(r"^([ \t]*)-[ \t]*provider:[ \t]*(\S+)[ \t]*$")
MODEL_LINE = re.compile(r"^[ \t]+model:[ \t]*(\S+)[ \t]*$")
NAME = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
DATE = "%Y-%m-%d"


def profiles():
    """Every Hermes profile on this machine: the default one at ~/.hermes, then the named ones."""
    found = [("default", os.path.join(HERMES, "config.yaml"))]
    for d in sorted(glob.glob(os.path.join(HERMES, "profiles/*/"))):
        found.append((os.path.basename(d.rstrip("/")), os.path.join(d, "config.yaml")))
    return [(name, path) for name, path in found if os.path.exists(path)]


def split_block(block):
    """The key's own lines, as `(head, entries)`: the lines before the first `- provider:` one, and one
    `[provider, model, lines]` per entry, each holding the entry's own lines exactly as they are."""
    head = []
    out = []
    for line in block.splitlines(keepends=True):
        head_line = ENTRY.match(line.rstrip("\n"))
        if head_line:
            out.append([head_line.group(2), None, [line]])
            continue
        if out:
            field = MODEL_LINE.match(line.rstrip("\n"))
            if field and out[-1][1] is None:
                out[-1][1] = field.group(1)
            out[-1][2].append(line)
        else:
            head.append(line)
    return "".join(head), out


def read(text):
    """The file's fallback key as `(start, end, inline, block)`, or None when the key is not in the file."""
    m = KEY.search(text)
    if not m:
        return None
    start, end = m.start(), m.end()
    block = ""
    for line in text[end:].splitlines(keepends=True):
        if line[:1] not in (" ", "\t"):
            break
        block += line
    return start, end + len(block), m.group(1).strip(), block


def chain(text):
    """The fallback entries the file's own text holds, in order."""
    got = read(text)
    return split_block(got[3])[1] if got else []


def unknown(inline):
    """A value that is neither an empty list nor a block of entries: refuse it rather than rewrite it."""
    return bool(inline) and inline != "[]"


def entry_lines(provider, model):
    return "  - provider: %s\n    model: %s\n" % (provider, model)


def remove(text, names):
    """`text` without the fallback entries naming a provider in `names`, or `(None, why)` when nothing moves."""
    got = read(text)
    if got is None:
        return None, "no fallback_providers key"
    start, end, inline, block = got
    if unknown(inline):
        return None, "fallback_providers is not a list this script can change"
    head, entries = split_block(block)
    kept = [e for e in entries if e[0] not in names]
    if len(kept) == len(entries):
        return None, "no such fallback provider"
    if not kept:
        return text[:start] + "fallback_providers: []\n" + text[end:], None
    return text[:start] + "fallback_providers:\n" + head + "".join("".join(e[2]) for e in kept) + text[end:], None


def add(text, provider, model):
    """`text` with one fallback entry appended, or `(None, why)` when the chain already names it."""
    entry = entry_lines(provider, model)
    got = read(text)
    if got is None:
        m = MODEL_BLOCK.search(text)
        at = m.end() if m else 0
        return text[:at] + "fallback_providers:\n" + entry + text[at:], None
    start, end, inline, block = got
    if unknown(inline):
        return None, "fallback_providers is not a list this script can change"
    head, entries = split_block(block)
    if any(e[0] == provider and e[1] == model for e in entries):
        return None, "already a fallback of this profile"
    if not entries:
        return text[:start] + "fallback_providers:\n" + entry + text[end:], None
    return (
        text[:start]
        + "fallback_providers:\n"
        + head
        + "".join("".join(e[2]) for e in entries)
        + entry
        + text[end:],
        None,
    )


def save(path, text):
    """Write `text` over the file, with the day's first copy of the file left beside it."""
    backup = "%s.%s" % (path, time.strftime(DATE))
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
    handle, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".collector-")
    with os.fdopen(handle, "w") as f:
        f.write(text)
    os.replace(tmp, path)
    return backup


def change(action, provider, model, names):
    changed, skipped, errors = [], [], []
    for name, path in profiles():
        try:
            with open(path) as f:
                text = f.read()
            if action == "add":
                new, why = add(text, provider, model)
            else:
                new, why = remove(text, names)
        except OSError as e:
            errors.append({"profile": name, "why": str(e)[:200]})
            continue
        if new is None:
            skipped.append({"profile": name, "why": why})
            continue
        try:
            backup = save(path, new)
        except OSError as e:
            errors.append({"profile": name, "why": str(e)[:200]})
            continue
        entries = len(chain(new))
        changed.append({"profile": name, "file": path, "backup": backup, "entries": entries})
    return {"changed": changed, "skipped": skipped, "errors": errors}


def main():
    args = sys.argv[1:]
    action = args[0] if args else ""
    if action == "remove" and len(args) > 1 and all(NAME.match(n) for n in args[1:]):
        answer = change("remove", "", "", set(args[1:]))
    elif action == "add" and len(args) == 3 and NAME.match(args[1]) and MODEL.match(args[2]):
        answer = change("add", args[1], args[2], set())
    else:
        answer = {"error": "usage: remove <provider> [<provider> ...] | add <provider> <model>"}
    print(json.dumps(answer))


main()
