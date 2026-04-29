#!/usr/bin/env bash
# Dev helpers for the financial-modeler mock.
# Loads nvm, pins node 20.20.2 (mock requires node ≥ 20), runs a subcommand.
#
# Usage:
#   ./scripts/dev.sh check       # tsc --noEmit (typecheck)
#   ./scripts/dev.sh verify      # ping dev server, report HTTP for key paths
#   ./scripts/dev.sh tail        # tail recent vite log (best effort)
#   ./scripts/dev.sh dev         # run vite dev server in foreground
#   ./scripts/dev.sh install     # npm install (with the right node)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

# Load nvm; pin node 20.20.2.
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 20.20.2 >/dev/null 2>&1 || {
  echo "nvm node 20.20.2 not installed; run: nvm install 20.20.2" >&2
  exit 1
}

cmd="${1:-check}"
case "$cmd" in
  check)
    npx tsc --noEmit
    echo "tsc: clean"
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
    npm install
    ;;

  *)
    echo "Usage: $0 {check|verify|tail|dev|install}" >&2
    exit 2
    ;;
esac
