#!/usr/bin/env python3
"""Print one JSON snapshot of this machine's cron jobs and running agents.

The server runs it locally and on each remote machine over `ssh <host> python3 - '<config>' < collect.py`,
so it uses the standard library only. It reads Hermes's cron files (~/.hermes), the foreman's host-broken
markers, launchd (macOS), this user's plain crontab, systemd timers, ps, docker, and git, and changes nothing.
"""
import glob
import hashlib
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
from contextlib import closing
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
# Where the work script says what it does on each card now: one JSON file per card with repo, card, step,
# since, and pid. Optional; without it a work-script row is named after its worktree (build, review).
WORK_STEPS = os.path.expanduser(WORK["steps"]) if WORK.get("steps") else None
# Docker label prefix the verify tool puts on its containers (<prefix>.run, <prefix>.commit). Optional.
VERIFY_LABEL = CONFIG.get("verify_label")
# The folder that holds the repos whose card worktrees the verify runs are matched to.
REPOS = os.path.expanduser(CONFIG.get("repos_dir") or "~/code")
# The foreman's scratch dir. One `host-broken-<repo>` marker (one line: the failing gate step and the base
# SHA) sits here while this machine cannot pass that repo's checks on its base branch (agent-stack#151).
FOREMAN = os.path.join(HERMES, "foreman")
HOST_BROKEN = "host-broken-"


def cron_dirs():
    yield "default", os.path.join(HERMES, "cron")
    for d in sorted(glob.glob(os.path.join(HERMES, "profiles/*/cron"))):
        yield d.split("/")[-2], d


def open_db(db):
    """Open a Hermes SQLite file to read. Older SQLite (macOS's /usr/bin/python3) cannot open a WAL file
    read-only when its -shm file is missing, so fall back to a normal open; only selects run on it."""
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        con.execute("select 1 from sqlite_master limit 1")
        return con
    except sqlite3.Error:
        return sqlite3.connect(db, timeout=2)


def run_counts(db, now):
    """job_id -> (runs in 1h, runs in 24h, failures in 24h), from Hermes's executions table."""
    if not os.path.exists(db):
        return {}
    since, hour = now - timedelta(hours=24), now - timedelta(hours=1)
    counts = {}
    try:
        con = open_db(db)
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


def recent_runs(db, keep=10):
    """job_id -> its last runs, newest first, from Hermes's executions table."""
    if not os.path.exists(db):
        return {}
    runs = {}
    try:
        with closing(open_db(db)) as con:
            rows = con.execute("""select job_id, claimed_at, started_at, finished_at, status, error, delivery_outcome from (
                select *, row_number() over (partition by job_id order by claimed_at desc) n from executions) where n <= ?""", (keep,))
            for job_id, claimed, started, finished, status, error, delivery in rows:
                runs.setdefault(job_id, []).append({"at": started or claimed, "finished": finished, "status": status,
                                                    "error": (error or "")[:300], "delivery": delivery})
    except sqlite3.Error:
        pass
    return runs


def read_text(path, limit=20000):
    """A script's source for the job page, or None when it is missing or not text."""
    try:
        if not os.path.isfile(path) or os.path.getsize(path) > 200000:
            return None
        with open(path, errors="replace") as f:
            return f.read(limit)
    except OSError:
        return None


def script_size(path):
    """The whole script's lines and characters, also when the page shows only its start."""
    text = read_text(path, 10**6) if path else None
    return {"script_chars": len(text), "script_lines": text.count("\n") + (not text.endswith("\n"))} if text else {}


def script_path(home, script):
    """Hermes runs a job's script from <HERMES_HOME>/scripts; a profile's home is its own folder."""
    if not script:
        return None
    script = os.path.expanduser(script.split()[0])
    if os.path.isabs(script):
        return script
    for base in (home, HERMES):
        path = os.path.join(base, "scripts", script)
        if os.path.exists(path):
            return path
    return os.path.join(home, "scripts", script)


