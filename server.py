#!/usr/bin/env python3
"""Collector: every cron job and agent run on your machines, live, at http://localhost:4000.

Reads only. Each refresh runs collect.py on every machine in config.json (locally, or over SSH),
adds the GitHub API limit, and works out the warnings. No database, no agent, no dependencies.
"""
import base64
import datetime as dt
import json
import re
import shlex
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
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


_x_usage = {"at": 0, "data": None}


def x_usage():
    """Posts read this month against the X API project cap (developer.x.com) and the pay-per-use credit balance,
    with X_BEARER_TOKEN from .env. None when no key is set. Cached five minutes."""
    key = env_file().get("X_BEARER_TOKEN")
    if not key:
        return None
    if time.time() - _x_usage["at"] > 300:
        req = urllib.request.Request("https://api.x.com/2/usage/tweets",
                                     headers={"Authorization": f"Bearer {key}", "User-Agent": "collector"})
        try:
            d = json.load(urllib.request.urlopen(req, timeout=10)).get("data") or {}
            _x_usage["data"] = {"used": int(d.get("project_usage") or 0), "limit": int(d.get("project_cap") or 0),
                                "reset_day": d.get("cap_reset_day")}
            req = urllib.request.Request("https://api.x.com/2/usage/credits",
                                         headers={"Authorization": f"Bearer {key}", "User-Agent": "collector"})
            c = json.load(urllib.request.urlopen(req, timeout=10)).get("data") or {}
            grants = [g.get("expires_at") for g in c.get("free_grants") or [] if g.get("expires_at")]
            _x_usage["data"]["credits"] = {"total": c.get("total_balance"), "free": c.get("free_balance"),
                                           "prepaid": c.get("prepaid_balance"), "free_expires": min(grants) if grants else None}
        except Exception as e:
            _x_usage["data"] = {"error": f"Could not read X API usage: {str(getattr(e, 'reason', e))[:80]}"}
        _x_usage["at"] = time.time()
    return _x_usage["data"]


SLOW_SECONDS = 3
_services = []  # the last check; the page asks for a new one (GET /api/services) once a minute


def check(service):
    """One GET of the service URL: online, slow (over SLOW_SECONDS), or down (an error or a 4xx/5xx answer)."""
    start = time.time()
    try:
        req = urllib.request.Request(service["url"], headers={"User-Agent": "collector-health-check", **service.get("headers", {})})
        with urllib.request.urlopen(req, timeout=10) as r:
            code, headers = r.status, r.headers
        error = None
    except urllib.error.HTTPError as e:
        code, error, headers = e.code, f"HTTP {e.code}", e.headers
    except Exception as e:
        code, error, headers = None, str(getattr(e, "reason", e))[:140], {}
    ms = int((time.time() - start) * 1000)
    status = "down" if error else "slow" if ms > SLOW_SECONDS * 1000 else "online"
    return dict({k: v for k, v in service.items() if k != "headers"}, status=status, code=code, ms=ms, error=error,
                checked_at=int(time.time()),
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


DOMAIN_SECONDS = 12 * 3600  # registry dates change once a year; twice a day is plenty
_domains = {"at": 0, "list": []}
_domains_lock = threading.Lock()


def rdap(name):
    """Registrar and dates from the public RDAP registry (no account, no key). None when the registry has no RDAP."""
    try:
        req = urllib.request.Request(f"https://rdap.org/domain/{name}", headers={"Accept": "application/rdap+json"})
        j = json.load(urllib.request.urlopen(req, timeout=15))
    except (OSError, ValueError):  # a 404 can mean "no RDAP for this TLD" (.io): whois decides
        return None
    events = {e.get("eventAction"): (e.get("eventDate") or "")[:10] for e in j.get("events") or []}
    registrar = next((x[3] for e in j.get("entities") or [] if "registrar" in (e.get("roles") or [])
                      for x in (e.get("vcardArray") or [None, []])[1] if x[0] == "fn"), None)
    registrar = registrar.strip().rstrip(".") if registrar else None
    if not events.get("expiration"):
        return None
    return {"registered": True, "registrar": registrar, "expires": events.get("expiration"), "since": events.get("registration")}


def whois(name):
    """The fallback for registries without RDAP (.io): the whois command."""
    try:
        text = subprocess.run(["whois", name], capture_output=True, text=True, timeout=20).stdout
    except (OSError, subprocess.SubprocessError):
        return {"error": "no RDAP and no whois answer"}
    if re.search(r"(?im)^(no match|not found|domain not found|no data found)", text):
        return {"registered": False}
    exp = re.search(r"(?im)^\s*(?:registry expiry date|registrar registration expiration date|expir\w* date):\s*(\d{4}-\d{2}-\d{2})", text)
    reg = re.search(r"(?im)^\s*registrar:\s*(.+)$", text)
    since = re.search(r"(?im)^\s*creation date:\s*(\d{4}-\d{2}-\d{2})", text)
    if not exp:
        return {"registered": False} if not reg else {"error": "whois shows no expiry date"}
    return {"registered": True, "registrar": reg.group(1).strip().rstrip(".") if reg else None,
            "expires": exp.group(1), "since": since.group(1) if since else None}


def cert_expiry(name):
    """When the HTTPS certificate on the domain runs out (YYYY-MM-DD), or None."""
    import socket, ssl
    try:
        with socket.create_connection((name, 443), timeout=8) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname=name) as tls:
                after = tls.getpeercert().get("notAfter")
        return time.strftime("%Y-%m-%d", time.gmtime(ssl.cert_time_to_seconds(after))) if after else None
    except (OSError, ValueError):
        return None


VERCEL_AUTH = os.path.expanduser("~/Library/Application Support/com.vercel.cli/auth.json")


def api_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "User-Agent": "collector"})
    return json.load(urllib.request.urlopen(req, timeout=15))


def vercel_renew():
    """{domain: auto-renew} for domains bought through Vercel. Key: VERCEL_TOKEN in .env, else the Vercel CLI's own login."""
    token = os.environ.get("VERCEL_TOKEN") or env_file().get("VERCEL_TOKEN")
    if not token:
        try:
            token = json.load(open(VERCEL_AUTH)).get("token")
        except (OSError, ValueError):
            return {}
    out = {}
    try:
        teams = [t["id"] for t in api_json("https://api.vercel.com/v2/teams", token).get("teams") or []]
        for team in [None] + teams:
            url = "https://api.vercel.com/v5/domains?limit=100" + (f"&teamId={team}" if team else "")
            for d in api_json(url, token).get("domains") or []:
                if d.get("boughtAt"):  # bought through Vercel: Vercel renews it
                    out[d["name"]] = bool(d.get("renew"))
    except (OSError, ValueError, KeyError):
        pass
    return out


