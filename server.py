#!/usr/bin/env python3
"""Collector: every cron job and agent run on your machines, live, at http://localhost:4000.

Reads only. Each refresh runs collect.py on every machine in config.json (locally, or over SSH),
adds the GitHub API limit, and works out the warnings. No database, no agent, no dependencies.
"""
import json
import re
import shlex
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
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


SLOW_SECONDS = 3
_services = []  # the last check; the page asks for a new one (GET /api/services) once a minute


def check(service):
    """One GET of the service URL: online, slow (over SLOW_SECONDS), or down (an error or a 4xx/5xx answer)."""
    start = time.time()
    try:
        req = urllib.request.Request(service["url"], headers={"User-Agent": "collector-health-check"})
        with urllib.request.urlopen(req, timeout=10) as r:
            code, headers = r.status, r.headers
        error = None
    except urllib.error.HTTPError as e:
        code, error, headers = e.code, f"HTTP {e.code}", e.headers
    except Exception as e:
        code, error, headers = None, str(getattr(e, "reason", e))[:140], {}
    ms = int((time.time() - start) * 1000)
    status = "down" if error else "slow" if ms > SLOW_SECONDS * 1000 else "online"
    return dict(service, status=status, code=code, ms=ms, error=error, checked_at=int(time.time()),
                hosting=host_from_headers(headers or {}))


# The response header each host adds to every answer.
HOST_HEADERS = (("x-vercel-id", "Vercel"), ("fly-request-id", "Fly.io"), ("x-nf-request-id", "Netlify"),
                ("x-railway-request-id", "Railway"), ("x-render-origin-server", "Render"))
# Files at a repo's root that name its host.
HOST_FILES = ((".kamal", "Self-hosted (Kamal)"), ("fly.toml", "Fly.io"), ("vercel.json", "Vercel"), ("netlify.toml", "Netlify"),
              ("railway.json", "Railway"), ("railway.toml", "Railway"), ("render.yaml", "Render"))


def host_from_headers(headers):
    for name, host in HOST_HEADERS:
        if headers.get(name):
            return host
    return None


def check_services():
    listed = config().get("services") or []
    with ThreadPoolExecutor(max(len(listed), 1)) as pool:
        _services[:] = pool.map(check, listed)
    with _lock:
        _cache["at"] = 0  # the next /api/state carries the new results into Needs attention
    return _services


PROJECT_SECONDS = 300  # project details use about 5 REST calls per repo; five minutes keeps that small
_projects = {"at": 0, "key": None, "list": []}
_repos = {"at": 0, "list": []}


def all_repos():
    """Every repo the gh login can see (own and orgs), for the repo picker. One GraphQL call per owner, cached."""
    if time.time() - _repos["at"] < 600 and _repos["list"]:
        return _repos["list"]
    owners = [None]
    orgs, _ = run(["gh", "api", "user/orgs"], timeout=15)
    owners += [o["login"] for o in orgs or []]
    found = []
    for owner in owners:
        data, err = run(["gh", "repo", "list"] + ([owner] if owner else []) +
                        ["--limit", "300", "--json", "nameWithOwner,description,isPrivate,isArchived,pushedAt"], timeout=30)
        found += [r for r in data or [] if not r["isArchived"]]
    found.sort(key=lambda r: r["pushedAt"], reverse=True)
    _repos.update(at=time.time(), list=found)
    return found


