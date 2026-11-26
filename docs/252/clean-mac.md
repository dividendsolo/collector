# A stranger's setup on a clean Mac (collector#252)

What the card's acceptance asks for, run for real:

> The README's setup section, followed word for word on a clean account, gets Collector running with the Mac's own
> machine row.
>
> Every step that failed on the first try is named in the PR with its fix.

Four steps of the README failed on the account. They are below in the order a reader meets them, each with its fix,
and then the setup again, all the way to the page served by the login job.

## The account

A tart VM: `ghcr.io/cirruslabs/macos-tahoe-vanilla:26.6.2`, cloned to `collector-clean` and run headless
(`tart run --no-graphics`), macOS Tahoe 26.6.2 (build 25G83). Its one account, `admin`, is what a new Mac has:

```
$ whoami; ls -a ~
admin
.  ..  .CFUserTextEncoding  .Trash  .ssh  .zsh_sessions  Desktop  Documents  Downloads  Library  Movies  Music  Pictures  Public
```

No `~/.hermes`, no `~/.bun`, no `config.json`, no `.env`, no `gh`, no bun, no Docker, no Command Line Tools. The guest
was driven over its own SSH, and the one package installed in it was the Command Line Tools (below).

## First: a new Mac has no `git` and no `python3`

Both exist as shims, and both fail:

```
$ git --version
xcode-select: note: No developer tools were found, requesting install.
$ python3 --version
xcode-select: note: No developer tools were found, requesting install.
```

So the one command stops at its clone, with nothing a stranger can act on:

```
$ curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh
Downloading Collector into /Users/admin/collector
xcode-select: note: No developer tools were found, requesting install.
If developer tools are located at a non-default location on disk, use `sudo xcode-select --switch ...`
See `man xcode-select` for more details.
collector: could not clone https://github.com/dividendsolo/collector.git (branch main)
install exit=1
```

The README named Python 3 as a requirement and never named `git`, or where either one comes from on macOS.

**The fix.** `install.sh` names what is missing before it tries, and the clone failure names it too; the README's
Requirements and its setup section say that `git` and `python3` come from the Command Line Tools. On the same account,
with `uname` answering Darwin and `xcode-select -p` failing, the branch's script prints:

```
$ sh install.sh --no-install-bun
note: this Mac has no Command Line Tools yet, so git and python3 are not installed: both are shims until then.
      run xcode-select --install, and when the install finishes, run this again.
Collector is here: ...
```

`tests/install.test.ts` runs exactly that (a stubbed Darwin with no developer tools); the committed `install.sh`
prints no such line. The test failed on `origin/main` and passes with the change.

### The one thing a new Mac must install

`softwareupdate --list` in the guest lists `Command Line Tools for Xcode 26.6`, so this needs no window and no click:

```
$ sudo softwareupdate --install "Command Line Tools for Xcode 26.6-26.6"
Downloading Command Line Tools for Xcode 26.6
Downloaded Command Line Tools for Xcode 26.6
Installing Command Line Tools for Xcode 26.6
Done with Command Line Tools for Xcode 26.6
$ git --version
git version 2.50.1 (Apple Git-155)
$ python3 --version
Python 3.9.6
```

## Second: Bun lands in `~/.bun`, and the next terminal cannot find it

The README said Bun's installer "adds itself to your `PATH` in your shell's startup file". A new account has no startup
file to edit, so the installer prints the line instead and writes nothing, and the terminal a reader opens for the
setup section's third step has no `bun`:

```
$ command -v bun || echo "bun: NOT on PATH in a new shell"
bun: NOT on PATH in a new shell
$ ls -a ~/.zshrc ~/.bashrc ~/.profile
ls: /Users/admin/.zshrc: No such file or directory
ls: /Users/admin/.bashrc: No such file or directory
ls: /Users/admin/.profile: No such file or directory
```

**The fix.** The Install section says where Bun goes, that the installer only edits a startup file that exists, and
gives the line to run in a terminal that has not seen Bun — `export PATH="$HOME/.bun/bin:$PATH"` — and the setup
section's third step points at it. `tests/launchd-install.test.ts` holds that line in the README.

## The one command, on the clean account

The README's command, run again on that account (in the background, so the run could be read while it served;
`install.sh` itself keeps it in the foreground):

```
$ curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh
Downloading Collector into /Users/admin/collector
Cloning into '/Users/admin/collector'...
Installing bun (the JavaScript runtime Collector runs on) from https://bun.sh
bun was installed successfully to ~/.bun/bin/bun
bun 1.4.5
Installing packages
100 packages installed [6.27s]
Building
$ next build
▲ Next.js 16.4.6 (Turbopack)
✓ Creating an optimized production build
Collector is running at http://127.0.0.1:4000
$ next start -H 127.0.0.1 -p ${COLLECTOR_PORT:-4000}
✓ Ready in 50ms
[server] start 2026-11-25T15:29:36.482Z pid 1102 parent 935 build dvM_rBSNt58VGdKfxxKXJ (38005aa)
```

Bun, the packages and the build all went in on a machine that had none of them.

## The page, with the Mac's own machine row

```
$ curl -s http://127.0.0.1:4000/api/state
machine: name='this machine' local=True error=None jobs=0
warnings: []
```

