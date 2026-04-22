#!/usr/bin/env bash
# install.sh — creates the orbit symlink so the CLI is on PATH
# Called by the Orbit app on first launch (privileged helper or prompted via dialog).
# Also usable standalone: ./install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_SRC="$SCRIPT_DIR/orbit"
SYSTEM_BIN="/usr/local/bin/orbit"
USER_BIN="$HOME/.local/bin/orbit"

if [[ ! -f "$CLI_SRC" ]]; then
  echo "orbit install: CLI binary not found at $CLI_SRC" >&2
  exit 1
fi

chmod +x "$CLI_SRC"

# Try /usr/local/bin first (requires admin); fall back to ~/.local/bin
if [[ -w "/usr/local/bin" ]] || sudo -n true 2>/dev/null; then
  if [[ -L "$SYSTEM_BIN" ]]; then rm "$SYSTEM_BIN"; fi
  sudo ln -sf "$CLI_SRC" "$SYSTEM_BIN"
  echo "orbit: installed → $SYSTEM_BIN"
else
  mkdir -p "$(dirname "$USER_BIN")"
  if [[ -L "$USER_BIN" ]]; then rm "$USER_BIN"; fi
  ln -sf "$CLI_SRC" "$USER_BIN"
  echo "orbit: installed → $USER_BIN"
  echo "orbit: add $HOME/.local/bin to your PATH if it's not already there"
fi