def hermes_jobs(now):
    jobs = []
    for profile, d in cron_dirs():
        path = os.path.join(d, "jobs.json")
        if not os.path.exists(path):
            continue
        data = json.load(open(path))
        counts = run_counts(os.path.join(d, "executions.db"), now)
        history = recent_runs(os.path.join(d, "executions.db"))
        home = os.path.dirname(d)
        for j in data.get("jobs", data) if isinstance(data, dict) else data:
            h, day, fails = counts.get(j.get("id"), (0, 0, 0))
            spath = script_path(home, j.get("script"))
            skills = list(j.get("skills") or []) + ([j["skill"]] if j.get("skill") else [])
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
                # The job page shows the rest.
                "profile": profile,
                "schedule_raw": (j.get("schedule") or {}).get("expr") or (j.get("schedule") or {}).get("display"),
                "prompt": (j.get("prompt") or "")[:20000],
                "prompt_chars": len(j.get("prompt") or ""),
                "skills": skills,
                "model": j.get("model") or j.get("model_snapshot"),
                "provider": j.get("provider") or j.get("provider_snapshot"),
                "deliver": j.get("deliver"),
                "workdir": j.get("workdir"),
                "created_at": j.get("created_at"),
                "paused_reason": j.get("paused_reason"),
                "total_runs": (j.get("repeat") or {}).get("completed"),
                "script_path": spath,
                "script_body": read_text(spath) if spath else None,
                **script_size(spath),
                "runs": history.get(j.get("id"), []),
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
            "plist": path,
            "command": " ".join(args),
            "logs": list(dict.fromkeys(x for x in (p.get("StandardOutPath"), p.get("StandardErrorPath")) if x)),
            "script_path": next((a for a in args if a.startswith("/") and a.endswith((".sh", ".py", ".rb", ".js"))), None),
        })
        jobs[-1]["script_body"] = read_text(jobs[-1]["script_path"]) if jobs[-1]["script_path"] else None
        jobs[-1].update(script_size(jobs[-1]["script_path"]))
    return jobs


# Plain cron and systemd timers: what most machines are scheduled with when they are not on Hermes. Read only,
# and a machine that has neither (a Mac, a container) returns no rows rather than an error.

# A cron field's three-letter names: jan..dec, sun..sat (7 is Sunday as well as 0).
CRON_MONTHS = {n: i + 1 for i, n in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
CRON_DAYS = {n: i for i, n in enumerate("sun mon tue wed thu fri sat".split())}
# crontab's @-shortcuts, as the five fields they stand for. @reboot runs at boot: it has no next run.
CRON_MACROS = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}


def read_command(cmd, timeout=10):
    """One read-only command's output, or None when the tool is not on this machine, the command fails or it
    hangs. No tool is not an error: a Mac has no systemctl, and `crontab -l` exits 1 with no crontab."""
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout if done.returncode == 0 else None


def cron_numbers(field, low, high, names=None):
    """One cron field -> the numbers it matches, sorted. Reads *, */n, a-b, a-b/n, a,b, and a name where the
    field takes one. Raises ValueError on a field that is not a cron field, so a line that is not a crontab
    line is not shown as a job."""

    def one(text):
        text = text.strip().lower()
        if names and text[:3] in names:
            return names[text[:3]]
        return int(text)

    out = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, _, by = part.partition("/")
            step = int(by)
            if step < 1:
                raise ValueError(by)
        if part in ("*", "?"):
            first, last = low, high
        elif "-" in part:
            first, _, second = part.partition("-")
            first, last = one(first), one(second)
        else:
            first = last = one(part)
        out.update(range(first, last + 1, step))
    return sorted(n for n in out if low <= n <= high)