One row, the machine it runs on, read with the Command Line Tools' `python3`, and nothing to fix. (`jobs: 0` is right
for an account with no Hermes, no launchd job of its own and no crontab.)

## Third: the login job

The README said to copy `launchd/com.example.collector.plist` to `~/Library/LaunchAgents/`, "set the path to your
Collector folder", and bootstrap it. Followed word for word — that one path set, the plist's Bun path left as it is,
since the README never mentions it:

```
$ cp ~/collector/launchd/com.example.collector.plist ~/Library/LaunchAgents/
$ sed -i "" "s|/path/to/collector|$HOME/collector|" ~/Library/LaunchAgents/com.example.collector.plist
$ launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.collector.plist
bootstrap exit=0
$ launchctl print gui/501/com.example.collector | grep -E "program =|state =|last exit|runs ="
	state = spawn scheduled
	program = /path/to/.bun/bin/bun
	runs = 1
	last exit code = 78: EX_CONFIG
$ launchctl list | grep example
-	78	com.example.collector
```

`bootstrap` exits 0, so a stranger reads it as done. The job can never start: the plist carries two more paths the
README never named (`/path/to/.bun/bin/bun` in `ProgramArguments`, and the rebuild job's script path), and
`launchctl print` reports them only to someone who thinks to look.

**The fix.** `scripts/launchd.ts` fills every path in from the machine it runs on — this checkout, the Bun that runs
it, and the port — writes the plists to `~/Library/LaunchAgents/` and loads them, booting an older job out first. On
the same clean account, with the branch checked out:

```
$ bun scripts/launchd.ts --rebuild
[launchd] wrote /Users/admin/Library/LaunchAgents/com.example.collector.plist
[launchd] wrote /Users/admin/Library/LaunchAgents/com.example.collector-rebuild.plist
[launchd] com.example.collector is not loaded (Boot-out failed: 3: No such process)
[launchd] loaded com.example.collector
[launchd] com.example.collector-rebuild is not loaded (Boot-out failed: 3: No such process)
[launchd] loaded com.example.collector-rebuild
[launchd] Collector is at http://127.0.0.1:4000, and launchd starts it at every login
[launchd] to stop that: bun scripts/launchd.ts --uninstall
$ launchctl print gui/501/com.example.collector | grep -E "program =|state =|pid =|last exit"
	state = running
	program = /Users/admin/.bun/bin/bun
	pid = 1551
	last exit code = (never exited)
```

The page came from the job, not from a terminal: the foreground server `install.sh` left was stopped first (what the
setup section tells the reader to do), and it answered `000` before the job was loaded:

```
page before the login job: 000
machine row: [('this machine', True, None)]
$ tail -4 /tmp/collector.log
- Network:       http://127.0.0.1:4000
✓ Ready in 40ms
[server] start 2026-11-25T15:32:11.651Z pid 1556 parent 1551 build dvM_rBSNt58VGdKfxxKXJ (38005aa)
```

`parent 1551` is launchd's own pid for the job above. `--uninstall` took both jobs out, left the folder and its build
where they were, and left `~/Library/LaunchAgents/` empty.

## Fourth: the settings file

The README's by-hand line was `cp config.example.json config.json`. On the fresh install that page carried an
unreachable host, a missing launchd job, missing files and a renewal for a subscription the account does not have:

```
machine: name='laptop' local=True error=None
machine: name='vps' local=False error='ssh: Could not resolve hostname vps-host: nodename nor servname provided'
warn: error Could not read vps: ssh: Could not resolve hostname vps-host: nodename nor servname provided, or not known
warn: error Weekly report on laptop: launchd has no com.example.weekly-report on this machine
warn: warn Nightly sync on laptop: no log file at .../.logs/sync.log
warn: warn The crew on laptop: no heartbeat file at .../.work/crew.beat
warn: warn Hosting renews on 2026-12-01 for $20.00
```

`config.example.json` is one person's file, and the README presented copying it as the by-hand alternative.

**The fix.** The setup section says what the file is for, what not to do with the example, and that the page runs with
no `config.json` at all — which is what the run above shows: one row, the machine it runs on, no warnings.

## What the account looked like afterwards

```
$ ls -a ~
.  ..  .CFUserTextEncoding  .Trash  .bun  .ssh  .zsh_sessions  Desktop  Documents  Downloads  Library  Movies  Music  Pictures  Public  collector  install.log
$ ls -a ~/Library/LaunchAgents/
.  ..
$ ls ~/collector/config.json ~/collector/.env
ls: /Users/admin/collector/config.json: No such file or directory
ls: /Users/admin/collector/.env: No such file or directory
$ du -sh ~/collector ~/.bun
582M	/Users/admin/collector
598M	/Users/admin/.bun
$ ls -d ~/.hermes
ls: /Users/admin/.hermes: No such file or directory
```

The checkout (582 MB: its source with `node_modules` and the build), Bun's own `~/.bun` (598 MB), `install.log` from
this run, and nothing else: no settings file, no `.env`, no `~/.hermes`, nothing outside the user's home, and nothing
at all on the machines Collector reads. The VM was stopped and its clone deleted afterwards; the image itself was
already in `tart`'s cache.
