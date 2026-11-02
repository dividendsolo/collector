#!/bin/sh
# Collector — one command that installs it and starts it, on macOS and on Linux.
#
#   In a checkout:  ./install.sh
#   From anywhere:  curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh
#
# What it does: gets the repo (it is already there when you run it in a checkout, and cloned when you pipe it in),
# checks the tools Collector needs, installs its packages, builds it, and starts the server on a free port. It
# writes nothing but `node_modules` and `.next` inside the Collector folder: no config.json, no .env, and nothing
# outside the folder. Collector runs with no settings at all.
#
# Environment (every one optional):
#   COLLECTOR_DIR       where to put the repo when this runs outside a checkout (default $HOME/collector)
#   COLLECTOR_PORT      the port to serve on (default 4000, or the first free port above it)
#   COLLECTOR_REPO_URL  the repo to clone (default https://github.com/dividendsolo/collector.git)
#   COLLECTOR_REF       the branch or tag to clone (default main)
#
# Options:
#   --dir <path>      clone the repo here (ignored when this runs in a checkout)
#   --port <n>        serve on this port
#   --no-install-bun  fail instead of installing bun when it is missing
#   -h, --help        this text

set -eu

REPO_URL="${COLLECTOR_REPO_URL:-https://github.com/dividendsolo/collector.git}"
REF="${COLLECTOR_REF:-main}"
DIR=""
PORT="${COLLECTOR_PORT:-}"
INSTALL_BUN=1

say() { printf '%s\n' "$*"; }
die() {
  printf 'collector: %s\n' "$*" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    "Collector — one command that installs it and starts it, on macOS and on Linux." \
    "" \
    "  In a checkout:  ./install.sh" \
    "  From anywhere:  curl -fsSL https://raw.githubusercontent.com/dividendsolo/collector/main/install.sh | sh" \
    "" \
    "Options:" \
    "  --dir <path>      clone the repo here (ignored when this runs in a checkout)" \
    "  --port <n>        serve on this port" \
    "  --no-install-bun  fail instead of installing bun when it is missing" \
    "  -h, --help        this text" \
    "" \
    "Environment (every one optional):" \
    "  COLLECTOR_DIR       where to put the repo when this runs outside a checkout (default \$HOME/collector)" \
    "  COLLECTOR_PORT      the port to serve on (default 4000, or the first free port above it)" \
    "  COLLECTOR_REPO_URL  the repo to clone (default https://github.com/dividendsolo/collector.git)" \
    "  COLLECTOR_REF       the branch or tag to clone (default main)"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir)
      [ $# -ge 2 ] || die "--dir needs a path"
      DIR="$2"
      shift
      ;;
    --dir=*) DIR="${1#*=}" ;;
    --port)
      [ $# -ge 2 ] || die "--port needs a number"
      PORT="$2"
      shift
      ;;
    --port=*) PORT="${1#*=}" ;;
    --no-install-bun) INSTALL_BUN=0 ;;
    -h | --help | help)
      usage
      exit 0
      ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
  shift
done

# A Collector checkout is a folder with the app, the reader script and this installer in it. `./install.sh` and
# `sh /path/to/install.sh` both say where the file is. Piped in (`curl | sh`, `sh -s`) `$0` is just the shell's name
# and there is no folder to look in, so the repo is cloned instead — and `sh install.sh` names no folder either, so
# that one looks in the folder it was run from.
here=""
case "$0" in
  */*) here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) ;;
  *)
    if [ -f "./$0" ]; then
      here=$(pwd)
    fi
    ;;
esac
is_checkout() { [ -f "$1/package.json" ] && [ -f "$1/collect.py" ] && [ -f "$1/install.sh" ]; }

if [ -n "$here" ] && is_checkout "$here"; then
  src="$here"
  say "Collector is here: $src"
else
  src="${DIR:-${COLLECTOR_DIR:-$HOME/collector}}"
  command -v git >/dev/null 2>&1 ||
    die "git is needed to download Collector: install git, or clone $REPO_URL yourself and run ./install.sh in it"
  if [ -e "$src" ] && [ ! -d "$src/.git" ]; then
    die "$src already exists and is not a Collector checkout: move it aside, or pick another folder with --dir"
  fi
  if [ -d "$src/.git" ]; then
    say "Updating $src from $REF"
    git -C "$src" fetch --depth 1 origin "$REF" >/dev/null 2>&1 &&
      git -C "$src" merge --ff-only FETCH_HEAD >/dev/null 2>&1 ||
      say "  could not update it; using the copy that is there"
  else
    say "Downloading Collector into $src"
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$src" ||
      die "could not clone $REPO_URL (branch $REF)"
  fi
fi

is_checkout "$src" || die "$src does not hold Collector: run this in a Collector checkout"

# Bun, the runtime Collector builds and runs on: the one on this machine, else the one a last run installed (bun's
# own installer puts it in ~/.bun/bin and in the shell's startup file, which a second run of this script would not
# have read), else install it from bun.sh.
BUN_BIN="${BUN_INSTALL:-$HOME/.bun}/bin"
if ! command -v bun >/dev/null 2>&1 && [ -x "$BUN_BIN/bun" ]; then
  PATH="$BUN_BIN:$PATH"
  export PATH
fi
if ! command -v bun >/dev/null 2>&1; then
  [ "$INSTALL_BUN" = 1 ] || die "bun is not installed: install it from https://bun.sh and run this again"
  command -v curl >/dev/null 2>&1 ||
    die "curl is needed to install bun: install bun from https://bun.sh and run this again"
  say "Installing bun (the JavaScript runtime Collector runs on) from https://bun.sh"
  curl -fsSL https://bun.sh/install | bash || die "could not install bun: install it from https://bun.sh"
  if [ -x "$BUN_BIN/bun" ]; then
    PATH="$BUN_BIN:$PATH"
    export PATH
  fi
  command -v bun >/dev/null 2>&1 ||
    die "bun was installed to $BUN_BIN but is not on PATH: open a new terminal and run this again"
fi
say "bun $(bun --version)"

# collect.py reads every machine (this one too) over Python 3, standard library only. Collector still starts without
# it, with its panels empty, so this is a note and not a failure.
command -v python3 >/dev/null 2>&1 ||
  say "note: python3 is not installed. Collector reads every machine with it (collect.py), so its job and agent rows stay empty until it is: https://www.python.org/downloads/"

cd "$src"
say "Installing packages"
bun install || die "bun install failed"
say "Building"
bun run build || die "bun run build failed"

# The port: the first free one from 4000 up, unless one was asked for by name.
port_free() {
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import socket, sys
s = socket.socket()
s.settimeout(0.2)
sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1]))) != 0 else 1)' "$1"
}
if [ -n "$PORT" ]; then
  port_free "$PORT" || die "port $PORT is already in use: pick another with --port"
  port="$PORT"
else
  port=4000
  while [ "$port" -lt 4020 ] && ! port_free "$port"; do
    port=$((port + 1))
  done
fi

say ""
say "Collector is running at http://127.0.0.1:$port"
say "It shows what it finds on its own; settings are optional and live in config.json (see SETUP.md)."
say "Press Ctrl-C to stop it."
COLLECTOR_PORT="$port"
export COLLECTOR_PORT
exec bun start