def cron_next(expr, now):
    """The next time five-field cron text runs, after `now`, in `now`'s own zone, or None when it does not run
    again within a year (@reboot never comes back). Raises ValueError on text that is not a schedule."""
    f = expr.split()
    if len(f) != 5:
        raise ValueError(expr)
    minutes = cron_numbers(f[0], 0, 59)
    hours = cron_numbers(f[1], 0, 23)
    days = cron_numbers(f[2], 1, 31)
    months = cron_numbers(f[3], 1, 12, CRON_MONTHS)
    dows = sorted({n % 7 for n in cron_numbers(f[4], 0, 7, CRON_DAYS)})
    if not (minutes and hours and days and months and dows):
        return None
    every_day, every_dow = f[2].strip() == "*", f[4].strip() == "*"
    start = now.date()
    for i in range(400):
        day = start + timedelta(days=i)
        if day.month not in months:
            continue
        # Vixie cron: with both day fields set, either may match; with one of them *, the other decides.
        dow = (day.weekday() + 1) % 7
        if every_day and every_dow:
            pass
        elif every_day:
            if dow not in dows:
                continue
        elif every_dow:
            if day.day not in days:
                continue
        elif day.day not in days and dow not in dows:
            continue
        for hour in hours:
            for minute in minutes:
                at = datetime(day.year, day.month, day.day, hour, minute, tzinfo=now.tzinfo)
                if at > now:
                    return at
    return None


def command_script(command):
    """The script a cron line runs, for the "What it does" column and the one-script-two-jobs warning: the
    basename of the first word naming a script file, else of its first path-shaped word, else "". A line that
    changes folder first (`cd /srv/app && ./deploy.sh`) still names the script it runs."""
    words = re.findall(r"(?<![\w:>/])((?:~/|/|\./)[^\s;&|<>\"']*)", command)
    scripts = [w for w in words if w.endswith((".sh", ".py", ".rb", ".js", ".pl", ".bash"))]
    for word in scripts or words:
        base = os.path.basename(word.rstrip("/"))
        if base:
            return base
    return ""


def parse_crontab(text, now):
    """`crontab -l` output -> one job row per line. Blank lines, comments and NAME=value settings are not jobs,
    and neither is a line whose fields are not a schedule. A crontab records nothing about a run, so its rows
    carry no history instead of a guessed result."""
    jobs = []
    for line in text.splitlines():
        line = " ".join(line.split())
        if not line or line.startswith("#") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*\s*=", line):
            continue
        if line.startswith("@"):
            macro, _, command = line.partition(" ")
            expr = CRON_MACROS.get(macro.lower())
            if not command or (expr is None and macro.lower() != "@reboot"):
                continue
            schedule, raw = (expr or "@reboot"), macro
        else:
            f = line.split(" ", 5)
            if len(f) < 6:
                continue
            schedule = raw = " ".join(f[:5])
            command = f[5]
        try:
            nxt = cron_next(schedule, now) if schedule != "@reboot" else None
        except ValueError:
            continue
        jobs.append({
            "scheduler": "cron",
            # The line itself, hashed: a crontab has no ids, and an edit to the line is a new job.
            "id": "cron-" + hashlib.sha1(line.encode()).hexdigest()[:12],
            "name": command[:60],
            "schedule": schedule,
            "schedule_raw": raw,
            "state": None,
            "enabled": True,
            "script": command_script(command),
            "agent": False,
            "last_run_at": None,
            "last_status": None,
            "last_error": "",
            "next_run_at": nxt.isoformat() if nxt else None,
            "failure_streak": 0,
            "runs_1h": None,
            "runs_24h": None,
            "fails_24h": None,
            # cron keeps no run history: the row says so rather than reading as a failure.
            "history": False,
            "command": command,
            "runs": [],
        })
    return jobs


def timer_units(listed):
    """`systemctl list-timers --all` output -> [(timer, the unit it starts)], as systemd lists them. The columns
    are NEXT, LEFT, LAST, PASSED, UNIT, ACTIVATES; a unit name holds no space, so the two are found by name."""
    out = []
    for line in listed.splitlines():
        f = line.split()
        i = next((n for n, word in enumerate(f) if word.endswith(".timer")), None)
        if i is None:
            continue
        out.append((f[i], f[i + 1] if i + 1 < len(f) and f[i + 1] != "-" else ""))
    return out