def cloudflare_renew():
    """{domain: auto-renew} from Cloudflare Registrar. Key: CLOUDFLARE_REGISTRAR_TOKEN in .env (an API token that can
    read the account's Registrar domains)."""
    token = os.environ.get("CLOUDFLARE_REGISTRAR_TOKEN") or env_file().get("CLOUDFLARE_REGISTRAR_TOKEN")
    _domains["cf_error"] = None
    if not token:
        return {}
    out = {}
    try:
        accounts = api_json("https://api.cloudflare.com/client/v4/accounts", token).get("result") or []
        if not accounts:
            _domains["cf_error"] = "The token cannot see your account: add Account Settings Read, and set Account Resources to your account"
        for acct in accounts:
            for d in api_json(f"https://api.cloudflare.com/client/v4/accounts/{acct['id']}/registrar/domains", token).get("result") or []:
                if "auto_renew" in d:
                    out[d["name"]] = bool(d["auto_renew"])
    except urllib.error.HTTPError as e:
        _domains["cf_error"] = f"Cloudflare refused the token (HTTP {e.code}): it needs Registrar read access"
    except (OSError, ValueError, KeyError) as e:
        _domains["cf_error"] = f"Cloudflare did not answer: {str(e)[:120]}"
    return out


def days_left(day):
    return None if not day else int((time.mktime(time.strptime(day, "%Y-%m-%d")) - time.time()) // 86400) + 1


def check_domain(name):
    row = {"name": name}
    row.update(rdap(name) or whois(name))
    if row.get("registered"):
        row["ssl_expires"] = cert_expiry(name)
    row["days"] = days_left(row.get("expires"))
    row["ssl_days"] = days_left(row.get("ssl_expires"))
    return row


def domains(force=False):
    """Every domain in config.json: registrar and expiry from RDAP (whois when the registry has none), and the
    HTTPS certificate's expiry. Cached for 12 hours; a lock keeps two refreshes from running at once."""
    listed = config().get("domains") or []
    with _domains_lock:
        env = os.path.join(HERE, ".env")
        stamp = os.path.getmtime(env) if os.path.exists(env) else 0  # a new key in .env shows at once
        if (force or time.time() - _domains["at"] > DOMAIN_SECONDS or [d["name"] for d in _domains["list"]] != listed
                or stamp != _domains.get("env")
                or (_domains.get("cf_error") and time.time() - _domains["at"] > 60)):  # a key fixed on Cloudflare's side
            _domains["env"] = stamp
            with ThreadPoolExecutor(max(len(listed), 1) + 2) as pool:
                renew = [pool.submit(vercel_renew), pool.submit(cloudflare_renew)]
                rows = list(pool.map(check_domain, listed))
                known = {**renew[1].result(), **renew[0].result()}
            for r in rows:
                r["auto_renew"] = known.get(r["name"])
                r["renew_source"] = ("Cloudflare" if (r.get("registrar") or "").startswith("Cloudflare") else
                                     "Vercel" if r["name"] in renew[0].result() else None)
            _domains["list"] = rows
            _domains["at"] = time.time()
    has = bool(os.environ.get("CLOUDFLARE_REGISTRAR_TOKEN") or env_file().get("CLOUDFLARE_REGISTRAR_TOKEN"))
    return {"at": int(_domains["at"]), "domains": _domains["list"], "env_path": os.path.join(HERE, ".env"),
            "cloudflare": {"key": "CLOUDFLARE_REGISTRAR_TOKEN", "present": has, "error": _domains.get("cf_error")}}


PROJECT_SECONDS = 300  # project details use about 7 REST calls per repo; five minutes keeps that small
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


# Tech stack: (category, chip, test). A test is a package name in package.json, a gem in a Gemfile, or a file
# name anywhere in the repo ("file:..."); a trailing * matches a package scope ("@radix-ui/*"). Order inside a category is the order the chips show.
STACK = (
    ("Language", "TypeScript", "file:tsconfig.json"), ("Language", "Ruby", "file:Gemfile"),
    ("Language", "Python", "file:pyproject.toml"), ("Language", "Python", "file:requirements.txt"),
    ("Language", "Go", "file:go.mod"),
    ("Runtime", "Bun", "file:bun.lock"), ("Runtime", "Bun", "file:bun.lockb"), ("Runtime", "pnpm", "file:pnpm-lock.yaml"),
    ("Runtime", "npm", "file:package-lock.json"),
    ("Framework", "Next.js", "next"), ("Framework", "Rails", "gem:rails"), ("Framework", "React", "react"),
    ("Framework", "Vite", "vite"), ("Framework", "Astro", "astro"), ("Framework", "SvelteKit", "@sveltejs/kit"),
    ("Framework", "Remix", "@remix-run/react"), ("Framework", "Expo", "expo"), ("Framework", "Hono", "hono"),
    ("Framework", "Hotwire", "gem:turbo-rails"), ("Framework", "Stimulus", "gem:stimulus-rails"),
    ("Database", "Supabase", "@supabase/supabase-js"), ("Database", "Supabase", "@supabase/ssr"),
    ("Database", "Postgres", "postgres"), ("Database", "Postgres", "pg"), ("Database", "Postgres", "gem:pg"),
    ("Database", "Neon", "@neondatabase/serverless"), ("Database", "SQLite", "better-sqlite3"),
    ("Database", "SQLite", "gem:sqlite3"), ("Database", "Turso", "@libsql/client"), ("Database", "MongoDB", "mongodb"),
    ("Database", "Redis", "@upstash/redis"), ("Database", "Redis", "ioredis"), ("Database", "Redis", "gem:redis"),
    ("ORM", "Drizzle", "drizzle-orm"), ("ORM", "Mongoose", "mongoose"), ("ORM", "Prisma", "@prisma/client"), ("ORM", "Kysely", "kysely"),
    ("Jobs", "Solid Queue", "gem:solid_queue"), ("Jobs", "Sidekiq", "gem:sidekiq"), ("Jobs", "Inngest", "inngest"),
    ("Auth", "Clerk", "@clerk/nextjs"), ("Auth", "Auth.js", "next-auth"), ("Auth", "Auth.js", "@auth/core"),
    ("Auth", "Better Auth", "better-auth"),
    ("UI", "Tailwind", "tailwindcss"), ("UI", "Tailwind", "gem:tailwindcss-rails"), ("UI", "shadcn/ui", "file:components.json"),
    ("UI", "Radix", "radix-ui"), ("UI", "Radix", "@radix-ui/*"), ("UI", "Recharts", "recharts"), ("UI", "Motion", "motion"), ("UI", "Motion", "framer-motion"),
    ("UI", "MapLibre", "maplibre-gl"), ("UI", "D3", "d3"), ("UI", "Importmap", "gem:importmap-rails"),
    ("Payments", "Stripe", "stripe"), ("Payments", "Stripe", "gem:stripe"), ("Payments", "Polar", "@polar-sh/sdk"),
    ("Email", "Resend", "resend"), ("Email", "React Email", "@react-email/components"),
    ("AI", "Anthropic SDK", "@anthropic-ai/sdk"), ("AI", "OpenAI SDK", "openai"), ("AI", "AI SDK", "ai"),
    ("Analytics", "Vercel Analytics", "@vercel/analytics"), ("Analytics", "PostHog", "posthog-js"),
    ("Analytics", "DataFast", "@datafast/*"), ("Monitoring", "Sentry", "@sentry/nextjs"), ("Security", "Arcjet", "@arcjet/next"),
    ("Testing", "Vitest", "vitest"), ("Testing", "Playwright", "@playwright/test"), ("Testing", "Jest", "jest"),
    ("Testing", "Capybara", "gem:capybara"),
    ("Tooling", "Biome", "@biomejs/biome"), ("Tooling", "ESLint", "eslint"), ("Tooling", "RuboCop", "gem:rubocop"),
    ("Tooling", "RuboCop", "gem:rubocop-rails-omakase"),
)


def read_file(repo, path):
    data, _ = run(["gh", "api", f"repos/{repo}/contents/{path}"], timeout=15)
    try:
        return base64.b64decode(data["content"]).decode("utf-8", "replace") if data else ""
    except (KeyError, TypeError, ValueError):
        return ""


def tech_stack(repo, paths, hosting):
    """Chips grouped by category, read from the repo's package.json and Gemfile files (root and one folder down)."""
    names = {p.rsplit("/", 1)[-1] for p in paths}
    near = lambda f: [p for p in paths if p == f or (p.count("/") == 1 and p.endswith("/" + f) and "node_modules" not in p)]
    deps, gems = set(), set()
    for path in near("package.json")[:3]:
        try:
            pkg = json.loads(read_file(repo, path) or "{}")
        except ValueError:
            continue
        for key in ("dependencies", "devDependencies"):
            deps |= set(pkg.get(key) or {})
    for path in near("Gemfile")[:2]:
        gems |= set(re.findall(r"^\s*gem\s+['\"]([\w-]+)['\"]", read_file(repo, path), re.M))
    if any(p.endswith(".py") for p in paths):
        names.add("pyproject.toml")
    found = {}
    for category, chip, test in STACK:
        kind, _, name = test.rpartition(":")
        if name.endswith("*"):
            hit = any(d.startswith(name[:-1]) for d in deps)
        else:
            hit = name in names if kind == "file" else name in gems if kind == "gem" else name in deps
        if hit and chip not in found.setdefault(category, []):
            found[category].append(chip)
    if hosting:
        found["Hosting"] = [hosting]
    return [{"category": c, "items": items} for c, items in found.items() if items]


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
        "stack": tech_stack(repo, paths, hosting),
    }


