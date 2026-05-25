#!/usr/bin/env bash
# scripts/check-materialization.sh
#
# Pre-flight: warn loudly if any tracked working-tree files have been
# evicted to iCloud Drive cloud-only state (the "dataless" attribute).
# This shape of file-loss breaks `git status`, `npm run dev`, vitest,
# and pretty much every dev tool — the file is zero-bytes on disk
# even though metadata claims a non-zero size.
#
# Triggered by the Sprint 22 session-start emergency 2026-05-25:
# macOS's "Optimize Mac Storage" feature, combined with disk pressure
# (94% full), aggressively evicted 13,000+ files including some `.git`
# internals. Some files (especially recently-written ones) had no
# cloud copy yet and were unrecoverable except by `git checkout HEAD`.
#
# Usage:
#   bash scripts/check-materialization.sh           # exit 0 if clean, 1 if dataless
#   bash scripts/check-materialization.sh --quiet   # silent on success
#   bash scripts/check-materialization.sh --fix     # auto-invoke materialize.sh
#
# See also:
#   scripts/materialize.sh  (the recovery pass)
#   CLAUDE.md § iCloud Drive trap

set -euo pipefail

QUIET=0
FIX=0
STRICT=0
for arg in "$@" ; do
  case "$arg" in
    --quiet)  QUIET=1 ;;
    --fix)    FIX=1 ;;
    # --strict turns the warning into a fatal exit-1. Default is
    # warn-and-continue so `predev` hooks don't block dev launches.
    --strict) STRICT=1 ;;
    *) echo "unknown flag: $arg" >&2 ; exit 2 ;;
  esac
done

# Paths we care about. Skip node_modules / dist / out / worktrees by
# default — those are recoverable via `npm install` / build / git
# checkout and don't need a pre-flight scream. The scream is for
# stuff that would silently break dev tooling.
PROBE_PATHS=(.git renderer core shared cli skill electron docs/prd docs/dev scripts package.json package-lock.json tsconfig.json vitest.config.ts)

# Filter to paths that actually exist (the list is repo-shape
# specific; survive a sub-tree being absent).
EXISTING=()
for p in "${PROBE_PATHS[@]}" ; do
  if [ -e "$p" ] ; then EXISTING+=("$p") ; fi
done

# ls -lO is macOS's way to surface BSD file flags. The `dataless`
# flag is the smoking gun — set by Apple's file provider when a
# file's content has been evicted but the inode metadata remains.
DATALESS_FILES=$(find "${EXISTING[@]}" -type f -print0 2>/dev/null \
  | xargs -0 ls -lO 2>/dev/null \
  | grep dataless || true)

if [ -z "$DATALESS_FILES" ] ; then
  [ "$QUIET" -eq 1 ] || echo "✓ check-materialization: all critical files materialized"
  exit 0
fi

COUNT=$(echo "$DATALESS_FILES" | wc -l | tr -d ' ')

echo ""
echo "⚠️  $COUNT files are 'dataless' (evicted by macOS Optimize Mac Storage)."
echo ""
echo "    First 5 affected:"
echo "$DATALESS_FILES" | head -5 | awk '{for (i=10;i<=NF;i++) printf "%s%s", $i, (i<NF?" ":"\n")}' | sed 's/^/      /'
echo ""
echo "    What happened: iCloud Drive's 'Optimize Mac Storage' (System"
echo "    Settings → Apple ID → iCloud → iCloud Drive) evicted files"
echo "    locally to free disk space. The file metadata still claims"
echo "    a non-zero size, but the bytes are gone (or in the cloud)."
echo "    'git status' reports 'short read while indexing'; vitest /"
echo "    npm run dev hit 'Unexpected end of JSON input' on stub"
echo "    package.json files."
echo ""
if [ "$FIX" -eq 1 ] ; then
  echo "    --fix specified, invoking materialize.sh..."
  exec bash "$(dirname "$0")/materialize.sh"
else
  echo "    Fix options:"
  echo "      1.  bash scripts/materialize.sh     (force re-download from iCloud)"
  echo "      2.  System Settings → Apple ID → iCloud Drive → turn OFF"
  echo "          'Optimize Mac Storage' (prevents recurrence)"
  echo "      3.  For files iCloud can't recover, restore via:"
  echo "             git checkout HEAD -- <path>"
  echo ""
  # Default is warn-and-continue so `npm run dev` isn't blocked by a
  # transient eviction. Pass --strict for CI / pre-commit use.
  if [ "$STRICT" -eq 1 ] ; then exit 1 ; else exit 0 ; fi
fi