def show_blocks(text):
    """`systemctl show <unit>...` output -> [(unit, its property lines)], in the order asked: systemd writes
    `Id=` first and a blank line between one unit and the next."""
    out = []
    for line in (text or "").splitlines():
        if line.startswith("Id="):
            out.append((line[3:], []))
        elif out and "=" in line:
            out[-1][1].append(line)
    return [(unit, "\n".join(lines)) for unit, lines in out]


def show_value(block, key, default=""):
    """One property out of a `systemctl show` block, or `default` when the unit does not carry it."""
    m = re.search(rf"^{re.escape(key)}=(.*)$", block, re.M)
    return m.group(1).strip() if m else default


def timer_time(text, tz):
    """A `systemctl show` time ("Fri 2026-10-23 18:10:00 UTC") as ISO in the machine's own zone, or None when a
    timer never ran or only counts seconds since boot. systemd writes these as text, in the machine's local
    time, so the day name and the zone at the end are read past rather than parsed."""
    f = (text or "").split()
    if len(f) < 3:
        return None
    try:
        at = datetime.strptime(" ".join(f[1:3]), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return at.replace(tzinfo=tz).isoformat()


def service_status(status, result):
    """A systemd service's last exit as the page's last status: "ok" when it worked, and otherwise why not
    ("exit 1", "timeout"), so a run that failed shows as failed."""
    if not status:
        return None
    if status != "0":
        return f"exit {status}"
    return "ok" if result in ("", "success") else result


def parse_timers(listed, timers_show, services_show, now):
    """The rows for the timers in a `systemctl list-timers --all` listing: each one's next and last run from
    `systemctl show <timer>`, and the last exit of the service it starts from `systemctl show <service>`."""
    timers = dict(show_blocks(timers_show))
    services = dict(show_blocks(services_show))
    jobs = []
    for unit, service in timer_units(listed):
        block, service_block = timers.get(unit, ""), services.get(service, "")
        active = show_value(block, "ActiveState")
        specs = [s.strip() for s in re.findall(r"OnCalendar=([^;]*)", block) if s.strip()]
        # A service that never ran carries no exit timestamp: its last result is unknown, not "ok".
        ran = show_value(service_block, "ExecMainExitTimestamp")
        jobs.append({
            "scheduler": "systemd",
            "id": unit,
            "name": unit[: -len(".timer")],
            "schedule": " ; ".join(specs),
            "schedule_raw": " ; ".join(specs),
            "state": active,
            # A timer that is not active will not run again: it reads as paused, like a paused Hermes job.
            "enabled": active != "inactive",
            "script": service,
            "agent": False,
            "last_run_at": timer_time(show_value(block, "LastTriggerUSec"), now.tzinfo),
            "last_status": service_status(show_value(service_block, "ExecMainStatus"),
                                          show_value(service_block, "Result")) if ran else None,
            "last_error": "",
            "next_run_at": timer_time(show_value(block, "NextElapseUSecRealtime"), now.tzinfo),
            "failure_streak": 0,
            "runs_1h": None,
            "runs_24h": None,
            "fails_24h": None,
            "history": True,
            "unit": unit,
            "service": service,
            "runs": [],
        })
    return jobs


def crontab_jobs(now):
    """This user's plain crontab. No crontab is not an error: `crontab -l` says "no crontab for <user>" on
    stderr and exits 1, which `read_command` reads as nothing to show."""
    return parse_crontab(read_command(["crontab", "-l"]) or "", now)


def systemd_jobs(now):
    """Every systemd timer on this machine, the system's and this user's, each with its next run, its last run
    and the last exit of the service it starts. A machine with no systemd, or none running (a Mac, a
    container), has no timers and shows no error."""
    jobs = []
    for scope in ([], ["--user"]):
        listed = read_command(["systemctl", *scope, "list-timers", "--all", "--no-pager", "--no-legend"])
        if not listed:
            continue
        units = timer_units(listed)
        if not units:
            continue
        timers = read_command(["systemctl", *scope, "show", "--no-pager",
                               "-p", "Id", "-p", "ActiveState", "-p", "TimersCalendar",
                               "-p", "NextElapseUSecRealtime", "-p", "LastTriggerUSec",
                               *[u for u, _ in units]]) or ""
        services = sorted({s for _, s in units if s})
        exits = read_command(["systemctl", *scope, "show", "--no-pager",
                              "-p", "Id", "-p", "ExecMainStatus", "-p", "Result", "-p", "ExecMainExitTimestamp",
                              *services]) or ""
        jobs += parse_timers(listed, timers, exits, now)
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


def agent_model(profile, worktree):
    """The model the agent's open Hermes session last called (a fallback shows here too), with its provider."""
    db = os.path.join(HERMES, "profiles", profile, "state.db")
    if not os.path.exists(db):
        return None
    try:
        with closing(open_db(db)) as con:
            session = con.execute("SELECT id, model, billing_provider FROM sessions WHERE cwd = ? AND ended_at IS NULL "
                                  "ORDER BY started_at DESC LIMIT 1", (worktree,)).fetchone()
            if not session:
                return None
            used = con.execute("SELECT model, billing_provider FROM session_model_usage WHERE session_id = ? AND task = '' "
                               "ORDER BY last_seen DESC LIMIT 1", (session[0],)).fetchone()
    except sqlite3.Error:
        return None
    model, provider = used or session[1:]
    return {"model": model, "provider": provider}


def running_agents():
    """One row per agent run: a Hermes agent working in a card worktree (<repo>/.worktrees/<build|review>-<card>).
    While a verify run is going on for the card's commit, the row shows that verify and its own time."""
    out = subprocess.run(["ps", "-axo", "etime=,command="], capture_output=True, text=True).stdout
    found = {}
    for line in out.splitlines():
        m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)", line)
        path = re.search(r"(/[^\s'\"`]*/\.worktrees/(?:build|review)-\d+)", line)
        if not m:
            continue
        key = (m.group(1), m.group(2), int(m.group(3)))
        row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "seconds": 0, "type": "script", "name": None})
        row["seconds"] = max(row["seconds"], seconds(line.split(None, 1)[0]))
        # `hermes -p <name> chat`, or the same argv inside a Python launcher: '-p', '<name>', 'chat'
        profile = re.search(r"(?:^|[\s'\"])-p'?,?\s+'?([\w.-]+)'?,?\s+'?chat\b", line)
        if profile:
            row.update(type="agent", name=profile.group(1))
            if path and "model" not in row:
                row.update(agent_model(profile.group(1), path.group(1)) or {})
    for row in found.values():
        # No Hermes agent in the worktree: the work script runs its own step there (the verify gate).
        row["name"] = row["name"] or WORK_SCRIPT
    for st in work_steps():
        rows = [k for k in found if (k[0], k[2]) == (st["repo"], st["card"])]
        if any(found[k]["type"] == "agent" for k in rows):
            continue  # the agent's own row says what happens
        for k in rows:
            del found[k]
        found[(st["repo"], st["step"], st["card"])] = {
            "repo": st["repo"], "kind": st["step"], "card": st["card"], "type": "script", "name": WORK_SCRIPT,
            "seconds": max(0, int(time.time()) - st["since"])}
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