# DataFast: revenue and visitors for each project's live site, over the last 30 days.
# The token is the DataFast CLI's (`datafast login` writes ~/.config/datafast/config.json), or DATAFAST_TOKEN.
DATAFAST_CONFIG = os.path.expanduser("~/.config/datafast/config.json")
DATAFAST_SECONDS = 600
_datafast = {"at": 0, "sites": {}, "error": None}
_datafast_lock = threading.Lock()


def datafast_token():
    try:
        return os.environ.get("DATAFAST_TOKEN") or json.load(open(DATAFAST_CONFIG)).get("token")
    except (OSError, ValueError):
        return None


def datafast_get(path, token):
    req = urllib.request.Request(f"https://datafa.st/api/v1/{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("data")


def datafast():
    """{hostname: {visitors, revenue, payments}} for every DataFast website, cached ten minutes."""
    with _datafast_lock:  # two page requests at once share one fetch, and neither sees a half-filled cache
        if time.time() - _datafast["at"] >= DATAFAST_SECONDS:
            _datafast.update(datafast_fetch(), at=time.time())
    return _datafast


def datafast_fetch():
    token = datafast_token()
    if not token:
        return {"sites": {}, "error": "no token"}
    end = time.strftime("%Y-%m-%d")
    start = time.strftime("%Y-%m-%d", time.localtime(time.time() - 29 * 86400))

    def one(site):
        q = f"analytics/overview?websiteId={site['_id']}&startAt={start}&endAt={end}&fields=visitors,revenue,payments"
        row = (datafast_get(q, token) or [{}])[0]
        # All time: from the day the site was added to DataFast.
        q = f"analytics/overview?websiteId={site['_id']}&startAt={site['createdAt'][:10]}&endAt={end}&fields=revenue,payments"
        total = (datafast_get(q, token) or [{}])[0]
        return site["domain"], {"visitors": row.get("visitors"), "revenue": row.get("revenue"), "payments": row.get("payments"),
                                "revenue_total": total.get("revenue"), "payments_total": total.get("payments"),
                                "since": site["createdAt"][:10]}
    try:
        sites = datafast_get("admin/websites", token) or []
        with ThreadPoolExecutor(max(len(sites), 1)) as pool:
            return {"sites": dict(pool.map(one, sites)), "error": None}
    except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
        return {"sites": {}, "error": str(getattr(e, "code", "") or e)}


# MRR: active subscriptions read from each project's payment provider (config.json "billing").
# Keys live in .env next to this file (gitignored), never in config.json: {"owner/repo": {"provider": "stripe", "key": "ENV_NAME"}}.
BILLING_SECONDS = 600
_billing = {"at": 0, "mrr": {}}
_billing_lock = threading.Lock()


def env_file():
    try:
        lines = open(os.path.join(HERE, ".env")).read().splitlines()
    except OSError:
        return {}
    pairs = (x.split("=", 1) for x in lines if "=" in x and not x.lstrip().startswith("#"))
    return {k.strip(): v.strip().strip('"').strip("'") for k, v in pairs}


def per_month(cents, interval, count=1):
    """One subscription's price as a monthly amount in dollars."""
    months = {"day": 12 / 365, "week": 12 / 52, "month": 1, "year": 12}.get(interval)
    return cents / 100 / (months * (count or 1)) if months else 0


def stripe_list(key, path):
    """Every row of one Stripe list endpoint, page by page."""
    rows, after = [], None
    while True:
        url = f"https://api.stripe.com/v1/{path}{'&' if '?' in path else '?'}limit=100" + (f"&starting_after={after}" if after else "")
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {key}"}), timeout=15) as r:
            page = json.load(r)
        rows += page["data"]
        if not page.get("has_more"):
            return rows
        after = page["data"][-1]["id"]


def stripe(key):
    """MRR from active subscriptions; revenue from every paid charge, less refunds."""
    subs = stripe_list(key, "subscriptions?status=active")
    mrr = sum(per_month((i["price"].get("unit_amount") or 0) * (i.get("quantity") or 1),
                        (i["price"].get("recurring") or {}).get("interval"), (i["price"].get("recurring") or {}).get("interval_count"))
              for s in subs for i in s["items"]["data"])
    paid = [c for c in stripe_list(key, "charges") if c.get("paid") and c.get("status") == "succeeded"]
    # Clerk Billing charges plain payments, with no Stripe subscription behind them. A charge named "Pro (annual)"
    # or "(monthly)" still pays for a term, so it counts toward MRR until its term ends.
    terms = {"annual": 365, "yearly": 365, "monthly": 31}
    for c in paid:
        term = next((days for word, days in terms.items() if f"({word})" in (c.get("description") or "").lower()), None)
        if term and time.time() - c["created"] < term * 86400 and not c.get("refunded"):
            mrr += (c["amount"] - (c.get("amount_refunded") or 0)) / 100 / (12 if term > 31 else 1)
            subs.append(c)
    return {"mrr": mrr, "subscribers": len(subs),
            "revenue": sum(c["amount"] - (c.get("amount_refunded") or 0) for c in paid) / 100, "payments": len(paid)}


def polar_list(key, path):
    # Polar's edge refuses Python's default User-Agent, so the request names itself.
    rows, page = [], 1
    while True:
        url = f"https://api.polar.sh/v1/{path}{'&' if '?' in path else '?'}limit=100&page={page}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json", "User-Agent": "collector"})
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.load(r)
        rows += body["items"]
        if page >= (body.get("pagination") or {}).get("max_page", 1):
            return rows
        page += 1


