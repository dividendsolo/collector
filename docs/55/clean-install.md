# A stranger's install, proved on a clean Linux box (collector#55)

What the card's Done-when asks for, run for real:

> A clean checkout on a machine with none of James's files installs with the one command and opens the main page with
> its empty states (no crash, no missing-file error); proved on a clean Linux box or container.

## The box

`docker run debian:stable-slim`, nothing of ours on it: a home with `.bashrc` and `.profile` and nothing else, no
`~/.hermes`, no `config.json`, no `.env`, no bun, no `ps`, no `gh`, no `docker`, no `git` config. What it does have
is what a fresh Linux box has or a person installs in a minute: `git 2.47.3`, `Python 3.13.5`, `curl`, `unzip`,
`ca-certificates`.

```
git version 2.47.3
Python 3.13.5
no ps
no bun
no gh
.
..
.bashrc
.profile
no ~/.hermes: yes
```

## The one command

The card's command is the README's, `curl -fsSL .../install.sh | sh`. In the container the script is piped in from
the commit under test instead of over the network (`cat /src/install.sh | sh`, so `$0` is not a path and the script
takes its clone branch), and the clone source is a git bundle of `agent/55` at `0411f85` rather than
`https://github.com/dividendsolo/collector.git`:

```sh
docker exec -d collector-fresh env COLLECTOR_REPO_URL=/src/collector.bundle COLLECTOR_REF=agent/55 \
  sh -c 'cd $HOME && cat /src/install.sh | sh > /tmp/install.log 2>&1'
```

The network form was exercised too, by accident: the first attempt ran without those two variables, so the script
cloned `https://github.com/dividendsolo/collector.git` from inside the container and checked out `main` (28d201d) —
the real clone works from a bare box, and stopped there with `collector: /root/collector does not hold Collector`,
because `install.sh` is not on `main` until this card merges.

What the command printed:

```
Downloading Collector into /root/collector
Installing bun (the JavaScript runtime Collector runs on) from https://bun.sh
bun 1.4.4
Installing packages
Building
Collector is running at http://127.0.0.1:4000
✓ Ready in 193ms
```

`bun install` and `next build` ran clean (the build's warnings about Node APIs in the Edge runtime and about dynamic
filesystem tracing are on `main` too), `postbuild` stamped the build, and the server came up on the first free port
of 4000.

Run again in the same box — the case of a person starting Collector a second time — it finds the bun the first run
installed, updates the checkout, and takes the next free port because the first server still holds 4000:

```
Updating /root/collector from agent/55
bun 1.4.4
Installing packages
Building
Collector is running at http://127.0.0.1:4001
```

## In a checkout: the other form the README names

`./install.sh` in a checkout it already has is the README's second block. Run in this worktree
(`sh install.sh --port 4109`, so the run does not take 4000 of a machine that may be using it):

```
Collector is here: /home/div/code/collector/.worktrees/build-55
bun 1.4.3
Installing packages
Building
Collector is running at http://127.0.0.1:4109
```

and `http://127.0.0.1:4109/api/state` answered `machine: this machine | error: None | jobs: 50` — that machine's own
systemd timers, read as it should be. That run found a bug of its own: `sh install.sh` puts no path in `$0`, so the
script fell through to the clone branch and tried to download a second copy into `$HOME/collector`. It reads the
folder it was run from now (`0411f85`), and a piped script still clones, since `$0` is then just the shell's name.

## The page, with its empty states

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/
200

$ curl -s http://127.0.0.1:4000/api/state
machine: this machine | error: None | jobs: 0 | running: 0 | watch: 0 | profiles: 0 | gateway: None
warnings: []

$ curl -s http://127.0.0.1:4000/api/tickets
{"each":["ready-for-human","needs-manual-qa","needs-info","needs-triage"],"count":[],"working":["agent-in-progress","verify-in-progress"],"done":["closed"],"tickets":[],"error":null,"loaded":true}

$ python3 collect.py '{}'      # the reader, run by hand on the box
{"host": "...", "tz": "UTC", "now": "...", "jobs": [], "tailscale": null, "hermes_gateway": null, "watch": [],
 "running": [], "host_broken": [], "profiles": [], "work_ticks_10m": null, "work_starts_10m": null}
```

`docs/main-page.png` is that page: the Dashboard of this install, screenshotted with headless Chrome over CDP at
1440×1000 (`Page.captureScreenshot` after the page settled), and the README's screenshot. Empty states only — nothing
of James's is on it, because nothing of James's was on the box.

## The bug this found, and the fix

The first clean-box run was not clean. The page came up and answered, and the machine read came back as an error:

```
Could not read this machine: Traceback (most recent call last):
  File "/home/clean/collector/collect.py", line 1452, in <module>
    main()
  File "/home/clean/collector/collect.py", line 1442, in main
    "watch": watch_rows(now),
  File "/home/clean/collector/collect.py", line 1423, in watch_rows
    ps_out = subprocess.run(["ps", "-axo", "pid=,etime=,command="], capture_output=True, text=True).stdout
FileNotFoundError: [Errno 2] No such file or directory: 'ps'
```

Three reads in `collect.py` called `subprocess.run` directly instead of `read_command` — the helper that already
existed for exactly this ("No tool is not an error: a Mac has no systemctl, and `crontab -l` exits 1 with no
crontab") and returns nothing when a binary is missing. One missing `ps` failed the whole snapshot, which is the
card's "no crash, no missing-file error". The three sites (`running_agents`, `watch_rows`, `verify_heads`) go
through `read_command` now, and `tests/clean-machine.test.ts` is the machine that found it: the real `collect.py`
run with only `python3` on `PATH` and an empty `HOME` (red with the traceback above, green with empty rows and exit
0).

## What the box had afterwards

```
no config.json and no .env in the checkout
/root/collector/node_modules
/root/collector/.next
$ ls -a /root
. .. .bashrc .bun .profile collector
```

`node_modules` and `.next` inside the checkout, bun's own `~/.bun` and the `PATH` line in `.bashrc` its installer
writes, and nothing else: no settings file, no `.env`, nothing outside the user's home, and nothing at all on the
machines Collector reads.

## The screenshot, taken again after review (fc2ec81)

The review of b3052d7 found the screenshot showing "No services in config.json yet." twice in Service health: once
in the panel's summary line and once in its empty list. The summary now stays empty when there are no services
(`tests/service-health.test.ts`), and `docs/main-page.png` was taken again from a fresh install of `fc2ec81`, run the
same way: a new `debian:stable-slim` container with `git`, `python3`, `curl`, `unzip` and `ca-certificates`, no `ps`,
and `cat /src/install.sh | sh` cloning from a bundle of `agent/55`. The installer printed the same lines as above
(`Downloading Collector into /root/collector` through `Collector is running at http://127.0.0.1:4000`), `/` answered
200, `/api/services` answered `[]`, and the machine read came back with `"error": null` and no jobs. Because the
installer binds `127.0.0.1` inside the container, the page was served again with `next start -H 0.0.0.0` for the
host's headless Chrome (`--headless=new`, CDP, 1440×1000). The page's own text had the message once, Needs attention
read "Nothing needs attention.", and the container was removed afterwards.