def project(repo):
    info, err = run(["gh", "api", f"repos/{repo}"], timeout=15)
    if not info:
        return {"repo": repo, "error": err}
    pulls, _ = run(["gh", "api", f"repos/{repo}/pulls?state=open&per_page=100"], timeout=15)
    runs, _ = run(["gh", "api", f"repos/{repo}/actions/runs?branch={info['default_branch']}&event=push&per_page=1"], timeout=15)
    last = ((runs or {}).get("workflow_runs") or [None])[0]
    # Hosting: the bot that made the newest deployment (vercel[bot]), or a host's file at the repo root.
    deploys, _ = run(["gh", "api", f"repos/{repo}/deployments?per_page=1"], timeout=15)
    tree, _ = run(["gh", "api", f"repos/{repo}/git/trees/{info['default_branch']}?recursive=1"], timeout=20)
    bot = ((deploys or [{}])[0].get("creator") or {}).get("login", "") if deploys else ""
    # Every file and folder name in the repo, so an app in a subfolder (web/config/deploy.yml) counts too.
    names = {p.rsplit("/", 1)[-1] for p in (x["path"] for x in (tree or {}).get("tree", []))}
    paths = {x["path"] for x in (tree or {}).get("tree", [])}
    if any(p == "config/deploy.yml" or p.endswith("/config/deploy.yml") for p in paths):
        names.add(".kamal")
    hosting = bot.removesuffix("[bot]").capitalize() if bot.endswith("[bot]") and bot != "github-actions[bot]" else \
        next((host for name, host in HOST_FILES if name in names), None)
    prs = len(pulls or [])
    return {
        "repo": repo, "name": info["name"], "url": info["html_url"], "description": info.get("description") or "",
        "homepage": info.get("homepage") or "", "private": info["private"], "pushed_at": info["pushed_at"],
        "archived": info["archived"], "hosting": hosting,
        "issues": info["open_issues_count"] - prs, "prs": prs,
        "ci": {"status": last["status"], "conclusion": last["conclusion"], "name": last["name"], "url": last["html_url"]} if last else None,
    }


def flat(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def projects(force=False):
    cfg = config()
    chosen = cfg.get("projects") or []
    if force or _projects["key"] != chosen or time.time() - _projects["at"] > PROJECT_SECONDS:
        with ThreadPoolExecutor(max(len(chosen), 1)) as pool:
            _projects["list"] = list(pool.map(project, chosen))
        _projects.update(at=time.time(), key=chosen)
    # A project's live site: the service with the repo's name (zero-phase = ZeroPhase), else its GitHub homepage.
    # The product name comes from the same service (ZeroPhase); without one, the repo name in title case.
    sites = {flat(x["name"]): x for x in cfg.get("services") or []}
    for p in _projects["list"]:
        if "name" in p:
            site = sites.get(flat(p["name"])) or {}
            p["live"] = site.get("url") or p["homepage"]
            p["title"] = site.get("name") or p["name"].replace("-", " ").title()
    return {"at": int(_projects["at"]), "projects": _projects["list"]}


def save_projects(repos):
    """The repo picker's one write: the chosen repos go into config.json under "projects"."""
    cfg = config()
    cfg["projects"] = [r for r in repos if isinstance(r, str) and re.fullmatch(r"[\w.-]+/[\w.-]+", r)]
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    return cfg["projects"]


def warnings(machines, limit, cfg, checked=()):
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
    for x in checked:
        if x["status"] == "down":
            out.append({"level": "error", "text": f"{x['name']} is down: {x['error']} ({x['url']})"})
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
    return {"at": int(time.time()), "machines": machines, "github": limit, "subscriptions": cfg.get("subscriptions") or [],
            "warnings": warnings(machines, limit, cfg, _services)}


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
        elif self.path == "/api/services":
            body, kind = json.dumps(check_services()).encode(), "application/json"
        elif self.path == "/api/projects":
            body, kind = json.dumps(projects()).encode(), "application/json"
        elif self.path == "/api/repos":
            body, kind = json.dumps({"repos": all_repos(), "chosen": config().get("projects") or []}).encode(), "application/json"
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

    def do_POST(self):
        # JSON only: a browser cannot send application/json across origins without a preflight, which this server never answers.
        if self.path != "/api/projects" or self.headers.get("Content-Type") != "application/json":
            self.send_error(404)
            return
        try:
            repos = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))["repos"]
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
            return
        save_projects(repos)
        body = json.dumps(projects(force=True)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    threading.Thread(target=restart_on_change, daemon=True).start()
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
