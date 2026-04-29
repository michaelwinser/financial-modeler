#!/usr/bin/env bash
# Dev helpers for the financial-modeler app.
# Reads the pinned Node version from .nvmrc (project root) and loads it
# via nvm (or another node version manager). Then runs a subcommand.
#
# Usage:
#   ./scripts/dev.sh check       # typecheck (tsc --noEmit)
#   ./scripts/dev.sh test        # run unit & integration tests once
#   ./scripts/dev.sh verify      # ping dev server, report HTTP for key paths
#   ./scripts/dev.sh tail        # tail recent vite log (best effort)
#   ./scripts/dev.sh dev         # run vite dev server in foreground
#   ./scripts/dev.sh install     # npm ci (deterministic install from lockfile)
#   ./scripts/dev.sh build       # production build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"
cd "$APP_DIR"

# Read the pinned Node version from .nvmrc (project root).
NVMRC="$REPO_ROOT/.nvmrc"
if [ ! -f "$NVMRC" ]; then
  echo "missing $NVMRC — cannot determine Node version" >&2
  exit 1
fi
NODE_VERSION="$(tr -d '[:space:]' < "$NVMRC")"

# Try nvm first (most common). Fall back to a hint for other managers.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use "$NODE_VERSION" >/dev/null 2>&1 || {
    echo "nvm: node $NODE_VERSION not installed; run: nvm install $NODE_VERSION" >&2
    exit 1
  }
else
  # Verify the active node matches what .nvmrc expects.
  ACTIVE="$(node --version 2>/dev/null | sed 's/^v//')"
  if [ "$ACTIVE" != "$NODE_VERSION" ]; then
    echo "node $NODE_VERSION required (.nvmrc); active is ${ACTIVE:-none}." >&2
    echo "install nvm (https://github.com/nvm-sh/nvm), or use fnm/asdf/volta and run 'use $NODE_VERSION' from $REPO_ROOT first." >&2
    exit 1
  fi
fi

cmd="${1:-check}"
shift || true
case "$cmd" in
  check)
    npm run typecheck --silent
    echo "tsc: clean"
    ;;

  test)
    npm test --silent -- "$@"
    ;;

  build)
    npm run build
    ;;

  verify)
    for path in src/main.tsx src/App.tsx src/store.ts src/engine.ts \
                src/components/AccountsTree.tsx \
                src/components/EventTimeline.tsx \
                src/components/Inspector.tsx \
                src/components/CashFlowChart.tsx \
                src/components/ProjectionView.tsx \
                src/components/ErrorBoundary.tsx; do
      code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5173/$path" || true)
      printf "  %-50s %s\n" "$path" "${code:-ERR}"
    done
    ;;

  tail)
    # Best-effort: find the most recent task-output file that looks like
    # a vite log (matches "VITE" or "vite ready"). The Claude task runner
    # writes a *.output per backgrounded command, so we filter by content
    # to skip unrelated logs. For direct human use, just watch the
    # terminal where you started `npm run dev`.
    log=$(
      ls -t /private/tmp/claude-*/*/*/tasks/*.output 2>/dev/null \
        | while read -r f; do
            if grep -q -E 'VITE v|vite ready|hmr update' "$f" 2>/dev/null; then
              echo "$f"
              break
            fi
          done \
        | head -1
    )
    if [ -n "${log:-}" ] && [ -f "$log" ]; then
      echo "tailing: $log"
      tail -30 "$log"
    else
      echo "(no Claude-managed vite log found; check the terminal where dev server is running)"
    fi
    ;;

  dev)
    npm run dev
    ;;

  install)
    npm ci
    ;;

  *)
    echo "Usage: $0 {check|test|build|verify|tail|dev|install} [args...]" >&2
    exit 2
    ;;
esac