def polar(key):
    """MRR from active subscriptions; revenue from every paid order, less refunds."""
    subs = polar_list(key, "subscriptions/?active=true")
    orders = [o for o in polar_list(key, "orders/") if o.get("paid")]
    return {"mrr": sum(per_month(s.get("amount") or 0, s.get("recurring_interval"), s.get("recurring_interval_count")) for s in subs),
            "subscribers": len(subs),
            "revenue": sum((o.get("total_amount") or 0) - (o.get("refunded_amount") or 0) for o in orders) / 100, "payments": len(orders)}


def billing():
    """{repo: {mrr, subscribers, revenue, payments, providers} or {error}}, cached ten minutes."""
    with _billing_lock:
        # A new key in .env shows at once; otherwise the providers are asked every ten minutes.
        stamp = os.path.getmtime(os.path.join(HERE, ".env")) if os.path.exists(os.path.join(HERE, ".env")) else 0
        if time.time() - _billing["at"] >= BILLING_SECONDS or _billing.get("stamp") != stamp:
            _billing.update(mrr=billing_fetch(), at=time.time(), stamp=stamp)
    return _billing["mrr"]


def billing_fetch():
    """A project can bill through more than one provider (ZeroPhase: Stripe through Clerk, then Polar); the totals add up."""
    keys, out = env_file(), {}
    for repo, accounts in (config().get("billing") or {}).items():
        accounts = accounts if isinstance(accounts, list) else [accounts]
        total = {"mrr": 0.0, "subscribers": 0, "revenue": 0.0, "payments": 0, "providers": [], "missing": [], "rejected": []}
        for b in accounts:
            key = os.environ.get(b.get("key", "")) or keys.get(b.get("key", ""))
            if not key:
                total["missing"].append(b.get("key"))
                continue
            try:
                one = {"stripe": stripe, "polar": polar}[b["provider"]](key)
            except (KeyError, urllib.error.URLError, OSError, ValueError) as e:
                code = getattr(e, "code", "")
                reason = "the key is wrong or deleted" if code == 401 else "the key lacks a permission" if code == 403 else str(code or e)
                total["rejected"].append(f"{b['provider'].title()} refused {b.get('key')}: {reason}")
                continue
            for k in ("mrr", "subscribers", "revenue", "payments"):
                total[k] += one[k]
            total["providers"].append(b["provider"].title())
        if not total["providers"]:
            out[repo] = {"error": "; ".join(total["rejected"] + ([f"add {', '.join(total['missing'])} to .env"] if total["missing"] else []))}
        else:
            total.update(mrr=round(total["mrr"], 2), revenue=round(total["revenue"], 2))
            out[repo] = total
    return out


def flat(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


VENDOR_SECONDS = 300
_vendors = {"at": 0, "list": []}
_vendors_lock = threading.Lock()


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "collector"})
    return json.load(urllib.request.urlopen(req, timeout=10))


DATADOG_IMPACT = {"degraded_performance": "minor", "partial_outage": "major", "major_outage": "critical"}


def read_feed(d, url):
    """Open incidents from one status feed, by its shape, or None for a shape this does not know.
    Statuspage (most vendors), Datadog status pages (OpenRouter), Better Stack (Polar), Stripe's /current, X's
    developer status API, Google Cloud's incidents.json."""
    if "page" in d:
        found = [{"name": i["name"], "impact": i.get("impact") or "none", "url": i.get("shortlink") or url}
                 for i in d.get("incidents") or [] if i.get("status") != "resolved"]
        indicator = (d.get("status") or {}).get("indicator") or "none"
        if not found and indicator in IMPACT and indicator != "none":  # a page that lists no incidents, only its status
            found = [{"name": d["status"].get("description") or "Degraded", "impact": indicator, "url": url}]
        return found
    if "pageType" in d and "components" in d:
        return [{"name": i.get("title") or "Incident", "url": url,
                 "impact": max((DATADOG_IMPACT.get(c.get("status"), "minor") for c in i.get("componentsAffected") or []),
                               key=lambda x: IMPACT[x], default="minor")}
                for i in d.get("incidents") or [] if not i.get("resolved")]
    if isinstance(d, list):  # Google Cloud's incidents.json: every recent incident; open ones have no end
        return [{"name": i.get("external_desc") or "Incident", "url": f"{url}/{i['uri']}" if i.get("uri") else url,
                 "impact": {"high": "major"}.get(i.get("severity"), "minor")}
                for i in d if isinstance(i, dict) and "begin" in i and not i.get("end")]
    if (d.get("data") or {}).get("type") == "status_page":  # Better Stack
        if d["data"]["attributes"].get("aggregate_state") in ("operational", "maintenance"):
            return []
        down = [r["attributes"] for r in d.get("included") or [] if r.get("type") == "status_page_resource"
                and r["attributes"].get("status") not in ("operational", "maintenance", None)]
        return [{"name": f"{r.get('public_name')}: {r['status']}", "url": url,
                 "impact": "major" if r["status"] == "downtime" else "minor"} for r in down] or [
            {"name": d["data"]["attributes"]["aggregate_state"], "url": url, "impact": "minor"}]
    if "largestatus" in d:
        return [] if d["largestatus"] == "up" else [
            {"name": d.get("message") or "Stripe is not fully up", "url": url,
             "impact": "minor" if d["largestatus"] == "degraded" else "major"}]
    if "overall" in d:
        return [] if d["overall"] == "operational" else [
            {"name": f"X API: {d['overall']}", "url": url, "impact": "minor" if d["overall"] == "degraded" else "major"}]
    return None


def vendor(v):
    """One vendor's status page. The feed is "feed" in config.json when set, else the first of the page's
    /api/v2/summary.json (Statuspage), /config.json (Datadog), /index.json (Better Stack), /current (Stripe) that
    reads. No feed: a link only."""
    url = v["url"].rstrip("/")
    row = {"name": v["name"], "url": url, "state": "no feed", "incidents": []}
    if v.get("probe"):  # no status page: one GET of an API that answers without a key (Nous: /v1/models)
        c = check({"url": v["probe"]})
        row["state"] = {"online": "ok", "slow": "minor"}.get(c["status"], "major")
        if c["status"] != "online":
            row["incidents"] = [{"name": f"API {'slow' if c['status'] == 'slow' else 'not answering'}: "
                                         f"{c['error'] or str(c['ms']) + ' ms'}", "impact": row["state"], "url": v["probe"]}]
        return row
    for feed in [v["feed"]] if v.get("feed") else [url + "/api/v2/summary.json", url + "/config.json", url + "/index.json",
                                                    url + "/current"]:
        try:
            found = read_feed(get_json(feed), url)
        except Exception:
            continue
        if found is not None:
            row["incidents"] = found
            row["state"] = ["ok", "minor", "major", "critical"][max([IMPACT[i["impact"]] for i in found] + [0])]
            break
    return row


