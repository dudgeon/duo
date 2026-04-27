#!/usr/bin/env bash
# Verify the built DMG actually launches without crashing.
#
# v0.4.4 was cut specifically because v0.4.0–v0.4.3 shipped DMGs
# that crashed on launch with "Cannot find module 'node-pty'": a
# bad `electron-builder.yml § files` config excluded all of
# node_modules from the bundle. The asar built fine, the DMG
# packaged fine, codesign and notarization succeeded — but on first
# `require('node-pty')` in the main process the app threw an
# Uncaught Exception and never reached the renderer.
#
# This script catches that class of bug AT CUT TIME, before the
# DMG ships. Two layers of check:
#
#   1. STATIC — confirm `app.asar.unpacked/node_modules/` exists
#      and contains the runtime-required modules listed in
#      REQUIRED_RUNTIME_MODULES. Cheap and deterministic; catches
#      the exact v0.4.4 root cause without needing to launch.
#
#   2. DYNAMIC — mount + open the .app, sleep N seconds, confirm
#      the process is still alive. Catches anything else that
#      crashes on startup (config typos, broken imports, missing
#      entitlements, Sequoia bundle-validation failures, etc.).
#
# Exits 0 if both layers pass; non-zero on any failure.

set -uo pipefail

DMG_PATTERN="${1:-dist/Duo-*-arm64.dmg}"
DMG=$(ls -1 $DMG_PATTERN 2>/dev/null | tail -1 || true)
if [ -z "${DMG}" ]; then
  echo "ERROR: no DMG found matching $DMG_PATTERN" >&2
  exit 1
fi

# Modules the main process require()s at load time. The check
# accepts the module being EITHER inside app.asar (Node can require
# from inside the archive) OR in app.asar.unpacked/ (required for
# anything with a native .node binary). Source: electron/main.ts
# top-level `import` / `require`. Update this list when you add a
# new main-process production dep.
REQUIRED_RUNTIME_MODULES=(
  "node-pty"          # PtyManager — terminal tabs (NATIVE — must unpack)
  "chokidar"          # FilesService — navigator watcher
  "electron-updater"  # auto-update flow (Stage 21c Phase 1)
)
# Modules that must specifically live in app.asar.unpacked/ because
# they ship native (.node) binaries. Node can't dlopen() a binary
# from inside an asar archive.
REQUIRED_UNPACKED_MODULES=(
  "node-pty"
)

echo "[validate-launch] DMG: $DMG"

MOUNT_POINT=$(mktemp -d)
echo "[validate-launch] Mounting at $MOUNT_POINT..."
hdiutil attach "$DMG" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
cleanup() {
  pkill -f "$MOUNT_POINT/Duo.app/Contents/MacOS/Duo" 2>/dev/null || true
  hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || \
    hdiutil detach "$MOUNT_POINT" -force -quiet 2>/dev/null || true
  rm -rf "$MOUNT_POINT"
}
trap cleanup EXIT

APP=$(ls -d "$MOUNT_POINT"/Duo.app 2>/dev/null | head -1)
if [ -z "${APP}" ]; then
  echo "ERROR: Duo.app not found inside DMG" >&2
  exit 1
fi

# ── Layer 1: static — required runtime modules are reachable ────────
echo
echo "[validate-launch] Static check — runtime modules reachable from main process..."
ASAR="$APP/Contents/Resources/app.asar"
UNPACKED="$APP/Contents/Resources/app.asar.unpacked"

if [ ! -f "$ASAR" ]; then
  echo "✗ FAIL: $ASAR not found." ; exit 1
fi

# Build the in-asar listing once; cheap to grep against.
# `npx asar list` prints absolute-from-root paths starting with `/`.
ASAR_LIST=$(npx --yes asar list "$ASAR" 2>/dev/null) || {
  echo "✗ FAIL: 'npx asar list' failed against $ASAR" ; exit 1
}

