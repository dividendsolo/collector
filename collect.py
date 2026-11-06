#!/usr/bin/env python3
"""Print one JSON snapshot of this machine's cron jobs and running agents.

The server runs it locally and on each remote machine over `ssh <host> python3 - '<config>' < collect.py`,
so it uses the standard library only. It reads Hermes's cron files (~/.hermes), the foreman's host-broken
markers, launchd (macOS), this user's plain crontab, systemd timers, ps, docker, git, the session files Claude
Code and Codex keep on this machine, and the agents and jobs a config.json `watch` entry names (a process, a
coding-agent session, a launchd label, a log or a heartbeat file), and changes nothing.
"""
import glob
import hashlib
import ipaddress
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
# The lab droid (agent-stack#111): a headless Claude Code run under its own Linux user on ezio, working in its own
# home rather than a card worktree. Nothing else in the panel would show it, so its user is what marks it.
DROID_USER = "lab"
DROID_CARD = 111


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
    out = read_command(["launchctl", "list"]) or ""
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
        ssh_host = args[-1].split("@")[-1] if args and os.path.basename(args[0]) == "ssh" else ""
        jobs.append({
            "scheduler": "launchd",
            "ssh_host": ssh_host,
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
    ("exit 1", "timeout"), so a run that failed shows as failed. systemd's Result is the verdict: a unit can list
    a non-zero exit as success (fwupd-refresh exits 2 for "nothing new", SuccessExitStatus=2)."""
    if not status:
        return None
    if result == "success":
        return "ok"
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


def process_lines(out):
    """(pid, etime, command) for each line of `ps -axo pid=,etime=,command=`."""
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3:
            yield parts[0], parts[1], parts[2]


# Claude Code's own helper processes, which are no session at all (collector#34): the background daemon, the terminal
# host behind a background session, and the idle standbys the daemon keeps warm. Claude Code spawns each of them with
# the helper's own argv0, so its marker reads without a dash in the process's own name — `claude daemon run ...`,
# `claude bg-pty-host ...`, `claude bg-spare ...`, the argv0 strings claude 2.1.303 sets. The flags are the same
# markers where the program is named by its real path instead.
CLAUDE_HELPERS = ("daemon", "bg-pty-host", "bg-spare")
CLAUDE_HELPER_FLAGS = ("--bg-pty-host", "--bg-spare", "--daemon-worker")


def claude_helper(args):
    """True when the arguments after the program name are one of Claude Code's own helpers rather than a session
    (collector#34). A helper's marker is a flag or a subcommand, so it sits in the first arguments, before the `--`
    that opens the session it hosts and before any prompt: a session whose prompt says the word
    (`claude -p restart the daemon`) stays a session, and so does `claude --session-id ...`."""
    words = [arg.split("=", 1)[0] for arg in (args or "").split()[:3]]
    if not words:
        return False
    return words[0] in CLAUDE_HELPERS or any(word in CLAUDE_HELPER_FLAGS for word in words)


def tool_of(command):
    """The coding tool one process runs: 'claude', 'codex', or None. An npm shim shows as `node .../codex.js`, so the
    program and its first argument are both read; a name that only holds the word (`claudette`, `codex-notes`) is not
    the tool. Claude Code's own helpers carry its name too and are not sessions, so they come back None (collector#34)."""
    tokens = (command or "").split(None, 2)
    for i, token in enumerate(tokens[:2]):
        name = re.sub(r"\.(?:js|cjs|mjs|exe)$", "", os.path.basename(token))
        if name == "claude" and claude_helper(" ".join(tokens[i + 1:]) if len(tokens) > i + 1 else ""):
            return None
        if name in ("claude", "codex", "pi"):
            return name
        # codex's own binary, named after its Rust target: codex-x86_64-unknown-linux-musl, codex-aarch64-apple-darwin
        if name.startswith("codex-") and any(target in name for target in ("linux", "darwin", "windows", "musl", "gnu")):
            return "codex"
    return None


# The tool's own name, which is what the row shows (card #29): James knows "Claude Code" and "Codex" — "claude" is
# the name of a binary, not of a profile he has. The keys stay the tools' own (`claude`, `codex`) for the session
# files read under them.
TOOL_NAMES = {"claude": "Claude Code", "codex": "Codex", "pi": "Pi"}

# The provider a Pi session names, in the words James knows: Pi's `claude-code` provider is his Claude subscription,
# reached through a headless `claude -p` that Pi starts under itself (2026-11-04).
PI_PROVIDERS = {"claude-code": "Claude subscription"}


def under_pi(pid, parents, commands, depth=4):
    """True when a process runs under a Pi session: the `claude -p` Pi starts to reach the Claude subscription. It is
    Pi's own backend, not a Claude Code session of its own, so the Pi row stands for it (2026-11-04)."""
    seen, current = {pid}, parents.get(pid)
    while current and current not in seen and depth:
        if tool_of(commands.get(current) or "") == "pi":
            return True
        seen.add(current)
        current, depth = parents.get(current), depth - 1
    return False


def lab_droid(out):
    """The lab droid's run in `ps -axo user=,pid=,etime=,command=` output: ([(pid, seconds)], [row]). The droid
    (agent-stack#111) runs as its own Linux user, in its own home rather than a card worktree, so its user is what
    marks it; another user's `claude` is left to the worktree and session readers. The pids go back so the session
    reader can skip the same process, which would otherwise show the one run twice.
    The row carries repo and kind "lab" — the marker the page draws in the droid's own colour and name."""
    found = {}
    for line in (out or "").splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        user, pid, etime, command = parts
        if user == DROID_USER and tool_of(command):
            found[pid] = seconds(etime)
    if not found:
        return [], []
    row = {"repo": "lab", "kind": "lab", "card": DROID_CARD, "type": "agent", "name": "lab-droid",
           "seconds": max(found.values())}
    return sorted(found.items()), [row]


def worktree_place(path):
    """(repo, card) when a folder sits in a card worktree (<repo>/.worktrees/<something>-<card>), else None."""
    m = re.search(r"/([\w.-]+)/\.worktrees/[^/]*-(\d+)(?:/|$)", path or "")
    return (m.group(1), int(m.group(2))) if m else None


def session_place(cwd, branch=None, root=None):
    """(repo, card) for a session's folder: the repo it runs in, and the card when the folder is a card worktree —
    the path of one of the foreman's worktrees, or a checkout on an agent/<card> branch. (None, None) outside a repo,
    which the page shows as "no repo"."""
    place = worktree_place(cwd)
    if place:
        return place
    if not root:
        return (None, None)
    m = re.fullmatch(r"agent/(\d+)", (branch or "").strip())
    return (os.path.basename(root.rstrip("/")) or None, int(m.group(1)) if m else None)


def git_facts(directory):
    """(branch, top level) of the checkout a folder belongs to, or (None, None) when it is in none."""
    if not directory:
        return (None, None)
    try:
        out = subprocess.run(["git", "-C", directory, "rev-parse", "--abbrev-ref", "HEAD", "--show-toplevel"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return (None, None)
    lines = out.stdout.splitlines() if out.returncode == 0 else []
    branch = lines[0].strip() if lines and lines[0].strip() != "HEAD" else None  # detached: no branch, no card
    return (branch, lines[1].strip() if len(lines) > 1 else None)


# lsof lives in /usr/sbin on macOS, and launchd starts Collector with a PATH that leaves /usr/sbin out, so a bare
# `lsof` is not found there: every session lost its folder, so its repo, card and model (2026-11-04).
LSOF = next((p for p in ("/usr/sbin/lsof", "/usr/bin/lsof") if os.path.exists(p)), "lsof")


def process_cwd(pid):
    """One process's working directory: /proc on Linux, lsof elsewhere (macOS has no /proc)."""
    proc = f"/proc/{pid}/cwd"
    if os.path.exists(proc):
        try:
            return os.readlink(proc)
        except OSError:
            return None
    try:
        out = subprocess.run([LSOF, "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
                             capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    return next((line[1:] for line in out.splitlines() if line.startswith("n/")), None)


def tail_text(path, size=65536):
    """The last bytes of a file: a session file can run to megabytes, and its newest lines say what is true now."""
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.path.getsize(path) - size))
            return f.read().decode(errors="ignore")
    except OSError:
        return ""


def model_in(text):
    """The last model a session file names, or None. `<synthetic>` is Claude Code's own placeholder, not a model."""
    for model in reversed(re.findall(r'"model"\s*:\s*"([^"]+)"', text or "")):
        if not model.startswith("<"):
            return model
    return None


def newest_file(paths):
    """The newest file of a list, or None when there is none (or one vanished under us)."""
    try:
        return max(paths, key=os.path.getmtime) if paths else None
    except OSError:
        return None


def claude_model(cwd, home=HOME):
    """{"model": name} when a running Claude Code session in this folder recorded one under ~/.claude/projects,
    else {}. Claude Code names a folder there after its path, with dots and slashes as dashes."""
    if not cwd:
        return {}
    slug = cwd.replace("/", "-").replace(".", "-")
    path = newest_file(glob.glob(os.path.join(home, ".claude", "projects", slug, "*.jsonl")))
    model = model_in(tail_text(path)) if path else None
    return {"model": model} if model else {}


def codex_model(cwd, home=HOME):
    """{"model": name} when a running Codex session in this folder recorded one in its rollout file under
    ~/.codex/sessions, else {}. Codex writes one jsonl per session, its first line naming the folder it runs in."""
    if not cwd:
        return {}
    files = glob.glob(os.path.join(home, ".codex", "sessions", "**", "*.jsonl"), recursive=True)
    try:
        files = sorted(files, key=os.path.getmtime, reverse=True)[:20]
    except OSError:
        files = files[:20]
    for path in files:
        try:
            with open(path, errors="replace") as f:
                head = f.readline(4000)
        except OSError:
            continue
        m = re.search(r'"cwd"\s*:\s*"([^"]*)"', head)
        if not m or m.group(1).rstrip("/") != cwd.rstrip("/"):
            continue
        model = model_in(tail_text(path))
        return {"model": model} if model else {}
    return {}


def pi_model(cwd, home=HOME):
    """{"model": name, "provider": words} from the newest Pi session file for this folder, else {}. Pi keeps one jsonl
    per session under ~/.pi/agent/sessions/--<path with dashes>--. Its own model id can be `default` (the provider
    picks), so the last real model the provider reported wins over it."""
    if not cwd:
        return {}
    slug = "--" + cwd.strip("/").replace("/", "-") + "--"
    path = newest_file(glob.glob(os.path.join(home, ".pi", "agent", "sessions", slug, "*.jsonl")))
    text = tail_text(path) if path else ""
    models = [m for m in re.findall(r'"model"\s*:\s*"([^"]+)"', text) if m != "default" and not m.startswith("<")]
    providers = re.findall(r'"provider"\s*:\s*"([^"]+)"', text)
    row = {}
    if models:
        row["model"] = models[-1]
    if providers:
        row["provider"] = PI_PROVIDERS.get(providers[-1], providers[-1])
    return row


def tool_model(tool, cwd, home=HOME):
    """What a tool's own session files say about a session in this folder: {"model": name}, or {} when it recorded
    none. Nothing here goes near the network."""
    if tool == "pi":
        return pi_model(cwd, home)
    return claude_model(cwd, home) if tool == "claude" else codex_model(cwd, home)


# The program tmux runs as a server or as the client that started one. Inside tmux the pane's shell is the server's
# child and the session sits under that, so a session is in tmux when this name is anywhere above it (collector#37).
# tmux starts its server with the argv0 of the client that first needed one (`tmux new-session -A -s Work`), and names
# itself `tmux: server` in its own title on some versions, so the name is the first token's basename read as either.
def is_tmux(command):
    """True when one `ps` line is tmux itself, server or client. A pid the read holds no line for is not tmux."""
    name = os.path.basename(command.split(None, 1)[0]) if (command or "").strip() else ""
    return name == "tmux" or name.startswith("tmux:")


def in_tmux(pid, parents, commands, depth=8):
    """True when a process runs inside tmux: one of its ancestors is tmux. `parents` maps a pid to the pid it runs
    under and `commands` a pid to its own command line, both from the same `ps` read of the machine. A parent the read
    does not hold, or a chain longer than `depth`, is not tmux, and the row keeps reading what it read before
    (collector#37)."""
    seen, current = {pid}, parents.get(pid)
    while current and current not in seen and depth:
        if is_tmux(commands.get(current)):
            return True
        seen.add(current)
        current, depth = parents.get(current), depth - 1
    return False


def tool_rows(out, facts, models=None, skip=(), parents=None):
    """One row per running Claude Code or Codex session, named as the tool names itself ("Claude Code", "Codex"): the
    repo and card its folder is a card worktree for, and how long it has run. `facts` maps a pid to (folder, branch,
    checkout top level) and `models` maps (tool, folder) to what the tool's session files record. One Codex session per
    folder: Codex's npm shim and the binary under it are two processes of one run, so the longest-lived process is the
    one that shows. Every Claude Code process left once its helpers are gone is a session of its own, so two in one
    folder are two rows (collector#34: 3 sessions in the home folder showed as 1). `skip` holds the pids of processes
    another reader already shows — the lab droid's run, which has its own row. A session under tmux carries
    `"tmux": True` (collector#37), from `parents`, the pid -> parent map of the same `ps` read; the page's Running for
    cell reads `tmux` for it instead of `interactive`."""
    models, parents = models or {}, parents or {}
    commands = {pid: command for pid, _, command in process_lines(out)}
    found = {}
    for pid, etime, command in process_lines(out):
        if pid in skip:
            continue
        tool = tool_of(command)
        if not tool or (tool == "claude" and under_pi(pid, parents, commands)):
            continue
        cwd, branch, root = facts.get(pid, (None, None, None))
        key = (tool, cwd or f"pid {pid}", pid if tool in ("claude", "pi") else "")
        if key in found and found[key]["seconds"] >= seconds(etime):
            continue
        repo, card = session_place(cwd, branch, root)
        row = {"repo": repo, "kind": "session", "card": card, "seconds": seconds(etime),
               "type": "agent", "name": TOOL_NAMES[tool], **models.get((tool, cwd), {})}
        if in_tmux(pid, parents, commands):
            row["tmux"] = True
        found[key] = row
    return [found[k] for k in sorted(found)]


def tool_sessions(out, skip=(), parents=None):
    """Every running Claude Code or Codex session on this machine, with the model its own session files record and
    whether it runs inside tmux (collector#37). `skip` holds the pids of processes another reader already shows — the
    lab droid's run, which has its own row."""
    facts, models = {}, {}
    parents = parents or {}
    commands = {pid: command for pid, _, command in process_lines(out)}
    for pid, _, command in process_lines(out):
        if pid in skip:
            continue
        tool = tool_of(command)
        if not tool or (tool == "claude" and under_pi(pid, parents, commands)):
            continue
        cwd = process_cwd(pid)
        branch, root = git_facts(cwd)
        facts[pid] = (cwd, branch, root)
        if cwd and (tool, cwd) not in models:
            models[(tool, cwd)] = tool_model(tool, cwd)
    return tool_rows(out, facts, models, skip, parents)


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


# Programs whose own argument is the thing they run: `bun start`, `next start`, `node next-server`, `python3 serve.py`.
RUNNERS = {"bun", "node", "deno", "next", "ruby", "npx", "pnpm", "yarn"}
# Sub-commands that only name the program again: `bun run dev` runs `dev`.
SUBCOMMANDS = {"run", "exec", "x"}
# Wrappers that stand in front of the program: `env A=1 bun start`, `timeout 2h bun start`, `script -c bun start`.
WRAPPERS = {"env", "sudo", "nice", "ionice", "nohup", "setsid", "stdbuf", "command", "exec", "script"}
# A shell holding the command as its own argument (`bash -lc 'cd <worktree> && bun start'`): the program is inside it.
SHELLS = {"sh", "bash", "zsh", "dash", "ksh"}


def program_name(command, depth=0):
    """The program a process runs, as a person would name it: `bun start`, `next-server`, `node next-server`. Wrappers
    and flags are dropped, a shell's own argument is read for the program inside it, and an interpreter or runner is
    named with the script under it. The ports it listens on are their own cell, so they are not here."""
    text = re.sub(r"^\s*cd\s+\S+\s*(?:&&|;|\|\|)\s*", "", command or "")
    # In a chain, the command still running is the last one: `cd <worktree> && bun start`.
    tokens = text.split("&&")[-1].split()
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.startswith("-") or "=" in token or token in WRAPPERS:
            i += 1
        elif os.path.basename(token) == "timeout":
            i += 2  # `timeout 2h <program>`: the duration is not the program
        else:
            break
    if i >= len(tokens):
        return ""
    name = os.path.basename(tokens[i])
    if name in SHELLS:
        flag = next((j for j in range(i + 1, len(tokens)) if tokens[j].startswith("-") and "c" in tokens[j]), None)
        if flag is None or flag + 1 >= len(tokens) or depth > 2:
            return name
        return program_name(" ".join(tokens[flag + 1:]), depth + 1)
    if name in RUNNERS or re.fullmatch(r"python[\d.]*", name):
        rest = tokens[i + 1: i + 3]
        if name.startswith("python") and rest and rest[0] == "-m":  # `python3 -m http.server` runs http.server
            rest = tokens[i + 2: i + 3]
        if rest and rest[0] in SUBCOMMANDS:
            rest = rest[1:]
        if rest and not rest[0].startswith("-"):
            name = f"{name} {os.path.basename(rest[0])}"
    return name


def listen_ports():
    """Every TCP port a process of this machine listens on now, as pid -> [ports]. `ss` on Linux, `lsof` elsewhere (a
    Mac has no ss); {} when the machine has neither. One read-only call for the whole machine."""
    if platform.system() == "Linux":
        ss = read_command(["ss", "-ltnpH"])
        ports = {}
        for line in (ss or "").splitlines():
            # LISTEN 0 511 127.0.0.1:4123 0.0.0.0:* users:(("bun",pid=1701,fd=22))
            fields, owner = line.split(), re.search(r"pid=(\d+)", line)
            port = fields[3].rsplit(":", 1)[-1] if len(fields) > 3 else ""
            if owner and port.isdigit():
                ports.setdefault(owner.group(1), []).append(int(port))
        return ports
    lsof = read_command([LSOF, "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"])
    ports, pid = {}, None
    for line in (lsof or "").splitlines():
        # lsof prints `p<pid>` once, then one `n<address>` line per socket that pid listens on.
        if re.match(r"p\d+$", line):
            pid = line[1:]
            continue
        port = line[1:].rsplit(":", 1)[-1] if line.startswith("n") else ""
        if pid and port.isdigit():
            ports.setdefault(pid, []).append(int(port))
    return ports


# The Network section (collector#65): every listening TCP and UDP socket on this machine, and who can connect to
# it. Read only, no sudo, nothing installed anywhere, and no port ever scanned from outside — this is what each
# machine says it listens on. `ss -tulnp` on Linux, `lsof -nP -iTCP -sTCP:LISTEN` and `lsof -nP -iUDP` on macOS (a
# Mac has no ss); both read through `read_command`, so a machine without the tool reads empty. The firewall is not
# read: a port the machine listens on for the internet can still be blocked by ufw or the macOS firewall.
# The two sshd settings that should not be on: password logins, and root's.
SSHD_DIRECTIVES = ("passwordauthentication", "permitrootlogin")
SSHD_CONFIG = "/etc/ssh/sshd_config"
# The addresses the two tools print for a socket bound on every address of the machine.
WILDCARD_ADDRESSES = ("*", "0.0.0.0", "::", "0:0:0:0:0:0:0:0")
# Tailscale's own ranges: the addresses a machine is reached on inside its tailnet.
TAILNET_RANGES = (ipaddress.ip_network("100.64.0.0/10"), ipaddress.ip_network("fd7a:115c:a1e0::/48"))
# The private ranges, an address only the machines on the same local network can reach: RFC 1918, IPv6's unique
# local range, and the link-local ranges. Every other address is one anyone on the internet may reach.
PRIVATE_RANGES = tuple(ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fc00::/7", "fe80::/10"))
# Interfaces that are not a network other machines are on: loopback, the tailnet's tunnel (its addresses are read
# by range), and the bridges Docker, VMs and the like make inside the machine.
VIRTUAL_INTERFACES = re.compile(r"^(lo|tailscale|utun|docker|br-|veth|virbr|vmnet|bridge|awdl|llw|anpi|ap\d|gif|stf)")
# Who can connect to a socket, the most exposed first: anyone on the internet, the internet through a port the
# firewall opens on purpose, the machines on this machine's local network, the machines on its tailnet, this machine
# alone.
REACH_RANK = {"internet": 0, "firewalled": 1, "lan": 2, "tailnet": 3, "machine": 4}


def in_tailnet(ip):
    return any(ip.version == net.version and ip in net for net in TAILNET_RANGES)


def is_private(ip):
    return any(ip.version == net.version and ip in net for net in PRIVATE_RANGES)


# The two address tools by their own paths, the way LSOF is: launchd and a bare `ssh host` give a short PATH.
IP = next((p for p in ("/usr/sbin/ip", "/sbin/ip", "/usr/bin/ip", "/bin/ip") if os.path.exists(p)), "ip")
IFCONFIG = next((p for p in ("/sbin/ifconfig", "/usr/sbin/ifconfig") if os.path.exists(p)), "ifconfig")


def interface_addresses():
    """(interface, ip_interface) for each address on this machine: `ip -o addr show` on Linux, `ifconfig` where
    there is no `ip` (a Mac). [] when neither tool is there."""
    if platform.system() == "Linux":
        return parse_ip_addr(read_command([IP, "-o", "addr", "show"]) or "")
    return parse_ifconfig(read_command([IFCONFIG]) or "")


def parse_ip_addr(text):
    """`ip -o addr show` -> (interface, ip_interface): `2: eth0    inet 192.0.2.5/24 brd ...`, one per line."""
    out = []
    for line in (text or "").splitlines():
        fields = line.split()
        if len(fields) < 4 or fields[2] not in ("inet", "inet6"):
            continue
        try:
            out.append((fields[1], ipaddress.ip_interface(fields[3])))
        except ValueError:
            continue
    return out


def parse_ifconfig(text):
    """`ifconfig` (macOS) -> (interface, ip_interface). An interface's line starts at the left (`en0: flags=...`);
    its addresses follow, indented: `inet 192.0.2.5 netmask 0xffffff00` and `inet6 fe80::1%en0 prefixlen 64`."""
    out, iface = [], None
    for line in (text or "").splitlines():
        if line and not line[0].isspace():
            iface = line.split(":", 1)[0]
            continue
        fields = line.split()
        if iface is None or len(fields) < 2 or fields[0] not in ("inet", "inet6"):
            continue
        address = fields[1].split("%", 1)[0]
        prefix = None
        if "netmask" in fields and fields.index("netmask") + 1 < len(fields):
            mask = fields[fields.index("netmask") + 1]
            prefix = bin(int(mask, 16)).count("1") if mask.startswith("0x") else mask
        elif "prefixlen" in fields and fields.index("prefixlen") + 1 < len(fields):
            prefix = fields[fields.index("prefixlen") + 1]
        try:
            out.append((iface, ipaddress.ip_interface(f"{address}/{prefix}" if prefix is not None else address)))
        except ValueError:
            continue
    return out


def machine_networks(addresses):
    """The networks this machine is on, from its own addresses: `lan`, the private networks it is on (a home Wi-Fi
    is `192.168.1.0/24`); `internet`, its public addresses (a VPS); `tailnet`, its Tailscale address or None.
    Loopback, link-local and the bridges inside the machine are no network another machine is on."""
    lan, internet, tailnet = [], [], None
    for iface, ifc in addresses:
        ip = ifc.ip
        if ip.is_loopback or ip.is_link_local or ip.is_unspecified or ip.is_multicast:
            continue
        if in_tailnet(ip):
            tailnet = tailnet or str(ip)
            continue
        if VIRTUAL_INTERFACES.match(iface or ""):
            continue
        if is_private(ip):
            lan.append(str(ifc.network))
        else:
            internet.append(str(ip))
    return {"lan": sorted(set(lan)), "internet": sorted(set(internet)), "tailnet": tailnet}


def reach_of(address, networks):
    """(who can connect to a socket bound on `address`, and whether the machine's tailnet can as well):
    - `machine`: only this machine (127.0.0.1, ::1);
    - `tailnet`: the machines on its tailnet (a Tailscale address);
    - `lan`: the machines on its local network (a private or link-local address, or every address of a machine
      that has no public one);
    - `internet`: anyone on the internet (any other address, or every address of a machine that has a public one).
    An address that cannot be placed reads as the internet, not as private: the flag is the safe direction."""
    a = (address or "").strip().strip("[]").lower().split("%", 1)[0]
    if a in WILDCARD_ADDRESSES:
        everywhere = "lan" if networks.get("lan") and not networks.get("internet") else "internet"
        return everywhere, bool(networks.get("tailnet"))
    if a == "localhost":
        return "machine", False
    try:
        ip = ipaddress.ip_address(a)
    except ValueError:
        return "internet", False
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return "machine", False
    if in_tailnet(ip):
        return "tailnet", False
    if is_private(ip):
        return "lan", False
    return "internet", False


def split_address(text):
    """(address, port) out of the text the two tools print for one socket: `127.0.0.53%lo:53`, `[::1]:631`,
    `*:3000`, `100.64.0.10%tailscale0:49375`, and an IPv6 bind with both, `[fd7a:115c:a1e0::1]%tailscale0:40724`.
    The zone ss appends to a bind and the brackets around an IPv6 address are not part of either; the port is None
    when there is not one."""
    address, _, port = (text or "").strip().rpartition(":")
    address = address.split("%", 1)[0].strip().strip("[]")
    return (address, int(port)) if port.isdigit() else (address, None)


def parse_ss(text):
    """`ss -tulnp` output -> one row per listening TCP or UDP socket: protocol, address, port, and the process that
    owns it, where this user may read one (`-p` shows the user's own processes without sudo, so a socket of
    another user's keeps its address and port and no name). The header line, and anything that is not a socket
    line, is skipped."""
    out = []
    for line in (text or "").splitlines():
        fields = line.split()
        proto = fields[0].lower() if fields else ""
        if proto not in ("tcp", "udp") or len(fields) < 6:
            continue
        address, port = split_address(fields[4])
        if port is None:
            continue
        # One row per socket: ss prints one line per socket, with its owner (the first) when it has one.
        owner = re.search(r'\("([^"]*)",pid=(\d+)', line)
        out.append({"proto": proto, "address": address, "port": port,
                    "process": owner.group(1) if owner else None, "pid": owner.group(2) if owner else None})
    return out


def parse_lsof(text):
    """`lsof -nP -iTCP -sTCP:LISTEN` or `lsof -nP -iUDP` output -> the same rows as `parse_ss`. lsof prints the
    command and its pid at the left and the protocol and the socket at the right (`TCP *:3000 (LISTEN)`), so the
    process is the first field and the address the token after the protocol; the state lsof appends is not part
    of it. `-iUDP` lists connected sockets too (`UDP 192.0.2.5:60000->198.51.100.1:443`); they listen on nothing
    and are skipped."""
    out = []
    for line in (text or "").splitlines():
        fields = line.split()
        if len(fields) < 3 or not fields[1].isdigit():
            continue  # the header, and anything that is not a socket row
        proto = next((i for i, word in enumerate(fields) if word.lower() in ("tcp", "udp")), None)
        if proto is None or proto + 1 >= len(fields):
            continue
        if "->" in fields[proto + 1]:
            continue  # a connected socket (`local->remote`, which `-iUDP` lists too), not a listening one
        address, port = split_address(fields[proto + 1])
        if port is None:
            continue
        out.append({"proto": fields[proto].lower(), "address": address, "port": port,
                    "process": fields[0] or None, "pid": fields[1]})
    return out


def listen_sockets():
    """Every listening TCP and UDP socket on this machine: `ss -tulnp` on Linux, `lsof -nP -iTCP -sTCP:LISTEN` and
    `lsof -nP -iUDP` where there is no ss (a Mac, and any other Unix). [] when the machine has no tool to read —
    the section then reads empty, the way every other read here does without its tool."""
    if platform.system() == "Linux":
        # `sudo -n` never asks for a password: where it needs one it fails at once, and plain `ss` still reads every
        # socket, only without another user's process names.
        return parse_ss(read_command(["sudo", "-n", "ss", "-tulnp"]) or read_command(["ss", "-tulnp"]) or "")
    return parse_lsof(read_command([LSOF, "-nP", "-iTCP", "-sTCP:LISTEN"]) or "") + parse_lsof(
        read_command([LSOF, "-nP", "-iUDP"]) or ""
    )


def sshd_read():
    """(where the sshd settings were read, their text) on a Linux machine, or None where there is nothing to read:
    a Mac, or a machine with no sshd and no config file. `sshd -T` prints the effective configuration and needs
    root, so a read that fails falls back to the config file itself — read only, nothing changed."""
    if platform.system() != "Linux":
        return None
    # The effective settings, drop-ins included: `sudo -n` (never asks for a password), then plain `sshd -T` (root
    # only, so it usually fails). The config file is the last resort, and the page names it: it misses a drop-in
    # that overrides it (ezio, 2026-11-06: the main file said yes, sshd_config.d/00-hardening.conf said no).
    for cmd in (["sudo", "-n", "sshd", "-T"], ["sshd", "-T"]):
        text = read_command(cmd)
        if text:
            return ("sshd -T", text)
    text = read_text(SSHD_CONFIG) if os.path.exists(SSHD_CONFIG) else None
    return (SSHD_CONFIG, text) if text else None


def sshd_flags(text):
    """The two sshd settings that should not be on, read the same way out of `sshd -T` (whose keys are lower case)
    and out of the config file (whose directive names are not): a line that is not commented out and sets the
    directive to `yes`. Anything else is off — `no`, `prohibit-password`, a directive that is only commented out,
    and an `Include` this reader does not follow."""
    on = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        if parts[0].lower() not in SSHD_DIRECTIVES:
            continue
        on[parts[0].lower()] = parts[1].split("#")[0].strip().lower() if len(parts) > 1 else ""
    return {name: on.get(name) == "yes" for name in SSHD_DIRECTIVES}


# What a program that listens on a port is, in one line, for the tooltip on its name (collector#65). Matched on the
# program's file name (the last part of its path), lower case. A program not named here shows its facts alone: how
# long it has run, what started it, its user and its path — never a guess.
KNOWN_PROGRAMS = {
    "controlcenter": "macOS Control Center. Its ports 5000 and 7000 are the AirPlay Receiver: other Apple devices on "
                     "the network can send audio, video or a screen mirror to this Mac.",
    "rapportd": "macOS Handoff and Universal Clipboard: lets your own Apple devices pass work and the clipboard to "
                "this Mac.",
    "sharingd": "macOS sharing: AirDrop and the other Continuity features.",
    "replicatord": "macOS iPhone Mirroring and widget sync with your iPhone.",
    "mdnsresponder": "macOS Bonjour: finds printers, speakers and other devices on the local network.",
    "localsend": "LocalSend: sends and receives files with other devices on the local network.",
    "com.docker.backend": "Docker Desktop: forwards the ports of running containers to this machine.",
    "docker-proxy": "Docker: forwards a container's port to this machine.",
    "brave browser helper": "Brave's network helper. Port 5353 is mDNS: the browser looks for Chromecasts and other "
                            "devices on the local network.",
    "google chrome helper": "Chrome's network helper. Port 5353 is mDNS: the browser looks for Chromecasts and other "
                            "devices on the local network.",
    "postgres": "PostgreSQL database server.",
    "sshd": "OpenSSH server: lets you log in to this machine over SSH.",
    "tailscaled": "Tailscale: the tailnet's own connection. Port 41641 is how tailnet devices reach this machine.",
    "avahi-daemon": "Avahi: Linux's mDNS, finds and announces devices on the local network.",
    "systemd-resolved": "systemd's DNS resolver, for this machine alone.",
    "dhclient": "DHCP client: gets this machine's IP address from the network.",
    "systemd-networkd": "systemd's network manager: gets this machine's IP address from the network (DHCP).",
    "cupsd": "CUPS: the printing service.",
    "smbd": "Samba: Windows file sharing.",
    "next-server": "A Next.js web app server. Port 4000 is Collector; any other port is a dev server.",
    "bun": "A program run with Bun (a JavaScript runtime). Its path below says which one.",
    "node": "A program run with Node.js. Its path below says which one.",
    "ssh": "An SSH tunnel: forwards this port to another machine.",
    "google chrome": "Google Chrome. Port 9222 is its remote debugging port, used by browser automation.",
    "brave browser": "Brave browser.",
    "logipluginservice": "Logitech Options+: the Logitech mouse and keyboard software.",
    "raycast backend": "Raycast, the macOS launcher.",
    "code helper": "VS Code's helper process.",
    "code helper (plugin)": "VS Code's extension host.",
    "hermes": "Hermes: the agent gateway and its jobs.",
    "java": "A Java program. Its command below says which one (signal-cli is the Signal messenger bridge).",
    "pi": "pi, the coding agent.",
    "hex": "Hex, the macOS dictation app.",
}


def ps_details(text, args=None):
    """`ps -axo pid=,ppid=,user=,etime=,comm=` -> pid -> {ppid, user, seconds, path}. `comm` is the program's full
    path on a Mac and its short name on Linux, and it may hold spaces (`Brave Browser Helper.app/...`), so it is the
    rest of the line."""
    out = {}
    for line in (text or "").splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5 or not parts[0].isdigit():
            continue
        try:
            secs = seconds(parts[3])
        except ValueError:
            secs = None
        out[parts[0]] = {"ppid": parts[1], "user": parts[2], "seconds": secs, "path": parts[4].strip()}
    # Linux's `comm` is the short name, cut to 15 letters (`next-server (v1`). `args` holds the full command: the name
    # is taken from it only when it continues the cut one — a renamed process (`next-server (v16.4.2)`) or a program
    # whose own path ends in a longer name — so an interpreter (`python3` running Hermes) never replaces the name.
    for line in (args or "").splitlines():
        parts = line.split(None, 1)
        if len(parts) != 2 or parts[0] not in out:
            continue
        d, command = out[parts[0]], parts[1].strip()
        d["command"] = command[:300]
        short = d["path"]
        if len(short) >= 15 and command.startswith(short):
            d["path"] = command.split(")", 1)[0] + ")" if "(" in short else command.split()[0]
        elif len(short) >= 15 and file_name(command.split()[0]).startswith(short):
            d["path"] = command.split()[0]
    return out


def file_name(path):
    """A program's own name out of its path: the file name, so `/usr/libexec/rapportd` is `rapportd`."""
    return (path or "").rstrip("/").rsplit("/", 1)[-1] or None


def process_info(pid, details):
    """What the tooltip on a listening process says (collector#65): its full name (lsof cuts a name to nine letters,
    `ControlCe`), what it is when it is a program we know, how long it has run, what started it, its user and its
    path. None for a socket with no pid, or a pid `ps` did not list."""
    d = details.get(str(pid)) if pid else None
    if not d:
        return None
    name = file_name(d["path"])
    # Linux keeps only 15 letters of a program's name in `comm`, and Next renames its server `next-server (v16.4.2)`:
    # the known-program match reads the name up to its first ` (`.
    known = KNOWN_PROGRAMS.get((name or "").lower()) or KNOWN_PROGRAMS.get((name or "").split(" (", 1)[0].lower())
    parent = details.get(d["ppid"])
    started_by = file_name(parent["path"]) if parent else None
    if d["ppid"] == "1":
        started_by = "launchd" if platform.system() == "Darwin" else "systemd"
    return {"name": name, "about": known, "seconds": d["seconds"],
            "started_by": started_by, "user": d["user"], "path": d.get("command") or d["path"]}


# The firewall (collector#65): ufw on Linux. A port bound on every address is only as open as the firewall lets it be,
# so a port the firewall blocks from the internet is not marked open to the internet. Read with `sudo -n ufw status
# verbose` (ufw needs root; `-n` fails at once rather than ask for a password), and read only. A machine with no ufw,
# or no sudo without a password, reads `None`: its ports keep the reach their address gives them, and the page says
# the firewall was not read.
UFW_RULE = re.compile(
    r"^(?P<to>.+?)\s+(?P<action>ALLOW|DENY|REJECT|LIMIT)(?:\s+(?P<dir>IN|OUT|FWD))?\s+(?P<frm>.+?)\s*$")


def parse_ufw(text):
    """`ufw status verbose` -> {active, incoming, rules}, or None when it says nothing a firewall would. `incoming` is
    the default for incoming traffic ("deny", "reject" or "allow"); each rule is {action, proto, ports, iface, any}:
    `ports` the port numbers it names (a range is its two ends inclusive), `iface` the interface an `on <iface>` rule
    is bound to, `any` true when it names no port. Only incoming ALLOW and LIMIT rules from anywhere decide reach;
    a rule from one address is a hole for that address alone, and this reader leaves it out (it widens nothing for
    the internet as a whole)."""
    if not text or "Status:" not in text:
        return None
    active = bool(re.search(r"^Status:\s*active", text, re.M))
    m = re.search(r"^Default:\s*(\w+)\s*\(incoming\)", text, re.M)
    out = {"active": active, "incoming": (m.group(1).lower() if m else "deny"), "rules": []}
    for line in text.splitlines():
        r = UFW_RULE.match(line.strip())
        if not r or r.group("to") in ("To", "--"):
            continue
        if (r.group("dir") or "IN") != "IN" or r.group("action") not in ("ALLOW", "LIMIT"):
            continue
        frm = r.group("frm").replace("(v6)", "").strip()
        if frm not in ("Anywhere", "Anywhere on any"):
            continue
        to = r.group("to").replace("(v6)", "").strip()
        iface = None
        on = re.search(r"\bon\s+(\S+)", to)
        if on:
            iface = on.group(1)
            to = to[: on.start()].strip()
        rule = {"action": r.group("action").lower(), "proto": None, "ports": [], "iface": iface, "any": False}
        if to in ("Anywhere", ""):
            rule["any"] = True
        else:
            spec, _, proto = to.partition("/")
            rule["proto"] = proto.lower() or None
            for part in spec.split(","):
                lo, _, hi = part.partition(":")
                if lo.isdigit():
                    rule["ports"].append([int(lo), int(hi) if hi.isdigit() else int(lo)])
        if rule["any"] or rule["ports"]:
            out["rules"].append(rule)
    return out


SOCKETFILTERFW = "/usr/libexec/ApplicationFirewall/socketfilterfw"
# Programs that run whatever script they are given: allowing one to accept connections allows every dev server it
# ever runs, so the Mac's Security checks flag them on the firewall's allow list.
INTERPRETERS = re.compile(r"^(node|bun|deno|python[\d.]*|python\.app|ruby|perl|php|java)$", re.I)


def parse_socketfilterfw(state, apps=""):
    """The macOS application firewall from `socketfilterfw --getglobalstate --getblockall --getstealthmode
    --getallowsigned` (`state`) and `--listapps` (`apps`) -> {active, block_all, stealth, allow_builtin, allow_signed,
    apps: [{path, allow}]}, or None when `state` says nothing. All of it reads without a password. The Mac firewall
    allows or blocks programs, not ports, so it changes no port's reach here: it is read for the Security checks."""
    if not state or "Firewall" not in state:
        return None
    def has(pattern):
        return bool(re.search(pattern, state, re.I))
    out = {
        "active": has(r"Firewall is enabled"),
        "block_all": has(r"block all state set to enabled"),
        "stealth": has(r"stealth mode is on"),
        "allow_builtin": has(r"allow built-in signed software ENABLED"),
        "allow_signed": has(r"allow downloaded signed software ENABLED"),
        "apps": [],
    }
    path = None
    for line in (apps or "").splitlines():
        m = re.match(r"^\s*\d+\s*:\s*(.+?)\s*$", line)
        if m:
            path = m.group(1)
            continue
        m = re.search(r"\((Allow|Block) incoming connections\)", line)
        if m and path:
            out["apps"].append({"path": path, "allow": m.group(1) == "Allow",
                                "interpreter": bool(INTERPRETERS.match(file_name(path) or ""))})
            path = None
    return out


def firewall_read():
    """This machine's firewall, or None when none could be read: ufw on Linux (`sudo -n ufw status verbose`; no ufw
    or no sudo without a password reads None), the application firewall on a Mac (`socketfilterfw`, no password)."""
    if platform.system() == "Darwin":
        state = read_command([SOCKETFILTERFW, "--getglobalstate", "--getblockall", "--getstealthmode",
                              "--getallowsigned"])
        fw = parse_socketfilterfw(state or "", read_command([SOCKETFILTERFW, "--listapps"]) or "")
        return {"tool": "macOS firewall", **fw} if fw else None
    if platform.system() != "Linux":
        return None
    fw = parse_ufw(read_command(["sudo", "-n", "ufw", "status", "verbose"]) or "")
    return {"tool": "ufw", **fw} if fw else None


def firewall_lets_in(fw, proto, port, iface=None):
    """True when the firewall lets a connection from anywhere reach this port, on `iface` if given (an `on <iface>`
    rule opens that interface only). An inactive firewall, or one whose incoming default is allow, lets everything
    in."""
    if not fw or not fw.get("active") or fw.get("incoming") == "allow":
        return True
    for rule in fw.get("rules", []):
        if rule.get("iface") and rule["iface"] != iface:
            continue
        if rule.get("proto") and rule["proto"] != proto:
            continue
        if rule.get("any") or any(lo <= port <= hi for lo, hi in rule.get("ports", [])):
            return True
    return False


def tailnet_peers():
    """Tailscale IP -> the device's name, from `tailscale status --json`, so the page names who may connect (altair,
    Pixel 8 Pro) rather than an address. {} with no tailscale here."""
    for exe in TAILSCALE_BINS:
        text = read_command([exe, "status", "--json"], timeout=5)
        if not text:
            continue
        try:
            d = json.loads(text)
        except ValueError:
            continue
        names = {}
        for p in list((d.get("Peer") or {}).values()) + [d.get("Self") or {}]:
            for ip in p.get("TailscaleIPs") or []:
                names[ip] = p.get("HostName") or p.get("DNSName") or ip
        return names
    return {}


def tailnet_acl_read():
    """Which tailnet devices may connect to this machine, and on which ports, from the packet filter Tailscale's
    access rules gave it (`tailscale debug netmap`): [{"ports": [[lo, hi]], "protos": [6, 17], "from": [ip]}], one per
    rule. An empty list means no tailnet device may connect at all; None means it could not be read (no tailscale,
    or no debug access), and the page then keeps the tailnet badge as the address gives it."""
    for cmd in (["sudo", "-n", "tailscale", "debug", "netmap"],) + tuple(
            [exe, "debug", "netmap"] for exe in TAILSCALE_BINS):
        text = read_command(list(cmd), timeout=8)
        if not text:
            continue
        try:
            netmap = json.loads(text)
        except ValueError:
            continue
        return parse_tailnet_acl(netmap)
    return None


def parse_tailnet_acl(netmap):
    """The packet filter of a `tailscale debug netmap` -> the rules that let a tailnet device in. A rule names the
    sources it lets in and the destinations (this machine's addresses, or `*`) and ports they may reach."""
    if not isinstance(netmap, dict) or "PacketFilter" not in netmap:
        return None
    rules = []
    for r in netmap.get("PacketFilter") or []:
        ports = []
        for d in r.get("Dsts") or []:
            p = d.get("Ports") or {}
            ports.append([int(p.get("First", 0)), int(p.get("Last", 65535))])
        rules.append({"ports": ports, "protos": list(r.get("IPProto") or []), "from": list(r.get("Srcs") or [])})
    return rules


def tailnet_lets_in(acl, proto, port):
    """The tailnet devices the access rules let reach this port, or None when the rules were not read (assume the
    tailnet can, as the address says). An empty list: no tailnet device can connect."""
    if acl is None:
        return None
    number = {"tcp": 6, "udp": 17}.get(proto)
    out = []
    for r in acl:
        if r["protos"] and number not in r["protos"]:
            continue
        if any(lo <= port <= hi for lo, hi in r["ports"]):
            out += [src for src in r["from"] if src not in out]
    return out


def apply_tailnet(row, acl):
    """A row the tailnet could reach by its address keeps the tailnet only when the access rules let a device in:
    altair's access rules let no device in (2026-11-06), so its ports were never open to the tailnet. Records the
    devices allowed in `tailnet_from`."""
    allowed = tailnet_lets_in(acl, row["proto"], row["port"])
    row["tailnet_from"] = allowed
    if allowed is None or allowed:
        return row
    if row["reach"] == "tailnet":
        row["reach"] = "machine"
    row["tailnet"] = False
    return row


def apply_firewall(row, fw, networks):
    """A row the firewall blocks from the internet keeps only what the firewall lets in: the tailnet when its
    interface is open (`Anywhere on tailscale0`), else nothing but the machine itself. A row an allow rule opens on a
    firewall that denies by default is `firewalled`. Marks `firewall`: "allows" when the firewall lets the internet in,
    "blocks" when it does not, None when no firewall was read."""
    # Only ufw decides ports: the Mac's firewall allows or blocks programs, so it leaves every port as its address says.
    if fw is None or fw.get("tool") != "ufw" or row["reach"] not in ("internet", "lan"):
        row["firewall"] = None
        return row
    if firewall_lets_in(fw, row["proto"], row["port"]):
        row["firewall"] = "allows"
        # An active firewall that denies by default and opens this port with a rule of its own: open on purpose
        # (Tailscale's 41641/udp). Still reachable from the internet, but a choice someone made, not a leftover, so it
        # is `firewalled` rather than `internet` and raises no warning (James, 2026-11-06).
        if fw.get("active") and fw.get("incoming") != "allow" and row["reach"] == "internet":
            row["reach"] = "firewalled"
        return row
    row["firewall"] = "blocks"
    tail = bool(networks.get("tailnet")) and firewall_lets_in(fw, row["proto"], row["port"], iface="tailscale0")
    row["reach"] = "tailnet" if tail and row.get("tailnet") else "machine"
    row["tailnet"] = False
    return row


def network_rows(sockets, networks, details=None, fw=None, acl=None):
    """The machine's sockets with who can connect to each, one row per port: `ss` and `lsof` print a socket bound on
    both IPv4 and IPv6 twice, and a browser opens a UDP socket per interface, which is one thing to fix, not twenty.
    The most exposed first, each group in port order."""
    rows = {}
    for row in sockets:
        reach, tailnet = reach_of(row.get("address"), networks)
        key = (row.get("proto"), row.get("port"), reach)
        have = rows.get(key)
        if have is None:
            have = rows[key] = {"proto": row.get("proto"), "port": row.get("port"), "addresses": [],
                                "process": row.get("process"), "pid": row.get("pid"), "reach": reach,
                                "tailnet": tailnet}
        if row.get("address") not in have["addresses"]:
            have["addresses"].append(row.get("address"))
        have["tailnet"] = have["tailnet"] or tailnet
        if not have["process"] and row.get("process"):
            have["process"], have["pid"] = row.get("process"), row.get("pid")
    for row in rows.values():
        apply_firewall(row, fw, networks)
        apply_tailnet(row, acl)
        row["info"] = process_info(row.get("pid"), details or {})
        if row["info"] and row["info"]["name"]:
            row["process"] = row["info"]["name"]
    return sorted(rows.values(), key=lambda r: (REACH_RANK[r["reach"]], r.get("port") or 0, r.get("proto") or ""))


def network_section(sockets, networks, ssh_text=None, ssh_source=None, details=None, fw=None, acl=None,
                    peers=None, os=None, connections=None, upload_mb=None):
    """One machine's Network section: the networks it is on, every listening port with who can connect to it, the
    two sshd settings with where they were read — or null where the machine has nothing to say about ssh — and, since
    collector#66, the connections it has going out and the megabytes a process may send between two reads before the
    page marks it."""
    ssh = None if ssh_text is None else {"source": ssh_source, **sshd_flags(ssh_text)}
    return {"networks": networks, "firewall": fw, "tailnet_acl": acl, "tailnet_peers": peers or {}, "os": os,
            "sockets": network_rows(sockets, networks, details, fw, acl), "ssh": ssh,
            "connections": [] if connections is None else connections,
            "upload_warn_mb": network_upload_mb() if upload_mb is None else upload_mb}


def os_name(os_release=None, sw_vers=None):
    """The machine's operating system and version, as a person says it: "macOS 27.2" from `sw_vers`, "Ubuntu 26.04.1
    LTS" from /etc/os-release's PRETTY_NAME. None when neither is there."""
    if sw_vers:
        name = re.search(r"ProductName:\s*(.+)", sw_vers)
        ver = re.search(r"ProductVersion:\s*(.+)", sw_vers)
        if name:
            return f"{name.group(1).strip()} {ver.group(1).strip()}".strip() if ver else name.group(1).strip()
    for line in (os_release or "").splitlines():
        if line.startswith("PRETTY_NAME="):
            return line.split("=", 1)[1].strip().strip('"') or None
    return None


def os_read():
    """This machine's `os_name`: `sw_vers` on a Mac, /etc/os-release elsewhere."""
    if platform.system() == "Darwin":
        return os_name(sw_vers=read_command(["sw_vers"]))
    return os_name(os_release=read_text("/etc/os-release") if os.path.exists("/etc/os-release") else None)


def network_read():
    """This machine's Network section (collector#65, collector#66): what it listens on, who can connect to it, what
    it is connected out to, and what its sshd allows. No ss and no lsof is not an error — the section reads empty,
    the way every other read here does without its tool."""
    ssh = sshd_read()
    details = ps_details(
        read_command(["ps", "-axo", "pid=,ppid=,user=,etime=,comm="]) or "",
        read_command(["ps", "-axo", "pid=,args="]) if platform.system() == "Linux" else None,
    )
    sockets = listen_sockets()
    return network_section(sockets, machine_networks(interface_addresses()),
                           ssh_text=ssh[1] if ssh else None, ssh_source=ssh[0] if ssh else None, details=details,
                           fw=firewall_read(), acl=tailnet_acl_read(), peers=tailnet_peers(), os=os_read(),
                           connections=connections_read(sockets=sockets, details=details))


# What each machine sends out (collector#66): every established TCP connection with its process, its remote end, and
# the bytes the OS counts for it — `ss -tnpi` on Linux carries them on each socket, and a Mac needs `lsof` for the
# ends and `nettop` for the bytes, which a Mac counts per process. Read only, no sudo, nothing installed anywhere, and
# no traffic content: who connects where, and how much.
NETWORK = CONFIG.get("network") or {}
NETTOP = "/usr/bin/nettop" if os.path.exists("/usr/bin/nettop") else "nettop"
NETTOP_FIELDS = "bytes_in,bytes_out"
# The info line `ss -i` prints under a socket holds these two counters.
SS_INFO_FIELDS = ("bytes_sent", "bytes_received")
# The megabytes a process may send between two reads before the page marks it, when config.json says nothing.
DEFAULT_UPLOAD_WARN_MB = 50


def network_upload_mb(cfg=None):
    """The megabytes a process may send between two reads before the page marks it (collector#66): config.json's
    `network.uploadWarnMB`, else 50. A value that is not a positive number is left out rather than obeyed, so a typo
    cannot turn the mark off; the mark itself is worked out where the last read is kept, not here."""
    section = NETWORK if cfg is None else cfg
    raw = section.get("uploadWarnMB") if isinstance(section, dict) else None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw <= 0:
        return DEFAULT_UPLOAD_WARN_MB
    return float(raw)


def ss_info_counters(line):
    """(bytes sent, bytes received) out of the `ss -i` info line under a socket, or (None, None) when it carries
    neither — a socket that has not counted any traffic prints neither field."""
    found = {}
    for name in SS_INFO_FIELDS:
        match = re.search(rf"\b{name}:(\d+)", line or "")
        if match:
            found[name] = int(match.group(1))
    return (found.get("bytes_sent"), found.get("bytes_received"))


def parse_ss_established(text):
    """`ss -tnpi` output -> one row per established TCP connection: the remote end (address and port), the local end,
    and the process that owns it with the bytes sent and received on the socket, where the info line under it counts
    them (`bytes_scope` "socket": these are this socket's own). A connection in any other state (TIME-WAIT, SYN-SENT,
    CLOSE-WAIT) is not an established one and is skipped, and so is the header. `-p` shows the user's own processes
    without sudo, so a connection of another user's keeps its ends and no name."""
    out, last = [], None
    for line in (text or "").splitlines():
        if line[:1] in (" ", "\t"):
            # The `-i` info line belongs to the socket above it (`cubic ... bytes_sent:1024 bytes_received:2048`).
            sent, received = ss_info_counters(line)
            if last is not None:
                last["bytes_sent"], last["bytes_received"] = sent, received
            continue
        fields = line.split()
        if len(fields) < 5 or fields[0].upper() != "ESTAB":
            continue
        address, port = split_address(fields[4])
        if port is None:
            continue
        local_address, local_port = split_address(fields[3])
        owner = re.search(r'\("([^"]*)",pid=(\d+)', line)
        last = {"proto": "tcp", "address": address, "port": port, "local_address": local_address,
                "local_port": local_port, "process": owner.group(1) if owner else None,
                "pid": owner.group(2) if owner else None, "bytes_sent": None, "bytes_received": None,
                "bytes_scope": "socket"}
        out.append(last)
    return out


def parse_lsof_established(text):
    """`lsof -nP -iTCP -sTCP:ESTABLISHED` output -> the same rows as `parse_ss_established`, less the bytes: lsof
    counts none. The socket reads `local->remote` (`192.0.2.5:51234->198.51.100.1:443`), and the state lsof appends
    is not part of either end. A row that is not a connected socket is skipped. lsof cuts COMMAND to nine letters
    (and writes a space as `\\x20`), so the name here is a stand-in until `ps` gives the full one. lsof prints one
    line per file descriptor, and a process may hold one socket on two (ssh on fd 4 and fd 5), so a socket already
    read (same proto, both ends, pid) is read once."""
    out = []
    seen = set()
    for line in (text or "").splitlines():
        fields = line.split()
        if len(fields) < 3 or not fields[1].isdigit():
            continue  # the header, and anything that is not a socket row
        proto = next((i for i, word in enumerate(fields) if word.lower() in ("tcp", "udp")), None)
        if proto is None or proto + 1 >= len(fields) or "->" not in fields[proto + 1]:
            continue
        local, _, remote = fields[proto + 1].partition("->")
        local_address, local_port = split_address(local)
        address, port = split_address(remote)
        if port is None:
            continue
        key = (fields[proto].lower(), local_address, local_port, address, port, fields[1])
        if key in seen:
            continue  # the same socket on another file descriptor
        seen.add(key)
        out.append({"proto": fields[proto].lower(), "address": address, "port": port,
                    "local_address": local_address, "local_port": local_port,
                    "process": fields[0].replace("\\x20", " ").strip() or None, "pid": fields[1],
                    "bytes_sent": None, "bytes_received": None, "bytes_scope": None})
    return out


def parse_nettop(text):
    """`nettop -P -L 1 -n -J bytes_in,bytes_out` output -> pid -> (process name, bytes in, bytes out), the bytes a
    Mac counts per process, which lsof cannot give. nettop writes CSV: a header row (`,bytes_in,bytes_out,`), then
    one row per process, `name.pid,<in>,<out>,`. The pid is the part after the name's last dot (`python3.14.5696` is
    python3.14, pid 5696), and nettop cuts the name to 15 letters, so the join to lsof is on the pid. A line that is
    not such a row (the header, a blank tail) is skipped."""
    out = {}
    for line in (text or "").splitlines():
        fields = [f.strip() for f in line.split(",")]
        while fields and not fields[-1]:
            fields.pop()
        if len(fields) < 3:
            continue
        name, dot, pid = fields[0].rpartition(".")
        if not dot or not name or not pid.isdigit() or not (fields[1].isdigit() and fields[2].isdigit()):
            continue
        received, sent = int(fields[1]), int(fields[2])
        _, in_before, out_before = out.get(pid, (name, 0, 0))
        out[pid] = (name, in_before + received, out_before + sent)
    return out


def established_sockets():
    """Every established TCP connection this machine has: `ss -tnpi` on Linux, which carries the bytes on each
    socket; on a Mac (no ss) `lsof -nP -iTCP -sTCP:ESTABLISHED` for the remote ends, joined on the pid to
    `nettop -P -L 1 -n -J bytes_in,bytes_out` for the bytes each process counted, since lsof counts none. Both read
    through `read_command`, so a machine with neither tool reads empty. [] with no connection."""
    if platform.system() == "Linux":
        return parse_ss_established(read_command(["ss", "-tnpi"]) or "")
    rows = parse_lsof_established(read_command([LSOF, "-nP", "-iTCP", "-sTCP:ESTABLISHED"]) or "")
    return join_nettop(rows, parse_nettop(read_command([NETTOP, "-P", "-L", "1", "-n", "-J", NETTOP_FIELDS]) or ""))


def join_nettop(rows, per_process):
    """lsof's rows with the bytes nettop counted for their process. A Mac counts bytes per process, not per socket,
    so each row carries its process's total with `bytes_scope` "process": the page shows it as the process's total,
    and the seen-list counts it once per pid however many connections that process has open (collector#66, a
    process with five connections once counted five times its bytes)."""
    for row in rows:
        counted = per_process.get(str(row.get("pid") or ""))
        if counted:
            _, row["bytes_received"], row["bytes_sent"] = counted
            row["bytes_scope"] = "process"
    return rows


def ip_of(address):
    """An address as `ipaddress` reads it — brackets, a zone (`%en0`) and an IPv4-mapped IPv6 prefix taken off — or
    None for a text that is not an address."""
    a = (address or "").strip().strip("[]").split("%", 1)[0]
    try:
        ip = ipaddress.ip_address(a)
    except ValueError:
        return None
    return ip.ipv4_mapped if ip.version == 6 and ip.ipv4_mapped else ip


def is_lan_address(address):
    """True when an address is another device on this machine's own local network: a private one (RFC 1918, IPv6's
    unique-local range, the link-local ranges). Loopback (this machine itself), a Tailscale address (another
    machine, but not one on this network — its fd7a:115c:a1e0::/48 is inside the unique-local range) and a public
    address are not: an AirPlay probe from a phone is, and a server on the internet is not."""
    ip = ip_of(address)
    return bool(ip) and is_private(ip) and not in_tailnet(ip)


def is_loopback(address):
    """True for this machine talking to itself (127.0.0.0/8, ::1): never a destination, never a knock."""
    ip = ip_of(address)
    return bool(ip) and ip.is_loopback


def connections_read(*, rows=None, sockets=None, details=None):
    """This machine's connections going out (collector#66), and the knocks that reached it. A connection whose local
    port is a TCP port this machine listens on was accepted, not made: it is not going anywhere, so it is left out —
    except when its other end is another device on the local network, which is the knock the page flags (`inbound`:
    an AirPlay probe, a dev server someone on the Wi-Fi found). A connection to this machine itself (a loopback peer)
    is never a destination and is left out too: a quiet machine had 14 marks a minute from its own browser talking to
    its own dev server. The process name is the full one `ps` gives (`details`), where it has the pid. Inbound first,
    then by process, address and port, so a read is stable between two reads.

    `rows`, `sockets` and `details` are the reads a caller can hand in (a test does); left out, this machine is read.
    They are named by keyword on purpose: the first two are both lists of socket rows, and a positional call handed
    the listening sockets in as the connections once (collector#66, caught on the live page).
    """
    rows = established_sockets() if rows is None else rows
    listening = {row.get("port") for row in (listen_sockets() if sockets is None else sockets)
                 if (row.get("proto") or "tcp").startswith("tcp")}
    out = []
    for row in rows:
        if is_loopback(row.get("address")):
            continue
        accepted = row.get("local_port") in listening
        if accepted and not is_lan_address(row.get("address")):
            continue
        row = dict(row, inbound=accepted)
        d = (details or {}).get(str(row.get("pid") or ""))
        if d and file_name(d.get("path")):
            row["process"] = file_name(d["path"])
        out.append(row)
    return sorted(out, key=lambda r: (not r["inbound"], r.get("process") or "", r.get("address") or "",
                                      r.get("port") or 0))


def child_pids(links=None):
    """pid -> the pids started under it, from `ps -axo pid=,ppid=`. A leftover often holds no socket itself: the
    server it started listens (a shell runs `bun start`, and the server under that holds the port)."""
    children = {}
    for pid, ppid in parent_links() if links is None else links:
        children.setdefault(ppid, []).append(pid)
    return children


def parent_links():
    """(pid, ppid) for each line of `ps -axo pid=,ppid=`: one read of the machine's parentage, which both the children
    map (a leftover's server) and the walk up to tmux (collector#37) are built from. A process that is its own parent
    says nothing: read as a parent it would only make a loop."""
    links = []
    for line in (read_command(["ps", "-axo", "pid=,ppid="]) or "").splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0] != fields[1]:
            links.append((fields[0], fields[1]))
    return links


def parent_pids(links=None):
    """pid -> the pid it runs under, the same `ps -axo pid=,ppid=` read the other way."""
    return dict(parent_links() if links is None else links)


def descendants(pids, children, depth=3):
    """`pids` and everything started under them, a few levels deep: `script` runs a shell, the shell runs `bun start`,
    and the server under that holds the port."""
    seen, level = list(pids), list(pids)
    while level and depth:
        level = [kid for pid in level for kid in children.get(pid, []) if kid not in seen]
        seen.extend(level)
        depth -= 1
    return seen


def worktree_rows(out, steps=(), verifying=(), ports=None, children=None):
    """One row per card worktree with a process in it, from `ps -axo pid=,etime=,command=` output: a Hermes agent
    working in a worktree is its own row, named after its profile with the model that profile records. A worktree the
    work script says it is on now — a live step file in `steps`, or a key in `verifying`, a worktree a verify run
    matched — gets no row here: `running_agents` writes that row from the step. Anything else is a leftover, a process
    nothing is working for: its own row, named after the program it runs and the port it listens on (`ports`, with
    `children` to reach the process that holds the socket), never after the work script (James, 2026-10-25: "Foreman
    should never show building")."""
    ports, children = ports or {}, children or {}
    stepped = {(st.get("repo"), st.get("card")) for st in steps}
    found = {}
    for pid, etime, line in process_lines(out):
        m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)", line)
        if not m:
            continue
        key = (m.group(1), m.group(2), int(m.group(3)))
        row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "type": "script",
                                     "name": None, "seconds": -1, "command": "", "pids": []})
        row["pids"].append(pid)
        # The longest-lived process of the worktree names its row: it is the one that started the run there.
        if seconds(etime) >= row["seconds"]:
            row.update(seconds=seconds(etime), command=line)
        # `hermes -p <name> chat`, or the same argv inside a Python launcher: '-p', '<name>', 'chat'
        profile = re.search(r"(?:^|[\s'\"])-p'?,?\s+'?([\w.-]+)'?,?\s+'?chat\b", line)
        if profile:
            row.update(type="agent", name=profile.group(1))
            path = re.search(r"(/[^\s'\"`]*/\.worktrees/(?:build|review)-\d+)", line)
            if path and "model" not in row:
                row.update(agent_model(profile.group(1), path.group(1)) or {})
    rows = []
    for key, row in found.items():
        command, pids = row.pop("command", ""), row.pop("pids", [])
        if row["type"] == "agent":
            rows.append(row)  # the agent's own row, whether or not the work script has a step file for the card
            continue
        if (key[0], key[2]) in stepped or key in verifying:
            continue  # the work script's own step: running_agents writes that row from the step
        # A process nothing is working for: not an agent, no step of the work script's own on the card, no verify run
        # for its commit. It is never named after the work script (collector#32).
        row.update(type="leftover", kind="leftover", name=program_name(command))
        # The socket belongs to the process that listens, usually a child of the one the row is named after.
        listening = sorted({port for pid in descendants(pids, children) for port in ports.get(pid, [])})
        if listening:
            row["port"] = listening[0]
        rows.append(row)
    return rows


def running_agents():
    """One row per agent run: a Hermes agent working in a card worktree (<repo>/.worktrees/<build|review>-<card>),
    a running Claude Code or Codex session, with its own folder, card and model, the work script on the cards it says
    it is on now, the process left behind in a worktree nothing works on, and the lab droid on its own user. While a
    verify run is going on for the card's commit, the row shows that verify and its own time."""
    out = read_command(["ps", "-axo", "pid=,etime=,command="]) or ""
    # The droid is not this user's worktree, so it is read on its own with its user in front.
    droid_out = read_command(["ps", "-axo", "user=,pid=,etime=,command="]) or ""
    links = parent_links()
    droid_pids, droid = lab_droid(droid_out)
    steps, verifies = work_steps(), verify_runs()
    heads = verify_heads() if verifies else {}
    found = {}
    for row in worktree_rows(out, steps=steps, verifying={heads[c] for c, _, _ in verifies if c in heads},
                             ports=listen_ports(), children=child_pids(links)):
        found[(row["repo"], row["kind"], row["card"])] = row
    for st in steps:
        rows = [k for k in found if (k[0], k[2]) == (st["repo"], st["card"])]
        if any(found[k]["type"] == "agent" for k in rows):
            continue  # the agent's own row says what happens
        for k in rows:
            del found[k]
        found[(st["repo"], st["step"], st["card"])] = {
            "repo": st["repo"], "kind": st["step"], "card": st["card"], "type": "script", "name": WORK_SCRIPT,
            "seconds": max(0, int(time.time()) - st["since"])}
    for commit, feature, secs in sorted(verifies, key=lambda v: v[2]):
        key = heads.get(commit)
        if not key:
            continue
        row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "type": "script", "name": WORK_SCRIPT})
        # The newest verify for the card wins; the sort puts it last.
        row.update(kind="verify", feature=feature, seconds=secs)
    return ([found[k] for k in sorted(found)] + tool_sessions(out, skip={pid for pid, _ in droid_pids},
                                                             parents=parent_pids(links)) + droid)