IMPACT = {"none": 0, "minor": 1, "major": 2, "critical": 3}


def vendors():
    """Every vendor in config.json "vendors", checked every five minutes."""
    listed = config().get("vendors") or []
    with _vendors_lock:
        if time.time() - _vendors["at"] > VENDOR_SECONDS or len(_vendors["list"]) != len(listed):
            with ThreadPoolExecutor(max(len(listed), 1)) as pool:
                _vendors["list"] = list(pool.map(vendor, listed))
            _vendors["at"] = time.time()
        return {"at": _vendors["at"], "vendors": _vendors["list"]}


AI_SECONDS = 300
AI_LOW_USD, AI_LOW_PERCENT = 5, 10  # under these, a provider goes to Needs attention
_ai = {"at": 0, "list": []}
_ai_lock = threading.Lock()
HERMES_HOME = os.path.expanduser("~/.hermes")
# Nous credits through Hermes's own portal client: the portal login lives in Hermes's auth.json.
NOUS_SCRIPT = """
import json, os, sys
sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
os.chdir(sys.path[0])
from hermes_cli.nous_account import get_nous_portal_account_info
info = get_nous_portal_account_info(force_fresh=True)
access, sub = getattr(info, "paid_service_access_info", None), getattr(info, "subscription", None)
print(json.dumps({"logged_in": bool(getattr(info, "logged_in", False)), "plan": getattr(sub, "plan", None),
                  "usable": getattr(access, "total_usable_credits", None), "monthly": getattr(sub, "monthly_credits", None),
                  "renews": getattr(sub, "current_period_end", None)}))
"""
AI_LINKS = {"anthropic": "https://claude.ai/settings/usage", "nous": "https://portal.nousresearch.com",
            "minimax": "https://platform.minimax.io/user-center/payment/coding-plan", "xai-oauth": "https://grok.com"}


def hermes_env():
    try:
        lines = open(os.path.join(HERMES_HOME, ".env")).read().splitlines()
    except OSError:
        return {}
    pairs = (x.split("=", 1) for x in lines if "=" in x and not x.lstrip().startswith("#"))
    return {k.strip(): v.strip().strip('"').strip("'") for k, v in pairs}


def ai_nous():
    py = os.path.join(HERMES_HOME, "hermes-agent", "venv", "bin", "python")
    data, err = run([py, "-c", NOUS_SCRIPT], timeout=30)
    if not data or not data.get("logged_in"):
        return {"note": f"Could not read the Nous portal: {err or 'not logged in'}"}
    left = data.get("usable")
    renews = ""
    try:
        end = dt.datetime.fromisoformat((data.get("renews") or "").replace("Z", "+00:00")).astimezone()
        days = (end.date() - dt.date.today()).days
        renews = f"in {days} {'day' if days == 1 else 'days'} ({end:%b} {end.day})" if days > 0 else f"today ({end:%b} {end.day})"
    except ValueError:
        pass
    return {"plan": data.get("plan"), "left": f"${left:.2f}" if isinstance(left, (int, float)) else None,
            "detail": f"usable on the ${data['monthly']:.0f}/month plan with top-ups" + (f", renews {renews}" if renews else "")
            if isinstance(data.get("monthly"), (int, float)) else None,
            "low": isinstance(left, (int, float)) and left < AI_LOW_USD}


def ai_minimax():
    key = hermes_env().get("MINIMAX_API_KEY")
    if not key:
        return {"note": "No MINIMAX_API_KEY in ~/.hermes/.env"}
    req = urllib.request.Request("https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
                                 headers={"Authorization": f"Bearer {key}", "User-Agent": "collector"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=10))
    except Exception as e:
        return {"note": f"Could not read the MiniMax plan: {str(getattr(e, 'reason', e))[:80]}"}
    m = next((x for x in d.get("model_remains") or [] if x.get("model_name") == "general"), None)
    if not m:
        return {"note": "MiniMax returned no plan"}
    now, week = m.get("current_interval_remaining_percent"), m.get("current_weekly_remaining_percent")
    ms = lambda v: dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc).isoformat() if v else None
    windows = [{"label": "5-hour window", "used": 100 - (now if now is not None else 100), "resets": ms(m.get("end_time"))},
               {"label": "Week", "used": 100 - (week if week is not None else 100), "resets": ms(m.get("weekly_end_time"))}]
    return {"plan": "Coding plan", "left": f"{now}%", "windows": windows,
            "detail": f"of this 5-hour window, {week}% of the week",
            "low": min(now if now is not None else 100, week if week is not None else 100) < AI_LOW_PERCENT}


