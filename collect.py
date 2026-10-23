#!/usr/bin/env python3
"""Print one JSON snapshot of this machine's cron jobs and running agents.

The server runs it locally and on each remote machine over `ssh <host> python3 - '<config>' < collect.py`,
so it uses the standard library only. It reads Hermes's cron files (~/.hermes), the foreman's host-broken
markers, launchd (macOS), ps, docker, git, and the session files Claude Code and Codex keep on this machine, and
changes nothing.
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


def tool_of(command):
    """The coding tool one process runs: 'claude', 'codex', or None. An npm shim shows as `node .../codex.js`, so the
    program and its first argument are both read; a name that only holds the word (`claudette`, `codex-notes`) is not
    the tool."""
    for token in (command or "").split(None, 2)[:2]:
        name = re.sub(r"\.(?:js|cjs|mjs|exe)$", "", os.path.basename(token))
        if name in ("claude", "codex"):
            return name
        # codex's own binary, named after its Rust target: codex-x86_64-unknown-linux-musl, codex-aarch64-apple-darwin
        if name.startswith("codex-") and any(target in name for target in ("linux", "darwin", "windows", "musl", "gnu")):
            return "codex"
    return None


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


def process_cwd(pid):
    """One process's working directory: /proc on Linux, lsof elsewhere (macOS has no /proc)."""
    proc = f"/proc/{pid}/cwd"
    if os.path.exists(proc):
        try:
            return os.readlink(proc)
        except OSError:
            return None
    try:
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-d", "cwd", "-Fn"],
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


def tool_model(tool, cwd, home=HOME):
    """What a tool's own session files say about a session in this folder: {"model": name}, or {} when it recorded
    none. Nothing here goes near the network."""
    return claude_model(cwd, home) if tool == "claude" else codex_model(cwd, home)


def tool_rows(out, facts, models=None):
    """One row per running Claude Code or Codex session: the tool, the repo and card its folder is a card worktree
    for, and how long it has run. `facts` maps a pid to (folder, branch, checkout top level) and `models` maps
    (tool, folder) to what the tool's session files record. One session per folder: Codex's npm shim and the binary
    under it are two processes of one run, so the longest-lived process is the one that shows."""
    models = models or {}
    found = {}
    for pid, etime, command in process_lines(out):
        tool = tool_of(command)
        if not tool:
            continue
        cwd, branch, root = facts.get(pid, (None, None, None))
        key = (tool, cwd or f"pid {pid}")
        if key in found and found[key]["seconds"] >= seconds(etime):
            continue
        repo, card = session_place(cwd, branch, root)
        found[key] = {"repo": repo, "kind": "session", "card": card, "seconds": seconds(etime),
                      "type": "agent", "name": tool, **models.get((tool, cwd), {})}
    return [found[k] for k in sorted(found)]


def tool_sessions(out):
    """Every running Claude Code or Codex session on this machine, with the model its own session files record."""
    facts, models = {}, {}
    for pid, _, command in process_lines(out):
        tool = tool_of(command)
        if not tool:
            continue
        cwd = process_cwd(pid)
        branch, root = git_facts(cwd)
        facts[pid] = (cwd, branch, root)
        if cwd and (tool, cwd) not in models:
            models[(tool, cwd)] = tool_model(tool, cwd)
    return tool_rows(out, facts, models)


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
    """One row per agent run: a Hermes agent working in a card worktree (<repo>/.worktrees/<build|review>-<card>),
    and a running Claude Code or Codex session, with its own folder, card and model.
    While a verify run is going on for the card's commit, the row shows that verify and its own time."""
    out = subprocess.run(["ps", "-axo", "pid=,etime=,command="], capture_output=True, text=True).stdout
    found = {}
    for _, etime, line in process_lines(out):
        m = re.search(r"/([\w.-]+)/\.worktrees/(build|review)-(\d+)", line)
        path = re.search(r"(/[^\s'\"`]*/\.worktrees/(?:build|review)-\d+)", line)
        if not m:
            continue
        key = (m.group(1), m.group(2), int(m.group(3)))
        row = found.setdefault(key, {"repo": key[0], "kind": key[1], "card": key[2], "seconds": 0, "type": "script", "name": None})
        row["seconds"] = max(row["seconds"], seconds(etime))
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
    return [found[k] for k in sorted(found)] + tool_sessions(out)


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
        "jobs": hermes_jobs(now) + launchd_jobs(),
        "running": running_agents(),
        "host_broken": host_broken(),
        "profiles": hermes_profiles(),
        "work_ticks_10m": len(starts) if starts is not None else None,
        "work_starts_10m": starts,
    }))


if __name__ == "__main__":
    main()