def verify_heads():
    """HEAD commit of every card worktree -> (repo, build|review, card): what a verify run's own commit is matched
    against, so the row shows the card's verify."""
    heads = {}
    for path in glob.glob(os.path.join(REPOS, "*/.worktrees/*-*")):
        m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)$", path)
        head = (read_command(["git", "-C", path, "rev-parse", "HEAD"]) or "").strip()
        if m and head:
            heads[head] = (m.group(1), m.group(2), int(m.group(3)))
    return heads


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


TAILSCALE_BINS = ("tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale")


def tailscale_state():
    """This machine's tailnet state from `tailscale status --json` ("Running", "Stopped", "NeedsLogin", ...), or
    None with no tailscale here. The exit code is not read: `status` exits 1 while the tailnet is stopped."""
    for exe in TAILSCALE_BINS:
        try:
            done = subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            continue
        try:
            return json.loads(done.stdout).get("BackendState") or None
        except ValueError:
            return "Stopped" if "stopped" in (done.stdout + done.stderr).lower() else None
    return None


def tailnet_reasons(jobs, state):
    """A failed ssh job's reason when this machine's tailnet is down: the job cannot reach its host, and the
    exit code alone (ssh's 255) does not say why (signal-tunnel on altair, 2026-11-02)."""
    if not state or state == "Running":
        return jobs
    for j in jobs:
        if j.get("ssh_host") and j.get("last_status") not in (None, "ok") and not j.get("last_error"):
            j["last_error"] = f"Tailscale is {state.lower()} here, so ssh cannot reach {j['ssh_host']}"
    return jobs


