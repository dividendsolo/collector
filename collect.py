#!/usr/bin/env python3
"""Print one JSON snapshot of this machine's cron jobs and running agents.

The server runs it locally and on each remote machine over `ssh <host> python3 - '<config>' < collect.py`,
so it uses the standard library only. It reads Hermes's cron files (~/.hermes), launchd (macOS),
ps, docker, and git, and changes nothing.
"""
import glob
import json
import os
import platform
import plistlib
import re
import socket
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

HOME = os.path.expanduser("~")
HERMES = os.path.join(HOME, ".hermes")
CONFIG = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
# launchd jobs whose label starts with one of these show in the table (macOS only).
LAUNCHD_PREFIXES = tuple(CONFIG.get("launchd_prefixes") or ())
# launchd exit codes that mean success for one job: {label: {code: text}}.
OK_EXITS = CONFIG.get("ok_exits") or {}
WORK = CONFIG.get("work_script") or {}
# The work script's own log; each start writes "=== tick <local time> ===". Optional.
WORK_LOG = os.path.expanduser(WORK["log"]) if WORK.get("log") else None
WORK_SCRIPT = WORK.get("name") or "work script"
# Docker label prefix the verify tool puts on its containers (<prefix>.run, <prefix>.commit). Optional.
VERIFY_LABEL = CONFIG.get("verify_label")
# The folder that holds the repos whose card worktrees the verify runs are matched to.
REPOS = os.path.expanduser(CONFIG.get("repos_dir") or "~/code")


def cron_dirs():
    yield "default", os.path.join(HERMES, "cron")
    for d in sorted(glob.glob(os.path.join(HERMES, "profiles/*/cron"))):
        yield d.split("/")[-2], d


def run_counts(db, now):
    """job_id -> (runs in 1h, runs in 24h, failures in 24h), from Hermes's executions table."""
    if not os.path.exists(db):
        return {}
    since, hour = now - timedelta(hours=24), now - timedelta(hours=1)
    counts = {}
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        # claimed_at is ISO with mixed offsets, so filter loosely in SQL and exactly here
        rows = con.execute("select job_id, claimed_at, status from executions where claimed_at >= ?",
                           ((since - timedelta(hours=14)).strftime("%Y-%m-%d"),))
        for job_id, claimed, status in rows:
            try:
                at = datetime.fromisoformat(claimed)
            except ValueError:
                continue
            if at.tzinfo is None:
                at = at.astimezone()
            if at < since:
                continue
            h, d, f = counts.get(job_id, (0, 0, 0))
            counts[job_id] = (h + (at >= hour), d + 1, f + (status == "failed"))
        con.close()
    except sqlite3.Error:
        pass
    return counts


def hermes_jobs(now):
    jobs = []
    for profile, d in cron_dirs():
        path = os.path.join(d, "jobs.json")
        if not os.path.exists(path):
            continue
        data = json.load(open(path))
        counts = run_counts(os.path.join(d, "executions.db"), now)
        for j in data.get("jobs", data) if isinstance(data, dict) else data:
            h, day, fails = counts.get(j.get("id"), (0, 0, 0))
            jobs.append({
                "scheduler": "Hermes" if profile == "default" else f"Hermes ({profile})",
                "id": j.get("id"),
                "name": j.get("name"),
                "schedule": (j.get("schedule") or {}).get("display") or j.get("schedule_display"),
                "state": j.get("state"),
                "enabled": bool(j.get("enabled")),
                "script": j.get("script"),
                "agent": not j.get("no_agent") and not j.get("script"),
                "last_run_at": j.get("last_run_at"),
                "last_status": j.get("last_status"),
                "last_error": (j.get("last_error") or j.get("last_delivery_error") or "")[:300],
                "next_run_at": j.get("next_run_at"),
                "failure_streak": j.get("failure_streak") or 0,
                "runs_1h": h,
                "runs_24h": day,
                "fails_24h": fails,
            })
    return jobs


