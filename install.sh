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
  AGENTKODEX_NO_PATH_REPAIR   set to 1 to skip shell PATH updates
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

npm_prefix() {
  npm config get prefix 2>/dev/null | tail -n 1
}

npm_global_bin() {
  prefix="$(npm_prefix)"
  [ -n "$prefix" ] || return 1
  printf '%s/bin\n' "$prefix"
}

path_has_dir() {
  dir="$1"
  case ":$PATH:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

profile_file() {
  if [ -n "${SHELL:-}" ] && printf '%s' "$SHELL" | grep -q 'zsh'; then
    printf '%s/.zshrc\n' "$HOME"
  elif [ -f "$HOME/.bashrc" ]; then
    printf '%s/.bashrc\n' "$HOME"
  else
    printf '%s/.profile\n' "$HOME"
  fi
}

append_profile_path() {
  dir="$1"
  file="$(profile_file)"
  line="export PATH=\"$dir:\$PATH\""
  if [ -f "$file" ] && grep -F "$line" "$file" >/dev/null 2>&1; then
    printf '%s\n' "$file"
    return 0
  fi
  {
    printf '\n# Agentkodex PATH\n'
    printf '%s\n' "$line"
  } >> "$file"
  printf '%s\n' "$file"
}

try_common_launcher() {
  target="$1"
  link="/usr/local/bin/agentkodex"
  if path_has_dir "/usr/local/bin" && [ -w "/usr/local/bin" ] && [ ! -e "$link" ]; then
    ln -s "$target" "$link" 2>/dev/null || true
  fi
}

repair_path() {
  [ "${AGENTKODEX_NO_PATH_REPAIR:-0}" != "1" ] || return 0
  command -v agentkodex >/dev/null 2>&1 && return 0
  bin_dir="$(npm_global_bin || true)"
  [ -n "$bin_dir" ] || return 0
  bin="$bin_dir/agentkodex"
  [ -x "$bin" ] || return 0
  if ! path_has_dir "$bin_dir"; then
    try_common_launcher "$bin"
    export PATH="$bin_dir:$PATH"
    profile="$(append_profile_path "$bin_dir")"
    say "Added Agentkodex npm bin to PATH profile: $profile"
    say "For existing shells, run: export PATH=\"$bin_dir:\$PATH\""
  fi
}

verify_install() {
  repair_path
  if ! command -v agentkodex >/dev/null 2>&1; then
    echo "Agentkodex installed, but agentkodex is not on PATH." >&2
    bin_dir="$(npm_global_bin || true)"
    if [ -n "$bin_dir" ] && [ -x "$bin_dir/agentkodex" ]; then
      echo "Try now: export PATH=\"$bin_dir:\$PATH\"" >&2
      echo "Or run directly: \"$bin_dir/agentkodex\" --help" >&2
    else
      echo "Expected npm global bin directory: ${bin_dir:-unknown}" >&2
    fi
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