# The Hermes gateway: the launchd job the waiting crew (agent-stack#261) runs on. `hermes gateway run` under this
# label supervises the Hermes cron jobs, so a gateway that is not running, or a cron ticker that has not moved in ten
# minutes, is a crew that stopped silently. The ticker writes the epoch second of its last successful tick to this
# file on every tick.
HERMES_GATEWAY_LABEL = "ai.hermes.gateway"
GATEWAY_TICKER = ".hermes/cron/ticker_last_success"
GATEWAY_TICKER_STALE = 600


def launchctl_pid(label):
    """The PID launchd reports for a loaded job, "" when it is loaded but nothing runs, or None when launchd does not
    know the label at all (`launchctl list <label>` exits 113: `Could not find service`). The command prints the
    job's own dictionary, one `"PID" = 1064;` line among others."""
    try:
        done = subprocess.run(["launchctl", "list", label], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return None
    for line in done.stdout.splitlines():
        key, _, value = line.partition("=")
        if key.strip().strip('"') == "PID":
            found = value.strip().strip(";").strip('"')
            # A job launchd has loaded but not started reports no PID, and some versions report 0 or `-` for one:
            # all three mean nothing runs.
            return "" if found in ("", "0", "-") else found
    return ""


def ticker_age(now, path):
    """How long ago the Hermes cron ticker last succeeded, from the epoch second the file holds (so the age needs no
    file mtime), or None with no such file — a machine whose Hermes keeps no ticker — or a file that holds no
    number. A ticker file that was never written is not a stale one, so it reads as no age either."""
    try:
        return max(0, int(now.timestamp() - float(open(path).read().strip())))
    except (OSError, ValueError):
        return None


def hermes_gateway(now, home=HOME, pid=launchctl_pid):
    """This machine's Hermes gateway: whether launchd runs `ai.hermes.gateway`, and how long ago its cron ticker last
    succeeded. None on a machine with no such job — no plist, and launchd does not know the label — which is a machine
    without Hermes, and the page draws no row for it. A job loaded with no PID is installed and not running, which is
    the row that matters. `now` is the snapshot's time, as every reader here takes it."""
    running = pid(HERMES_GATEWAY_LABEL)
    plist = os.path.join(home, "Library/LaunchAgents", HERMES_GATEWAY_LABEL + ".plist")
    if running is None and not os.path.exists(plist):
        return None
    return {
        "installed": True,
        "running": bool(running),
        "pid": running or None,
        "ticker_age_s": ticker_age(now, os.path.join(home, GATEWAY_TICKER)),
        "ticker_stale_s": GATEWAY_TICKER_STALE,
    }


# The agents and jobs Collector watches (collector#54): the Hermes jobs, the launchd jobs, `crontab -l`'s lines,
# the systemd timers, the Hermes gateway and its ticker, and the Claude Code and Codex sessions are read with no
# setting at all — they are the list. `watch` in config.json adds a user's own: one entry names one thing and the
# signal that says how it is doing, and how long that signal may be quiet. The server sends each machine only the
# entries that name it (lib/server/machines.ts), since a process, a launchd label and a file each belong to one
# machine and reading another machine's entry here would invent an idle row for it.
WATCH = CONFIG.get("watch") or []
# How long a log or a heartbeat file may go unwritten before the watch reads as idle, when the entry does not say.
WATCH_IDLE_S = 900
# The signals one entry may carry, in the order a row reads them when it carries more than one.
WATCH_SIGNALS = ("process", "session", "launchd", "log", "heartbeat")
# A `session` watch names the coding tool itself.
WATCH_TOOLS = ("claude", "codex")


def ago_text(seconds):
    """A duration in the words a watch row reads it in: "20 s", "12 min", "4 h", "2 days"."""
    if seconds < 90:
        return f"{int(seconds)} s"
    if seconds < 3600:
        return f"{round(seconds / 60)} min"
    if seconds < 172800:
        return f"{round(seconds / 3600)} h"
    return f"{round(seconds / 86400)} days"


def watch_file_age(now, path):
    """How long ago a watched file was last written, in seconds: the epoch second the file itself holds when it
    holds one (a heartbeat its writer stamps), else its own mtime. None with no such file — the row says so rather
    than reading it as an age."""
    try:
        text = open(path).read(64).strip()
    except OSError:
        return None
    try:
        return max(0, int(now.timestamp() - float(text)))
    except ValueError:
        pass
    try:
        return max(0, int(now.timestamp() - os.path.getmtime(path)))
    except OSError:
        return None


def last_line(path):
    """A log's last non-blank line, trimmed: what an entry's `fail_on` is matched against, and what the row shows
    when that line is the failure. Reads the tail, so a log of megabytes is not read whole."""
    lines = [line.strip() for line in tail_text(path, 4096).splitlines() if line.strip()]
    return lines[-1][:200] if lines else ""


def watch_process(ps_out, needle, skip=()):
    """The pid of the first process whose command line carries `needle`, or None. `skip` holds the reader's own
    pid: the entries reach collect.py as its own argument, so a watched name would otherwise match the reader
    itself and read as a process that never stops."""
    for pid, _, command in process_lines(ps_out):
        if pid not in skip and needle in command:
            return pid
    return None


def watch_session(ps_out, tool, skip=()):
    """The pid of a running Claude Code or Codex session of that tool, or None. The same reader the Current work
    rows use, so Claude Code's own helper processes are not a session here either and a Codex shim and the binary
    under it stay one run."""
    for pid, _, command in process_lines(ps_out):
        if pid not in skip and tool_of(command) == tool:
            return pid
    return None


def launchd_job(label):
    """`launchctl list <label>`: (whether launchd knows the label, its output). launchd exits 113 for a label it
    does not know, and prints the job's own dictionary — a `"PID"` line and a `"LastExitStatus"` line among
    others — for one it does."""
    try:
        done = subprocess.run(["launchctl", "list", label], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return (False, "")
    return (done.returncode == 0, done.stdout)


def launchd_run(out):
    """(the PID launchd reports, the job's last exit status) out of a job's own dictionary, either one None when
    the job carries no such line. A job launchd has loaded but not started reports no PID."""
    pid = re.search(r'"PID"\s*=\s*(\d+)\s*;', out or "")
    code = re.search(r'"LastExitStatus"\s*=\s*(-?\d+)\s*;', out or "")
    return (pid.group(1) if pid else None, code.group(1) if code else None)


def launchd_code(status):
    """A launchd exit status as a person reads it: launchd reports the raw wait status, so the live Collector job
    that a kickstart ended with SIGTERM reads 36608 there and one that exited 1 reads 256. A status above 255 is
    the exit code shifted up, so it is divided back; anything else is already the code. None for no status at all,
    which is a job that has never run rather than one that failed."""
    try:
        code = int(status)
    except (TypeError, ValueError):
        return None
    return str(code >> 8) if code > 255 else str(code)


def watch_row(entry, now, ps_out="", jobs=None, self_pid=None):
    """One watched agent's row: what the entry's own signal says about it now.

    `state` is `busy` while the signal is alive (a process or a session running, a launchd job with a PID), `ok`
    when nothing is wrong and nothing is running (a launchd job whose last run worked, a log or a heartbeat written
    inside `idle_after`), `idle` when there is nothing there — no process, no session, no file, or a file older
    than `idle_after` — and `failed` for a launchd job whose last run exited non-zero (an `ok_exits` entry for that
    label still means success) or a log whose last line carries `fail_on`. An entry Collector cannot read is
    `unknown`, which the page says rather than dropping the setting silently.

    `detail` completes the warning's own words, `<name> on <machine>: <detail>`.
    """
    name = str(entry.get("name") or "a watched agent")
    signal = next((k for k in WATCH_SIGNALS if entry.get(k)), None)
    row = {"name": name, "signal": signal, "state": "unknown", "detail": ""}
    if signal is None:
        row["detail"] = f"no signal Collector reads ({', '.join(WATCH_SIGNALS)})"
        return row
    skip = {str(self_pid)} if self_pid else set()
    if signal == "process":
        pid = watch_process(ps_out, str(entry["process"]), skip)
        row.update(state="busy" if pid else "idle", detail=f"running as pid {pid}" if pid else "not running")
        return row
    if signal == "session":
        tool = str(entry["session"])
        if tool not in WATCH_TOOLS:
            row.update(state="unknown", detail=f"session must be one of {', '.join(WATCH_TOOLS)}, not {tool}")
            return row
        pid = watch_session(ps_out, tool, skip)
        row.update(state="busy" if pid else "idle",
                   detail=f"{TOOL_NAMES[tool]} running as pid {pid}" if pid else f"no {TOOL_NAMES[tool]} session")
        return row
    if signal == "launchd":
        label = str(entry["launchd"])
        known, out = launchd_job(label) if jobs is None else jobs(label)
        if not known:
            row.update(state="failed", detail=f"launchd has no {label} on this machine")
            return row
        pid, code = launchd_run(out)
        code = launchd_code(code)
        if pid:
            row.update(state="busy", detail=f"running as pid {pid}")
        elif code not in (None, "0") and code not in (OK_EXITS.get(label) or {}):
            row.update(state="failed", detail=f"last run exit {code}")
        else:
            row.update(state="ok", detail=f"last run exit {code or '0'}")
        return row
    # A log or a heartbeat file: how long ago it was written says both the state and the words.
    limit = entry.get("idle_after", WATCH_IDLE_S)
    # A limit that is not a positive number of seconds ("900", 0, true) would raise in the age comparison and take
    # the machine's whole read down with it, so this one row says the value instead.
    if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not limit > 0:
        row.update(state="unknown", detail=f"idle_after must be a positive number of seconds, not {json.dumps(limit)}")
        return row
    path = os.path.expanduser(str(entry[signal]))
    age = watch_file_age(now, path)
    if age is None:
        row.update(state="idle", detail=f"no {signal} file at {path}")
        return row
    if signal == "log" and entry.get("fail_on"):
        line = last_line(path)
        if str(entry["fail_on"]).lower() in line.lower():
            row.update(state="failed", detail=f"its log ends with {line!r}")
            return row
    if age > limit:
        row.update(state="idle", detail=f"nothing written for {ago_text(age)}")
    else:
        row.update(state="ok", detail=f"written {ago_text(age)} ago")
    return row


def watch_rows(now, entries=None, ps_out=None, jobs=None, self_pid=None):
    """One row per watched agent (collector#54), from the entries config.json gave this machine. Nothing
    configured is no rows at all, so a machine watching nothing new reads exactly as it did.

    `ps_out` and `jobs` are the two reads a caller can hand in (a test does); left out, this machine is read: one
    `ps` for its processes, and `launchctl list <label>` once per launchd entry.
    """
    entries = WATCH if entries is None else entries
    if not isinstance(entries, list):
        return [{"name": "watch", "signal": None, "state": "unknown",
                 "detail": "config.json's watch is not a list of entries"}]
    if ps_out is None:
        ps_out = read_command(["ps", "-axo", "pid=,etime=,command="]) or ""
    self_pid = os.getpid() if self_pid is None else self_pid
    return [watch_row(e, now, ps_out=ps_out, jobs=jobs, self_pid=self_pid) if isinstance(e, dict)
            else {"name": "watch", "signal": None, "state": "unknown",
                  "detail": f"a watch entry must be an object, not {json.dumps(e)}"}
            for e in entries]


def main():
    now = datetime.now(timezone.utc).astimezone()
    starts = work_script_starts(now.replace(tzinfo=None))
    tailnet = tailscale_state()
    print(json.dumps({
        "host": socket.gethostname(),
        "tz": time.strftime("%Z"),
        "now": now.isoformat(),
        "jobs": tailnet_reasons(hermes_jobs(now) + launchd_jobs() + crontab_jobs(now) + systemd_jobs(now), tailnet),
        "tailscale": tailnet,
        "hermes_gateway": hermes_gateway(now),
        "network": network_read(),
        "watch": watch_rows(now),
        "running": running_agents(),
        "host_broken": host_broken(),
        "profiles": hermes_profiles(),
        "work_ticks_10m": len(starts) if starts is not None else None,
        "work_starts_10m": starts,
    }))


if __name__ == "__main__":
    main()
