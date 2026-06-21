#!/usr/bin/env bash
# scripts/check-materialization.sh
#
# Pre-flight for TWO shapes of the macOS iCloud "Optimize Mac Storage" trap:
#
#   1. EVICTION (dataless) — iCloud evicts tracked file *bytes* to cloud-only
#      (the BSD `dataless` flag). The file is zero-bytes on disk even though
#      metadata claims a non-zero size, which breaks `git status`, `npm run
#      dev`, vitest, and basically every dev tool. Recovered by re-reading
#      the bytes (`scripts/materialize.sh`).
#
#   2. SYNC-CONFLICT DUPLICATES — iCloud drops a conflict copy named
#      `<file> 2.ts` (space + digit + dot + ext) next to the real file. These
#      are UNTRACKED, but tsconfig's `core/**` + `renderer/**` include globs
#      pick them up and they cause spurious TS6307 typecheck failures on files
#      nobody touched (155 of them blocked the v0.11.1 cut, 2026-06-18).
#      `npm run materialize` does NOT clean these — they're moved aside, not
#      re-read.
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
#   bash scripts/check-materialization.sh --fix     # re-download dataless +
#                                                   #   move duplicates aside
#   bash scripts/check-materialization.sh --strict  # exit 1 if dataless (NOT on dups)
#
# See also:
#   scripts/materialize.sh           (eviction recovery; `--dedup` for duplicates)
#   CLAUDE.md § iCloud Drive trap

set -euo pipefail

QUIET=0
FIX=0
STRICT=0
for arg in "$@" ; do
  case "$arg" in
    --quiet)  QUIET=1 ;;
    --fix)    FIX=1 ;;
    # --strict turns the EVICTION warning into a fatal exit-1. Default is
    # warn-and-continue so `predev` hooks don't block dev launches. The
    # DUPLICATE warning is always warn-only (see below).
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

# ── Variant 1: EVICTION (dataless) ──────────────────────────
# ls -lO is macOS's way to surface BSD file flags. The `dataless`
# flag is the smoking gun — set by Apple's file provider when a
# file's content has been evicted but the inode metadata remains.
DATALESS_FILES=$(find "${EXISTING[@]}" -type f -print0 2>/dev/null \
  | xargs -0 ls -lO 2>/dev/null \
  | grep dataless || true)

# ── Variant 2: SYNC-CONFLICT DUPLICATES ─────────────────────
# Untracked `<file> 2.ts` copies under source dirs (where a name like
# `foo 2.ts` is never legitimate). `git ls-files --others` honors
# .gitignore, so node_modules / dist / out are already excluded. We use a
# bash `case` glob, NOT `grep -zE`: macOS ships BSD grep, whose `-z` does
# not behave like GNU grep's and would silently match nothing here.
DUP_DIRS=(core renderer shared electron cli)
DUP_FILES=()
while IFS= read -r dupf ; do
  case "$dupf" in
    *" "[0-9].*) DUP_FILES+=("$dupf") ;;
  esac
done < <(git ls-files --others --exclude-standard -- "${DUP_DIRS[@]}" 2>/dev/null || true)

# ── Clean? (both variants) ──────────────────────────────────
if [ -z "$DATALESS_FILES" ] && [ "${#DUP_FILES[@]}" -eq 0 ] ; then
  [ "$QUIET" -eq 1 ] || echo "✓ check-materialization: all critical files materialized; no iCloud duplicates"
  exit 0
fi

# ── Report variant 2 (DUPLICATES) — always warn-only ────────
# Warn-only even under --strict: a sync-conflict duplicate is a transient,
# trivially-cleaned local artifact, and the predev/pretest hooks must not
# block on it. (The eviction variant below is the one that can fail --strict.)
if [ "${#DUP_FILES[@]}" -gt 0 ] ; then
  echo ""
  echo "⚠️  ${#DUP_FILES[@]} untracked iCloud sync-conflict DUPLICATE file(s) under source dirs."
  echo ""
  echo "    First 5:"
  printf '      %s\n' "${DUP_FILES[@]:0:5}"
  echo ""
  echo "    What happened: iCloud Drive created conflict copies named"
  echo "    '<file> 2.ts' (space + digit) next to the real files. They are"
  echo "    untracked, but tsconfig's core/** + renderer/** globs pick them"
  echo "    up → spurious TS6307 typecheck failures on files you never"
  echo "    touched. 'npm run materialize' does NOT clean these."
  echo ""
  if [ "$FIX" -eq 1 ] ; then
    DEST="${TMPDIR:-/tmp}/duo-icloud-dupes"
    for dupf in "${DUP_FILES[@]}" ; do
      mkdir -p "$DEST/$(dirname "$dupf")"
      mv "$dupf" "$DEST/$dupf"
    done
    echo "    --fix: moved ${#DUP_FILES[@]} duplicate(s) to $DEST"
    echo ""
  else
    echo "    Fix: bash scripts/materialize.sh --dedup   (moves them to \$TMPDIR)"
    echo "         or re-run this with --fix."
    echo ""
  fi
fi

# ── Report variant 1 (EVICTION) — can fail under --strict ───
if [ -n "$DATALESS_FILES" ] ; then
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
    if [ "$STRICT" -eq 1 ] ; then exit 1 ; fi
  fi
fi

exit 0