# Helper: true if <module> is reachable (either path satisfies node).
# Use grep -F -x against a string instead of piping so we don't trip
# SIGPIPE when grep -q exits early on a match.
is_reachable() {
  local mod="$1"
  if [ -d "$UNPACKED/node_modules/$mod" ]; then return 0; fi
  if grep -F -x -q "/node_modules/$mod/package.json" <<<"$ASAR_LIST"; then return 0; fi
  return 1
}

MISSING=()
for mod in "${REQUIRED_RUNTIME_MODULES[@]}"; do
  is_reachable "$mod" || MISSING+=("$mod")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "✗ FAIL: required runtime modules unreachable (not in app.asar OR app.asar.unpacked):"
  for mod in "${MISSING[@]}"; do
    echo "    - $mod"
  done
  echo "  The main process require()s these on startup; their absence"
  echo "  causes 'Cannot find module' on launch. Confirm"
  echo "  electron-builder.yml § files includes 'node_modules/**/*'"
  echo "  (NOT '!node_modules/**/*'). If a new main-process dep was"
  echo "  added, also update REQUIRED_RUNTIME_MODULES at the top of"
  echo "  this script."
  exit 1
fi
echo "✓ Static check passed (${#REQUIRED_RUNTIME_MODULES[@]} required modules reachable)."

# Native-only check: modules with .node binaries must specifically
# live in app.asar.unpacked/ (Node can't dlopen() from inside asar).
NATIVE_MISSING=()
for mod in "${REQUIRED_UNPACKED_MODULES[@]}"; do
  if [ ! -d "$UNPACKED/node_modules/$mod" ]; then
    NATIVE_MISSING+=("$mod")
  fi
done
if [ ${#NATIVE_MISSING[@]} -gt 0 ]; then
  echo "✗ FAIL: native modules missing from app.asar.unpacked/:"
  for mod in "${NATIVE_MISSING[@]}"; do
    echo "    - $mod"
  done
  echo "  These ship native (.node) binaries that Node cannot dlopen()"
  echo "  from inside an asar archive. Check electron-builder.yml §"
  echo "  asarUnpack — the pattern must match these modules."
  exit 1
fi
echo "✓ Native modules unpacked (${#REQUIRED_UNPACKED_MODULES[@]} required)."

# Bonus: confirm node-pty's native binary is on disk where Node will
# look for it when require('node-pty') runs.
PTY_NODE="$UNPACKED/node_modules/node-pty/build/Release/pty.node"
if [ ! -f "$PTY_NODE" ]; then
  echo "✗ FAIL: $PTY_NODE missing — node-pty directory present but native binary absent."
  echo "  electron-rebuild may not have run before packaging."
  exit 1
fi
echo "✓ node-pty native binary present: $PTY_NODE"

# ── Layer 2: dynamic — does it actually launch? ─────────────────────
echo
echo "[validate-launch] Dynamic check — launching $APP..."
# Bring it up. `open` returns immediately; the process spawns async.
open "$APP"

# Give Electron time to spawn the main process, hit any crash on the
# main path, and (if alive) reach the steady-state event loop. 8s is
# generous on M1; bump if you see flakes on slower hardware.
SETTLE_SECONDS=8
echo "[validate-launch] Waiting ${SETTLE_SECONDS}s for app to settle..."
sleep "$SETTLE_SECONDS"

if ! pgrep -f "$APP/Contents/MacOS/Duo" >/dev/null; then
  echo "✗ FAIL: Duo.app crashed within ${SETTLE_SECONDS}s of launch."
  echo "  Check Console.app → 'Duo' for the crash log. Most likely a"
  echo "  main-process require() failure or a renderer load error."
  exit 1
fi
echo "✓ Duo.app launched and stayed alive past ${SETTLE_SECONDS}s."

# Kill it before the trap unmounts. (Belt-and-braces — the trap
# will pkill again, but doing it here gives a cleaner exit message.)
pkill -f "$APP/Contents/MacOS/Duo" 2>/dev/null || true
sleep 1

echo
echo "[validate-launch] All checks passed."
