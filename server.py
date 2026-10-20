#!/usr/bin/env python3
"""Collector: every cron job and agent run on your machines, live, at http://localhost:4000.

Reads only. Each refresh runs collect.py on every machine in config.json (locally, or over SSH),
adds the GitHub API limit, and works out the warnings. No database, no agent, no dependencies.
"""
import json
import shlex
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
COLLECT = os.path.join(HERE, "collect.py")
CONFIG_PATH = os.environ.get("COLLECTOR_CONFIG") or os.path.join(HERE, "config.json")
PORT = int(os.environ.get("COLLECTOR_PORT", "4000"))
SSH = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "ControlMaster=auto",
       "-o", f"ControlPath={os.path.expanduser('~/.ssh')}/collector-%r@%h", "-o", "ControlPersist=300"]
CACHE_SECONDS = 10
# The settings collect.py needs on each machine; the rest stays on the server.
REMOTE_KEYS = ("launchd_prefixes", "ok_exits", "work_script", "verify_label", "repos_dir")


def config():
    """config.json, read on every refresh so an edit shows at once. No file: this machine only."""
    try:
        return json.load(open(CONFIG_PATH))
    except FileNotFoundError:
        return {}

_lock = threading.Lock()
_cache = {"at": 0, "body": b"{}"}


def run(cmd, stdin=None, timeout=20):
    try:
        p = subprocess.run(cmd, stdin=stdin, capture_output=True, text=True, timeout=timeout)
        if p.returncode == 0:
            return json.loads(p.stdout), None
        return None, (p.stderr.strip() or f"exit {p.returncode}")[:300]
    except Exception as e:
        return None, str(e)[:300]


def collect(machine, cfg):
    remote = json.dumps({k: cfg[k] for k in REMOTE_KEYS if k in cfg})
    if not machine.get("ssh"):
        return run([sys.executable, COLLECT, remote])
    with open(COLLECT) as f:
        return run(SSH + [machine["ssh"], "python3", "-", shlex.quote(remote)], stdin=f)


def github_limit():
    data, err = run(["gh", "api", "rate_limit"], timeout=10)
    if not data:
        return {"error": err}
    r = data["resources"]
    return {k: {"used": r[k]["used"], "limit": r[k]["limit"], "reset": r[k]["reset"]} for k in ("graphql", "core")}


def warnings(machines, limit, cfg):
    out = []
    by_script = {}
    what = cfg.get("jobs") or {}
    work = cfg.get("work_script") or {}
    work_jobs = set(work.get("jobs") or ())
    work_label = work.get("label") or "The work script"
    for m in machines:
        for j in m.get("jobs", []):
            j["machine"] = m["name"]
            j["what"] = what.get(j["name"], j.get("script") or "")
            if not j["enabled"]:
                continue
            if j["last_status"] and not j["last_status"].startswith("ok"):
                out.append({"level": "error", "text": f"{j['name']} on {m['name']}: last run {j['last_status']}"
                            + (f" ({j['last_error'][:140]})" if j.get("last_error") else "")})
            key = work_label if j["name"] in work_jobs else j.get("script")
            if key:
                by_script.setdefault(key, []).append(f"{j['name']} on {m['name']}")
        ticks = m.get("work_ticks_10m")
        limit_10m = work.get("max_starts_10m", 15)
        if ticks and ticks > limit_10m:
            out.append({"level": "error", "text": f"{work_label} on {m['name']} started {ticks} times in the last 10 minutes "
                        f"(more than {limit_10m}): it is starting itself in a loop"})
    for script, where in by_script.items():
        if len(where) > 1:
            out.append({"level": "warn", "text": f"The same script ({script}) starts from {len(where)} jobs: " + ", ".join(where)})
    g = limit.get("graphql")
    if g and g["limit"] - g["used"] < 500:
        out.append({"level": "error", "text": f"GitHub GraphQL limit nearly gone: {g['limit'] - g['used']} of {g['limit']} left"})
    for m in machines:
        if m.get("error"):
            out.append({"level": "error", "text": f"Could not read {m['name']}: {m['error']}"})
    order = {"error": 0, "warn": 1}
    return sorted(out, key=lambda w: order[w["level"]])


def snapshot():
    cfg = config()
    targets = cfg.get("machines") or [{"name": "this machine"}]
    with ThreadPoolExecutor(len(targets) + 1) as pool:
        futures = [(t, pool.submit(collect, t, cfg)) for t in targets]
        limit = pool.submit(github_limit)
        machines = []
        for t, fut in futures:
            data, err = fut.result()
            machines.append(dict(data or {}, name=t["name"], error=err))
        limit = limit.result()
    return {"at": int(time.time()), "machines": machines, "github": limit, "warnings": warnings(machines, limit, cfg)}


def state():
    with _lock:
        if time.time() - _cache["at"] > CACHE_SECONDS:
            _cache["body"] = json.dumps(snapshot()).encode()
            _cache["at"] = time.time()
        return _cache["body"]


def version():
    """Newest change to any Collector file. The page reloads itself when this moves."""
    return str(max(os.path.getmtime(os.path.join(HERE, f)) for f in os.listdir(HERE) if f.endswith((".py", ".html"))))


def restart_on_change():
    """Hot reload for the server itself: re-exec when server.py changes (collect.py runs fresh each refresh)."""
    me = os.path.abspath(__file__)
    start = os.path.getmtime(me)
    while True:
        time.sleep(1)
        try:
            if os.path.getmtime(me) != start:
                os.execv(sys.executable, [sys.executable, me])
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/state":
            body, kind = state(), "application/json"
        elif self.path == "/api/version":
            body, kind = version().encode(), "text/plain"
        elif self.path in ("/", "/index.html"):
            body, kind = open(os.path.join(HERE, "index.html"), "rb").read(), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=restart_on_change, daemon=True).start()
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
