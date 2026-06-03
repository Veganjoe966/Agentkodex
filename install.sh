#!/bin/sh
set -eu

PACKAGE_NAME="${AGENTKODEX_NPM_PACKAGE:-agentkodex}"
GITHUB_REPO="${AGENTKODEX_GITHUB_REPO:-Veganjoe966/Agentkodex}"
GITHUB_REF="${AGENTKODEX_GITHUB_REF:-main}"
SOURCE="${AGENTKODEX_INSTALL_SOURCE:-npm}"
FALLBACK=1

banner() {
  cat <<'EOF'

    _    ____ _____ _   _ _____ _  __ ___  ____  _____ __  __
   / \  / ___| ____| \ | |_   _| |/ / / _ \|  _ \| ____|\ \/ /
  / _ \| |  _|  _| |  \| | | | | ' / | | | | | | |  _|   \  /
 / ___ \ |_| | |___| |\  | | | | . \ | |_| | |_| | |___  /  \
/_/   \_\____|_____|_| \_| |_| |_|\_\ \___/|____/|_____/_/\_\

  CLI-native agent operations runtime

EOF
}

usage() {
  cat <<'EOF'
Agentkodex installer

Usage:
  sh install.sh [--source npm|github] [--no-fallback]

Default:
  Install with npm from the npm registry first.
  If npm registry install fails, fall back to npm installing the GitHub source.

Environment:
  AGENTKODEX_NPM_PACKAGE      npm package name, default agentkodex
  AGENTKODEX_GITHUB_REPO      GitHub fallback repo, default Veganjoe966/Agentkodex
  AGENTKODEX_GITHUB_REF       GitHub fallback ref, default main
  AGENTKODEX_INSTALL_SOURCE   npm or github, default npm
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --source=*)
      SOURCE="${1#*=}"
      shift
      ;;
    --no-fallback)
      FALLBACK=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

say() {
  printf '%s\n' "$*"
}

can_animate() {
  [ -t 1 ] && [ "${AGENTKODEX_NO_ANIMATION:-0}" != "1" ]
}

run_with_animation() {
  label="$1"
  shift
  if ! can_animate; then
    "$@"
    return $?
  fi
  log_file="${TMPDIR:-/tmp}/agentkodex-install.$$.log"
  set +e
  "$@" >"$log_file" 2>&1 &
  pid=$!
  tick=0
  while kill -0 "$pid" 2>/dev/null; do
    tick=$(( (tick + 1) % 4 ))
    case "$tick" in
      0) frame='|' ;;
      1) frame='/' ;;
      2) frame='-' ;;
      *) frame='\' ;;
    esac
    printf '\r[%s] %s' "$frame" "$label"
    sleep 0.12
  done
  wait "$pid"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    printf '\r[OK] %s\n' "$label"
    [ "${AGENTKODEX_VERBOSE:-0}" = "1" ] && cat "$log_file"
    rm -f "$log_file"
    return 0
  fi
  printf '\r[!!] %s\n' "$label" >&2
  cat "$log_file" >&2
  rm -f "$log_file"
  return "$status"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Agentkodex requires $1 on PATH." >&2
    exit 1
  }
}

check_node() {
  need_cmd node
  need_cmd npm
  major="$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")"
  if [ "$major" -lt 18 ]; then
    echo "Agentkodex requires Node.js 18 or newer. Current: $(node --version)" >&2
    exit 1
  fi
}

install_from_npm() {
  package_spec="$PACKAGE_NAME"
  if [ "${AGENTKODEX_VERSION:-}" ]; then
    package_spec="$PACKAGE_NAME@$AGENTKODEX_VERSION"
  fi
  run_with_animation "Installing Agentkodex from npm: $package_spec" npm install -g "$package_spec"
}

install_from_github() {
  package_spec="github:$GITHUB_REPO#$GITHUB_REF"
  run_with_animation "Installing Agentkodex from GitHub fallback: $package_spec" npm install -g "$package_spec"
}

verify_install() {
  if ! command -v agentkodex >/dev/null 2>&1; then
    echo "Agentkodex installed, but agentkodex is not on PATH." >&2
    echo "Check your npm global bin directory: npm bin -g" >&2
    exit 1
  fi
  say "Agentkodex installed: $(agentkodex --version)"
  say "Run: agentkodex quickstart"
}

main() {
  banner
  check_node
  case "$SOURCE" in
    npm)
      if install_from_npm; then
        verify_install
        exit 0
      fi
      if [ "$FALLBACK" -eq 1 ]; then
        say "npm registry install failed; trying GitHub fallback."
        install_from_github
        verify_install
        exit 0
      fi
      exit 1
      ;;
    github)
      install_from_github
      verify_install
      ;;
    *)
      echo "Invalid source: $SOURCE. Use npm or github." >&2
      exit 2
      ;;
  esac
}

main "$@"