def ai_anthropic():
    """The Claude subscription's session and week limits. The lanes' `claude setup-token` token cannot read usage
    (no user:profile scope), so this reads Claude Code's own login from the macOS keychain: the same Max account.
    It never refreshes that login (Claude Code owns it); an expired one shows a note until Claude Code runs again."""
    try:
        raw = subprocess.run(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        login = json.loads(raw).get("claudeAiOauth") or {}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {"plan": "Claude subscription", "note": "No Claude Code login on this Mac"}
    if login.get("expiresAt", 0) / 1000 < time.time():
        return {"plan": "Claude subscription", "note": "Claude Code login expired: open Claude Code to renew it"}
    req = urllib.request.Request("https://api.anthropic.com/api/oauth/usage", headers={
        "Authorization": f"Bearer {login.get('accessToken')}", "anthropic-beta": "oauth-2025-04-20", "User-Agent": "collector"})
    try:
        d = json.load(urllib.request.urlopen(req, timeout=10))
    except Exception as e:
        return {"plan": "Claude subscription", "note": f"Could not read Claude usage: {str(getattr(e, 'reason', e))[:80]}"}
    session, week = d.get("five_hour") or {}, d.get("seven_day") or {}

    def when(iso, fmt):
        try:
            return dt.datetime.fromisoformat(iso).astimezone().strftime(fmt).replace(" 0", " ").lstrip("0")
        except (TypeError, ValueError):
            return "?"
    s_left, w_left = 100 - round(session.get("utilization") or 0), 100 - round(week.get("utilization") or 0)
    plan = {"max": "Claude Max", "pro": "Claude Pro"}.get(login.get("subscriptionType"), "Claude subscription")
    tier = re.search(r"(\d+x)$", login.get("rateLimitTier") or "")  # default_claude_max_5x
    plan += f" ({tier[1]})" if tier else ""
    windows = [{"label": "5-hour session", "used": round(session.get("utilization") or 0), "resets": session.get("resets_at")},
               {"label": "Week", "used": round(week.get("utilization") or 0), "resets": week.get("resets_at")}]
    return {"plan": plan, "left": f"{s_left}%", "windows": windows,
            "detail": f"of this 5-hour session (resets {when(session.get('resets_at'), '%I:%M %p')}), "
                      f"{w_left}% of the week (resets {when(week.get('resets_at'), '%a %I %p')})",
            "low": min(s_left, w_left) < AI_LOW_PERCENT}


def ai_grok():
    """xAI has no usage API for a Grok subscription login, so this checks the login itself: a free models list."""
    try:
        token = json.load(open(os.path.join(HERMES_HOME, "auth.json")))["providers"]["xai-oauth"]["tokens"]["access_token"]
    except (OSError, ValueError, KeyError, TypeError):
        return {"plan": "Grok subscription", "note": "No Grok login in Hermes", "low": True,
                "alert": "Grok: no login in Hermes, so xresearch cannot search X"}
    c = check({"url": "https://api.x.ai/v1/models"} | {"headers": {"Authorization": f"Bearer {token}"}})
    if c["status"] == "down":
        return {"plan": "Grok subscription", "note": f"Login failed ({c['error']}): log in again for xresearch", "low": True,
                "alert": "Grok login failed, so xresearch cannot search X: log in again"}
    return {"plan": "Grok subscription", "note": "Login OK (xAI has no usage API for subscriptions)"}


AI_KIND = {"nous": "usage"}
AI_READERS = {"nous": ai_nous, "minimax": ai_minimax, "anthropic": ai_anthropic, "xai": ai_grok}


def refresh_ai():
    users = {}
    for m in json.loads(state()).get("machines") or []:
        for prof in m.get("profiles") or []:
            if prof.get("provider"):
                # One account, one row: the Claude SDK login is the same Claude subscription as "anthropic".
                slug = "anthropic" if prof["provider"].startswith("claude") else prof["provider"]
                users.setdefault(slug, []).append(f"{m['name']}:{prof['name']}")

    def one(item):
        slug, profiles = item
        reader = AI_READERS.get(slug) or AI_READERS.get(slug.split("-")[0])
        row = reader() if reader else {"note": "Subscription login, no usage API"}
        link = AI_LINKS.get(slug) or AI_LINKS.get(slug.split("-")[0])
        # A plan is a subscription with usage windows; usage is pay-as-you-go credits.
        return dict(row, provider=slug, profiles=len(profiles), link=link, kind=AI_KIND.get(slug, "plan"))

    try:
        with ThreadPoolExecutor(4) as pool:
            rows = list(pool.map(one, sorted(users.items(), key=lambda x: -len(x[1]))))
        _ai.update(at=time.time(), list=rows)
    finally:
        _ai["busy"] = False
    with _lock:
        _cache["at"] = 0  # the next /api/state carries a low balance into Needs attention


def ai_providers():
    """One row per AI provider the Hermes profiles use (from each profile's config.yaml): the plan and what is
    left, read from the provider's own API, else a note and a link. A read takes seconds (the Nous portal), so
    a stale list is served while a new one is read in the background; only the very first read waits."""
    with _ai_lock:
        stale = time.time() - _ai["at"] > AI_SECONDS
        if stale and not _ai["list"]:
            refresh_ai()
        elif stale and not _ai.get("busy"):
            _ai["busy"] = True
            threading.Thread(target=refresh_ai, daemon=True).start()
        return {"at": _ai["at"], "providers": _ai["list"]}


TICKET_SECONDS = 120
TICKET_TYPES = ("bug", "enhancement", "tech-debt")
_tickets = {"at": 0, "list": [], "error": None}
_tickets_lock = threading.Lock()


REASON_HINT = re.compile(r"needs?[- ]info|need your|did not pass|cannot|can't|blocked|split this|unverified|over \d+ hours", re.I)
REASON_STRONG = re.compile(r"need your|needs James|James to|awaiting|your input|answer|cannot|can't|uncommitted|split this|over \d+ hours|blocked by", re.I)
REASON_QUERY = """query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){
  comments(last:20){ nodes{ createdAt url body } }
  timelineItems(last:20,itemTypes:[LABELED_EVENT]){ nodes{ ... on LabeledEvent{ createdAt label{name} } } } }}}"""
_reasons = {}  # (url, lane) -> (time, reason)


def sentences(body):
    """The prose of a comment, one sentence at a time: no headings, quotes, tables, code, or Markdown marks."""
    keep = []
    for line in body.replace("\r", "").split("\n"):
        t = line.strip()
        if not t or t.startswith(("#", ">", "|", "```", "- [")):
            continue
        keep.append(re.sub(r"[*_`]", "", re.sub(r"^\s*[-*]\s+", "", t)))
    text = re.sub(r"^(Mac lane|VPS lane|Foreman|foreman)( on \w+)?:\s*", "", " ".join(keep))
    said = [x.strip() for x in re.split(r"(?<=[.!?])\s+", text) if x.strip()]
    return [x for x in said if "$" not in x and x.count("/") < 3 and len(x) < 400]  # skip log paths and run records


def reason(t):
    """Why a ticket sits in its lane: the comment that moved it there (the one just before the lane label, or the
    newest comment that reads like a reason), cut to one sentence. Cached for ten minutes per ticket."""
    key = (t["url"], t["lane"])
    hit = _reasons.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    m = re.match(r"https://github.com/([^/]+)/([^/]+)/issues/(\d+)", t["url"] or "")
    found = None
    if m:
        data, _ = run(["gh", "api", "graphql", "-f", f"query={REASON_QUERY}", "-F", f"o={m[1]}", "-F", f"r={m[2]}",
                       "-F", f"n={m[3]}"], timeout=20)
        issue = ((data or {}).get("data") or {}).get("repository", {}).get("issue") or {}
        comments = (issue.get("comments") or {}).get("nodes") or []
        moved = [e["createdAt"] for e in (issue.get("timelineItems") or {}).get("nodes") or []
                 if (e.get("label") or {}).get("name") == t["lane"]]
        pick = None
        if moved:  # label repos: the newest comment up to the moment the label went on
            before = [c for c in comments if c["createdAt"] <= moved[-1]]
            pick = before[-1] if before else None
        if not pick:
            pick = next((c for c in reversed(comments) if REASON_HINT.search(c["body"])), comments[-1] if comments else None)
        if pick:
            said = sentences(pick["body"])
            line = next((x for x in said if REASON_STRONG.search(x)),
                        next((x for x in said if REASON_HINT.search(x)), said[0] if said else ""))
            line = line[:1].upper() + line[1:]
            found = {"text": line[:220] + ("…" if len(line) > 220 else ""), "url": pick["url"], "at": pick["createdAt"]}
    _reasons[key] = (time.time(), found)
    return found


CARD_SECTION = re.compile(r"^#+\s*(what|problem|bug|goal|why|summary)\b", re.I)
_cards = {}  # (repo, number) -> (time, card)


def card(repo, number):
    """What a running card is for: its Agent Brief Summary, else the first sentences of its What / Problem section (else
    of the body), for the Card column's tooltip. The repo's owner comes from the chosen projects. Cached ten minutes."""
    hit = _cards.get((repo, number))
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    chosen = config().get("projects") or []
    full = [p for p in chosen if p.split("/")[-1] == repo] or [f"{o}/{repo}" for o in dict.fromkeys(p.split("/")[0] for p in chosen)]
    found = None
    for name in full:  # a repo that is not a chosen project: try each owner the projects use
        data, _ = run(["gh", "issue", "view", str(number), "-R", name, "--json", "title,body,url"], timeout=20)
        if data:
            lines = (data.get("body") or "").replace("\r", "").split("\n")
            start = next((i + 1 for i, line in enumerate(lines) if CARD_SECTION.match(line.strip())), 0)
            end = next((i for i in range(start, len(lines)) if lines[i].lstrip().startswith("#")), len(lines))
            brief = next((re.sub(r"^\W*summary:\W*", "", line.strip(), flags=re.I) for line in lines
                          if re.match(r"^\W*summary:", line.strip(), re.I)), None)  # an Agent Brief's Summary line
            said = sentences(brief or "\n".join(lines[start:end])) or sentences("\n".join(lines))
            text = ""
            for x in said:
                if len(text) + len(x) > 320 and text:
                    break
                text = f"{text} {x}".strip()
            found = {"title": data.get("title"), "text": text, "url": data.get("url")}
            break
    if found:  # a failed read is tried again on the next hover
        _cards[(repo, number)] = (time.time(), found)
    return found


def tickets():
    """Tickets that wait on a person (config "tickets": "each" lanes list every ticket in Needs attention, "count"
    lanes show one line with a count, and "command" prints one lane's tickets as JSON, with {lane} in place of the
    lane name). Cached for two minutes; the page asks for a refresh once a minute."""
    cfg = config().get("tickets") or {}
    lanes, cmd = (cfg.get("each") or []) + (cfg.get("count") or []), cfg.get("command") or []
    with _tickets_lock:
        if lanes and cmd and (time.time() - _tickets["at"] > TICKET_SECONDS or _tickets.get("lanes") != lanes):
            rows, errors = [], []
            for slug in lanes:
                data, err = run([os.path.expanduser(c.replace("{lane}", slug)) for c in cmd], timeout=60)
                if err:
                    errors.append(f"{slug}: {err}")
                for t in data or []:
                    rows.append({"repo": t.get("repo"), "number": t.get("number"), "title": t.get("title"),
                                 "url": t.get("url"), "lane": slug, "priority": t.get("priority"),
                                 "created": t.get("createdAt"),
                                 "type": next((l for l in t.get("labels") or [] if l in TICKET_TYPES), None)})
            each = cfg.get("each") or []
            with ThreadPoolExecutor(4) as pool:
                for t, why in zip([t for t in rows if t["lane"] in each],
                                  pool.map(reason, [t for t in rows if t["lane"] in each])):
                    t["reason"] = why
            _tickets.update(at=time.time(), list=rows, error="; ".join(errors) or None, lanes=lanes)  # a lane edit reads again
            with _lock:
                _cache["at"] = 0  # the next /api/state carries the tickets into Needs attention
        return {"each": cfg.get("each") or [], "count": cfg.get("count") or [], "tickets": _tickets["list"],
                "error": _tickets["error"]}


WORK_SECONDS = 120
_work = {"at": 0, "list": [], "error": None, "busy": False}
_work_lock = threading.Lock()


def refresh_work():
    """Read every lane in config "tickets" "all" with the tickets command, all lanes at once."""
    cfg = config().get("tickets") or {}
    lanes, cmd = cfg.get("all") or [], cfg.get("command") or []
    rows, errors = [], []

    def read(slug):
        return slug, *run([os.path.expanduser(c.replace("{lane}", slug)) for c in cmd], timeout=60)

    with ThreadPoolExecutor(max(len(lanes), 1)) as pool:
        for slug, data, err in pool.map(read, lanes):
            if err:
                errors.append(f"{slug}: {err}")
            for t in data or []:
                rows.append({"repo": t.get("repo"), "number": t.get("number"), "title": t.get("title"),
                             "url": t.get("url"), "lane": slug, "priority": t.get("priority"),
                             "created": t.get("createdAt"),
                             "labels": [l for l in t.get("labels") or [] if l not in lanes and l != t.get("priority")]})
    _work.update(at=time.time(), list=rows, error="; ".join(errors) or None, busy=False)


def work():
    """Every open card on the board, one row per card, in board lane order (config "tickets" "all"). A read takes
    a few seconds per lane, so a stale list is served while a new one is read in the background."""
    with _work_lock:
        stale = time.time() - _work["at"] > WORK_SECONDS
        if stale and not _work["list"]:
            refresh_work()
        elif stale and not _work["busy"]:
            _work["busy"] = True
            threading.Thread(target=refresh_work, daemon=True).start()
        return {"at": _work["at"], "lanes": (config().get("tickets") or {}).get("all") or [],
                "cards": _work["list"], "error": _work["error"]}


STATS_SECONDS = 300
_stats = {"at": 0, "data": None, "busy": False}
_stats_lock = threading.Lock()


def deploys_today(repo, since):
    """Production deploys of one repo since `since` (local midnight): GitHub deployments to a production
    environment (Vercel makes these), else successful CI jobs named "deploy" on pushes (Kamal from Actions)."""
    deps, _ = run(["gh", "api", f"repos/{repo}/deployments?per_page=50"], timeout=15)
    if deps:
        return sum(1 for d in deps if (d.get("environment") or "").lower() == "production" and d["created_at"] >= since)
    runs, _ = run(["gh", "api", f"repos/{repo}/actions/runs?event=push&created=>={since[:10]}&per_page=50"], timeout=15)
    n = 0
    for r in (runs or {}).get("workflow_runs") or []:
        if r["created_at"] < since or r.get("head_branch") not in ("main", "master"):
            continue
        jobs, _ = run(["gh", "api", f"repos/{repo}/actions/runs/{r['id']}/jobs"], timeout=15)
        n += sum(1 for j in (jobs or {}).get("jobs") or [] if "deploy" in j["name"].lower() and j.get("conclusion") == "success")
    return n


def refresh_stats():
    """Work stats for the dashboard: open cards, cards closed as done (today, 30 days), deploys today per repo, and
    the signed-in GitHub user's contribution calendar (the heat map on their profile).
    The repos are the chosen projects plus every repo with a card on the board."""
    local = dt.datetime.now().astimezone()
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    since = midnight.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cards = work()["cards"]
    repos = set(config().get("projects") or [])
    repos |= {m[1] for t in cards if (m := re.match(r"https://github.com/([^/]+/[^/]+)/", t.get("url") or ""))}
    owners = sorted({r.split("/")[0] for r in repos})

    def closed(day):
        q = f"is:issue is:closed reason:completed closed:>={day} " + " ".join(f"user:{o}" for o in owners)
        data, _ = run(["gh", "api", "-X", "GET", "search/issues", "-f", f"q={q}", "-f", "per_page=1"], timeout=20)
        return (data or {}).get("total_count")

    with ThreadPoolExecutor(8) as pool:
        today = pool.submit(closed, midnight.isoformat(timespec="seconds"))
        month = pool.submit(closed, (midnight - dt.timedelta(days=30)).strftime("%Y-%m-%d"))
        names = sorted(repos)
        deploys = dict(zip(names, pool.map(lambda r: deploys_today(r, since), names)))
    cal, _ = run(["gh", "api", "graphql", "-f", "query={viewer{contributionsCollection{contributionCalendar{"
                  "totalContributions weeks{contributionDays{date contributionCount contributionLevel}}}}}}"], timeout=20)
    cal = (((cal or {}).get("data") or {}).get("viewer") or {}).get("contributionsCollection", {}).get("contributionCalendar")
    _stats.update(at=time.time(), busy=False, data={
        "open": len(cards), "closed_today": today.result(), "closed_30d": month.result(),
        "contributions": cal and {"total": cal["totalContributions"], "weeks": [
            [[d["date"], d["contributionCount"], d["contributionLevel"]] for d in w["contributionDays"]] for w in cal["weeks"]]},
        "deploys": [{"repo": r.split("/")[-1], "n": n} for r, n in sorted(deploys.items(), key=lambda x: -x[1]) if n]})


def work_stats():
    with _stats_lock:
        stale = time.time() - _stats["at"] > STATS_SECONDS
        if stale and not _stats["data"]:
            refresh_stats()
        elif stale and not _stats["busy"]:
            _stats["busy"] = True
            threading.Thread(target=refresh_stats, daemon=True).start()
        return {"at": _stats["at"], **(_stats["data"] or {})}


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
    df = datafast()
    mrr = billing()
    subs = cfg.get("subscriptions") or []
    for p in _projects["list"]:
        if "name" in p:
            site = sites.get(flat(p["name"])) or {}
            p["live"] = site.get("url") or p["homepage"]
            p["title"] = site.get("name") or p["name"].replace("-", " ").title()
            host = re.sub(r"^https?://|/.*$", "", p["live"] or "")
            p["traffic"] = df["sites"].get(host) or {"error": df["error"] or "not on DataFast"}
            # A subscription belongs to a project when its "project" names the repo (zero-phase).
            p["subscriptions"] = [x for x in subs if x.get("project") in (p["name"], p["repo"])]
            p["billing"] = mrr.get(p["repo"])
    # The keys the payment providers need, and whether .env has each one. Never the key itself.
    keys = env_file()
    titles = {p["repo"]: p.get("title") or p["repo"] for p in _projects["list"]}
    needed = [{"repo": repo, "project": titles.get(repo, repo), "provider": b["provider"], "key": b["key"], "note": b.get("note", ""),
               "present": bool(os.environ.get(b["key"]) or keys.get(b["key"])),
               "refused": b["key"] in json.dumps(mrr.get(repo) or {}) and "refused" in json.dumps(mrr.get(repo) or {})}
              for repo, accounts in (cfg.get("billing") or {}).items()
              for b in (accounts if isinstance(accounts, list) else [accounts])]
    return {"at": int(_projects["at"]), "projects": _projects["list"], "keys": needed, "env_path": os.path.join(HERE, ".env")}


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
            if key:  # one script per machine: the foreman runs on every machine on purpose
                by_script.setdefault((key, m["name"]), []).append(j["name"])
        ticks = m.get("work_ticks_10m")
        limit_10m = work.get("max_starts_10m", 15)
        if ticks and ticks > limit_10m:
            out.append({"level": "error", "text": f"{work_label} on {m['name']} started {ticks} times in the last 10 minutes "
                        f"(more than {limit_10m}): it is starting itself in a loop"})
    for (script, machine), where in by_script.items():
        if len(where) > 1:
            out.append({"level": "warn", "text": f"The same script ({script}) starts from {len(where)} jobs on {machine}: " + ", ".join(where)})
    for d in _domains["list"]:
        if d.get("registered") and d.get("days") is not None and d["days"] <= 30:
            out.append({"level": "error" if d["days"] <= 7 else "warn",
                        "text": f"{d['name']} expires in {d['days']} days ({d['expires']}) at {d.get('registrar') or 'its registrar'}"})
        if d.get("auto_renew") is False and d.get("days") is not None and d["days"] <= 60:
            out.append({"level": "warn", "text": f"{d['name']} expires in {d['days']} days and auto-renew is off"})
        if d.get("ssl_days") is not None and d["ssl_days"] <= 14:
            out.append({"level": "error", "text": f"The HTTPS certificate of {d['name']} runs out in {d['ssl_days']} days"})
    g = limit.get("graphql")
    if g and g["limit"] - g["used"] < 500:
        out.append({"level": "error", "text": f"GitHub GraphQL limit nearly gone: {g['limit'] - g['used']} of {g['limit']} left"})
    for x in checked:
        if x["status"] == "down":
            out.append({"level": "error", "text": f"{x['name']} is down: {x['error']} ({x['url']})"})
    for m in machines:
        if m.get("error"):
            out.append({"level": "error", "text": f"Could not read {m['name']}: {m['error']}"})
    tix = cfg.get("tickets") or {}
    if _tickets["error"]:
        out.append({"level": "warn", "text": f"Could not list tickets: {_tickets['error']}"})
    xc = ((_x_usage.get("data") or {}).get("credits") or {}).get("total")
    if isinstance(xc, (int, float)) and xc < AI_LOW_USD:
        out.append({"level": "error", "text": f"X API: ${xc:.2f} of credits left (top up before Situation's X wire stops)",
                    "url": "https://console.x.com"})
    for a in _ai["list"]:  # a low balance is something to act on: top it up before the lanes stop on a 402
        if a.get("low"):
            out.append({"level": "error", "url": a.get("link"), "text": a.get("alert") or
                        f"{a['provider']}: {a.get('left')} left {a.get('detail') or ''}".strip() + " (top up before the lanes stop)"})
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
    return {"at": int(time.time()), "machines": machines, "github": limit, "x": x_usage(), "subscriptions": cfg.get("subscriptions") or [],
            "agent_notes": cfg.get("agent_notes") or {},
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
        elif self.path == "/api/work-stats":
            body, kind = json.dumps(work_stats()).encode(), "application/json"
        elif self.path == "/api/work":
            body, kind = json.dumps(work()).encode(), "application/json"
        elif self.path == "/api/ai":
            body, kind = json.dumps(ai_providers()).encode(), "application/json"
        elif self.path == "/api/vendors":
            body, kind = json.dumps(vendors()).encode(), "application/json"
        elif self.path == "/api/tickets":
            body, kind = json.dumps(tickets()).encode(), "application/json"
        elif self.path.startswith("/api/card?"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            repo, number = (q.get("repo") or [""])[0], (q.get("n") or [""])[0]
            if not re.fullmatch(r"[\w.-]+", repo) or not number.isdigit():
                self.send_error(400)
                return
            body, kind = json.dumps(card(repo, int(number))).encode(), "application/json"
        elif self.path == "/api/domains":
            body, kind = json.dumps(domains()).encode(), "application/json"
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
    threading.Thread(target=ai_providers, daemon=True).start()  # the first read is slow: start it before a page asks
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.request_queue_size = 64  # the page asks for about ten things at once on load; the default is 5
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