def launchd_jobs():
    if platform.system() != "Darwin":
        return []
    exits = {}
    out = subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
    for line in out.splitlines()[1:]:
        pid, status, label = (line.split("\t") + ["", "", ""])[:3]
        exits[label] = (pid, status)
    jobs = []
    for path in sorted(glob.glob(os.path.join(HOME, "Library/LaunchAgents/*.plist"))):
        label = os.path.basename(path)[:-6]
        if not label.startswith(LAUNCHD_PREFIXES):
            continue
        try:
            p = plistlib.load(open(path, "rb"))
        except Exception:
            continue
        if p.get("StartInterval"):
            schedule = f"every {p['StartInterval'] // 60} min"
        elif p.get("StartCalendarInterval"):
            schedule = json.dumps(p["StartCalendarInterval"])
        elif p.get("KeepAlive"):
            schedule = "always on"
        else:
            schedule = "at login"
        pid, status = exits.get(label, ("", None))
        args = p.get("ProgramArguments") or [p.get("Program", "")]
        jobs.append({
            "scheduler": "launchd",
            "id": label,
            "name": label.split(".", 2)[-1],
            "schedule": schedule,
            "state": "not loaded" if status is None else ("running" if pid not in ("", "-") else "scheduled"),
            "enabled": status is not None,
            "script": os.path.basename(args[-1].split()[0]) if args else "",
            "agent": False,
            "last_run_at": None,
            "last_status": None if status is None else ("ok" if status == "0" or pid not in ("", "-") else OK_EXITS.get(label, {}).get(status) or f"exit {status}"),
            "last_error": "",
            "next_run_at": None,
            "failure_streak": 0,
            "runs_1h": None,
            "runs_24h": None,
            "fails_24h": None,
        })
    return jobs


def seconds(etime):
    """ps etime ([[dd-]hh:]mm:ss) -> seconds."""
    days, _, rest = etime.strip().rpartition("-")
    parts = [int(x) for x in rest.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return int(days or 0) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2]


def verify_runs():
    """Verify runs going on now, from the verify tool's Docker labels: [(commit, feature, seconds)]."""
    if not VERIFY_LABEL:
        return []
    try:
        out = subprocess.run(["docker", "ps", "--filter", f"label={VERIFY_LABEL}.run", "--format",
                              f'{{{{.Label "{VERIFY_LABEL}.run"}}}}|{{{{.Label "{VERIFY_LABEL}.commit"}}}}'],
                             capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        return []
    now = datetime.now(timezone.utc)
    runs = {}
    for line in out.splitlines():
        run, _, commit = line.partition("|")
        m = re.match(r"(.+)-[0-9a-f]{7}-(\d{8}T\d{6}Z)-", run)
        if m and commit:
            started = datetime.strptime(m.group(2), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            runs[run] = (commit, m.group(1), int((now - started).total_seconds()))
    return list(runs.values())


def running_agents():
    """One row per agent run: a Hermes agent working in a card worktree (<repo>/.worktrees/<build|review>-<card>).
    While a verify run is going on for the card's commit, the row shows that verify and its own time."""
    out = subprocess.run(["ps", "-axo", "etime=,command="], capture_output=True, text=True).stdout
    found = {}
    for line in out.splitlines():
        m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)", line)
        if not m:
            continue
        key = (m.group(1), m.group(2), int(m.group(3)))
        row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "seconds": 0, "type": "script", "name": None})
        row["seconds"] = max(row["seconds"], seconds(line.split(None, 1)[0]))
        profile = re.search(r"hermes\S* -p (\S+) chat", line)
        if profile:
            row.update(type="agent", name=profile.group(1))
    for row in found.values():
        # No Hermes agent in the worktree: the work script runs its own step there (the verify gate).
        row["name"] = row["name"] or WORK_SCRIPT
    verifies = verify_runs()
    if verifies:
        heads = {}
        for path in glob.glob(os.path.join(REPOS, "*/.worktrees/*-*")):
            m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)$", path)
            head = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            if m and head:
                heads[head] = (m.group(1), m.group(2), int(m.group(3)))
        for commit, feature, secs in sorted(verifies, key=lambda v: v[2]):
            key = heads.get(commit)
            if not key:
                continue
            row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "type": "script", "name": WORK_SCRIPT})
            # The newest verify for the card wins; the sort puts it last.
            row.update(kind="verify", feature=feature, seconds=secs)
    return [found[k] for k in sorted(found)]


def work_script_ticks(now_local):
    """Work-script starts in the last 10 minutes, from its own log (a script that starts itself never hits cron)."""
    if not WORK_LOG or not os.path.exists(WORK_LOG):
        return None
    with open(WORK_LOG, "rb") as f:
        f.seek(max(0, os.path.getsize(WORK_LOG) - 3_000_000))
        tail = f.read().decode(errors="ignore")
    since = (now_local - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
    return sum(1 for t in re.findall(r"=== tick (\S+ \S+) ===", tail) if t >= since)


def main():
    now = datetime.now(timezone.utc).astimezone()
    print(json.dumps({
        "host": socket.gethostname(),
        "tz": time.strftime("%Z"),
        "now": now.isoformat(),
        "jobs": hermes_jobs(now) + launchd_jobs(),
        "running": running_agents(),
        "work_ticks_10m": work_script_ticks(now.replace(tzinfo=None)),
    }))


if __name__ == "__main__":
    main()