def work_steps():
    """The work script's current step per card, from its step files; a file whose process is gone is skipped."""
    if not WORK_STEPS:
        return []
    out = []
    for path in glob.glob(os.path.join(WORK_STEPS, "*.json")):
        try:
            st = json.load(open(path))
            os.kill(int(st["pid"]), 0)
        except (OSError, ValueError, KeyError, TypeError):
            continue
        out.append(st)
    return out


def work_script_starts(now_local):
    """The work script's start times in the last 10 minutes, as epoch seconds, from its own log (a script that
    starts itself never hits cron). Each start writes "=== tick <local time> ===", so the page can catch starts
    that fall seconds apart, not only count them."""
    if not WORK_LOG or not os.path.exists(WORK_LOG):
        return None
    with open(WORK_LOG, "rb") as f:
        f.seek(max(0, os.path.getsize(WORK_LOG) - 3_000_000))
        tail = f.read().decode(errors="ignore")
    since = (now_local - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
    out = []
    for t in re.findall(r"=== tick (\S+ \S+) ===", tail):
        if t < since:
            continue
        try:
            out.append(int(datetime.strptime(t, "%Y-%m-%d %H:%M:%S").timestamp()))
        except ValueError:
            continue
    return out


def profile_model(config_path):
    """model.default and model.provider from a Hermes config.yaml, read with a regex (no YAML package)."""
    try:
        text = open(config_path).read()
    except OSError:
        return None, None
    block = re.search(r"^model:\n((?:[ \t]+.*\n?)*)", text, re.M)
    if not block:
        return None, None
    get = lambda key: (re.search(rf"^\s+{key}:\s*(\S+)", block.group(1), re.M) or [None, None])[1]
    return get("default"), get("provider")


def hermes_profiles():
    """Every Hermes agent profile on this machine (and the default one), with its role, model, and last session."""
    dirs = [("default", HERMES)] + [(d.rstrip("/").split("/")[-1], d) for d in sorted(glob.glob(os.path.join(HERMES, "profiles/*/")))]
    out = []
    for name, d in dirs:
        if not os.path.exists(os.path.join(d, "config.yaml")):
            continue
        model, provider = profile_model(os.path.join(d, "config.yaml"))
        role = ""
        try:
            first = open(os.path.join(d, "SOUL.md")).read().strip().split("\n")[0]
            role = re.split(r"(?<=[.!])\s", first)[0].removeprefix("You are ").rstrip(".")[:160]
            role = "" if role.startswith("Hermes Agent, built by Nous Research") else role[:1].upper() + role[1:]
        except OSError:
            pass
        last = None
        db = os.path.join(d, "state.db")
        if os.path.exists(db):
            try:
                with closing(open_db(db)) as con:
                    last = con.execute("SELECT MAX(started_at) FROM sessions").fetchone()[0]
            except sqlite3.Error:
                pass
        out.append({"name": name, "model": model, "provider": provider, "role": role, "last_session": last})
    return out


def host_broken(scratch=FOREMAN):
    """Each `host-broken-<repo>` marker in the foreman's scratch dir: the repo and its one line (the failing
    gate step and the base SHA). A marker means this machine cannot pass that repo's base checks, so no card
    of that repo builds here. No marker, no row."""
    out = []
    for path in sorted(glob.glob(os.path.join(scratch, HOST_BROKEN + "*"))):
        if not os.path.isfile(path):
            continue
        repo = os.path.basename(path)[len(HOST_BROKEN):]
        if not repo:
            continue
        text = (read_text(path, 500) or "").strip()
        out.append({"repo": repo, "line": text.splitlines()[0] if text else ""})
    return out


def main():
    now = datetime.now(timezone.utc).astimezone()
    starts = work_script_starts(now.replace(tzinfo=None))
    print(json.dumps({
        "host": socket.gethostname(),
        "tz": time.strftime("%Z"),
        "now": now.isoformat(),
        "jobs": hermes_jobs(now) + launchd_jobs() + crontab_jobs(now) + systemd_jobs(now),
        "running": running_agents(),
        "host_broken": host_broken(),
        "profiles": hermes_profiles(),
        "work_ticks_10m": len(starts) if starts is not None else None,
        "work_starts_10m": starts,
    }))


if __name__ == "__main__":
    main()
