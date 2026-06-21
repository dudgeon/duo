#!/usr/bin/env bash
# scripts/materialize.sh
#
# Recovery: force-materialize iCloud-evicted files in this repo by
# reading them. macOS's file provider downloads the actual bytes
# from iCloud Drive when content is requested via read().
#
# Companion to scripts/check-materialization.sh. Safe to re-run.
#
# Stages:
#   1. Pause Optimize Mac Storage (prevents re-eviction mid-recovery)
#   2. Force-materialize .git/ (critical; small)
#   3. Force-materialize tracked working tree (mid-sized)
#   4. Force-materialize node_modules/ (largest; only if present)
#   5. Restore truly-stuck files via `git checkout HEAD --`
#   6. Report any survivors (files iCloud can't recover)
#
# Files that have never synced to iCloud (e.g., written locally in
# the last few minutes before eviction) can't be recovered from the
# cloud. For those, step 5 restores from the git packfile. If the
# file isn't tracked in git either, it's truly lost — restore from
# a Time Machine backup or accept the loss.

set -euo pipefail

# ── `--dedup`: clean iCloud SYNC-CONFLICT DUPLICATES (not eviction) ──
# iCloud Drive sometimes drops a conflict copy named `<file> 2.ts` next to
# the real file. They're UNTRACKED, but tsconfig's source globs pick them up
# → spurious TS6307 typecheck failures (155 of them blocked the v0.11.1 cut).
# Re-reading bytes (the recovery flow below) does NOT remove them — they must
# be moved aside. `--dedup` does only that; the full run is unchanged.
# Companion to scripts/check-materialization.sh (which detects + warns).
if [ "${1:-}" = "--dedup" ] ; then
  DEST="${TMPDIR:-/tmp}/duo-icloud-dupes"
  N=0
  while IFS= read -r f ; do
    case "$f" in
      *" "[0-9].*)
        mkdir -p "$DEST/$(dirname "$f")"
        mv "$f" "$DEST/$f" && N=$((N + 1))
        ;;
    esac
  done < <(git ls-files --others --exclude-standard -- core renderer shared electron cli 2>/dev/null || true)
  echo "materialize.sh --dedup: moved $N iCloud sync-conflict duplicate(s) to $DEST"
  exit 0
fi

echo ""
echo "──────────────────────────────────────────────────────────"
echo " materialize.sh — recovering iCloud-evicted repo files"
echo "──────────────────────────────────────────────────────────"
echo ""

# ── Step 1: pause Optimize Storage ──────────────────────────
echo "Step 1: pause iCloud Drive Optimize Mac Storage"
CURRENT=$(defaults read com.apple.bird optimize-storage 2>/dev/null || echo "1")
if [ "$CURRENT" = "0" ] ; then
  echo "  already disabled — good"
else
  defaults write com.apple.bird optimize-storage -bool false
  echo "  was enabled; now disabled. (Re-enable in System Settings if desired.)"
  # Force the file-provider daemon to pick up the new setting. bird
  # restarts automatically; iCloud Drive stays functional throughout.
  killall bird 2>/dev/null || true
  sleep 2
fi
echo ""

# ── Step 2: .git first (small; gates everything) ────────────
echo "Step 2: materialize .git/ (small but critical)"
BEFORE=$(find .git -type f 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
echo "  dataless before: $BEFORE files"
find .git -type f -print0 2>/dev/null | xargs -0 -P 8 -n 50 cat > /dev/null 2>&1 || true
AFTER=$(find .git -type f 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
echo "  dataless after:  $AFTER files (recovered $((BEFORE - AFTER)))"
echo ""

# ── Step 3: working tree (excluding node_modules, dist, out, worktrees) ──
echo "Step 3: materialize working tree (excludes node_modules / dist / out / worktrees)"
BEFORE=$(find . \( -path ./node_modules -o -path ./dist -o -path ./out -o -path './.claude/worktrees' -o -path ./.git \) -prune -o -type f -print 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
echo "  dataless before: $BEFORE files"
find . \( -path ./node_modules -o -path ./dist -o -path ./out -o -path './.claude/worktrees' -o -path ./.git \) -prune -o -type f -print0 2>/dev/null | xargs -0 -P 8 -n 50 cat > /dev/null 2>&1 || true
AFTER=$(find . \( -path ./node_modules -o -path ./dist -o -path ./out -o -path './.claude/worktrees' -o -path ./.git \) -prune -o -type f -print 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
echo "  dataless after:  $AFTER files (recovered $((BEFORE - AFTER)))"
echo ""

# ── Step 4: node_modules if present ─────────────────────────
if [ -d node_modules ] ; then
  echo "Step 4: materialize node_modules/ (largest; recoverable via npm install if needed)"
  BEFORE=$(find node_modules -type f 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
  echo "  dataless before: $BEFORE files"
  find node_modules -type f -print0 2>/dev/null | xargs -0 -P 8 -n 50 cat > /dev/null 2>&1 || true
  AFTER=$(find node_modules -type f 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
  echo "  dataless after:  $AFTER files (recovered $((BEFORE - AFTER)))"
  echo ""
else
  echo "Step 4: skipped (no node_modules dir)"
  echo ""
fi

# ── Step 5: git checkout for stuck files ────────────────────
echo "Step 5: restore truly-stuck files via git checkout HEAD --"
# Collect everything that survived the cat-pass. These are typically
# files that were written locally just before eviction and never had
# a chance to sync to iCloud — their cloud copy is empty or missing.
STUCK=$(find . \( -path ./node_modules -o -path ./dist -o -path ./out -o -path './.claude/worktrees' -o -path ./.git \) -prune -o -type f -print0 2>/dev/null \
  | xargs -0 ls -lO 2>/dev/null \
  | grep dataless \
  | awk '{for (i=10;i<=NF;i++) printf "%s%s", $i, (i<NF?" ":"\0")}' || true)

if [ -z "$STUCK" ] ; then
  echo "  no stuck files — clean"
else
  STUCK_COUNT=$(printf '%s' "$STUCK" | tr -cd '\0' | wc -c | tr -d ' ')
  echo "  $STUCK_COUNT files still dataless after read-pass — trying git restore"
  printf '%s' "$STUCK" | while IFS= read -r -d '' f ; do
    git checkout HEAD -- "$f" 2>/dev/null && echo "    ✓ $f" || echo "    ✗ $f (not in HEAD)"
  done
fi
echo ""

# ── Step 6: final report ────────────────────────────────────
echo "Step 6: final state"
FINAL=$(find . -path ./node_modules -prune -o -path ./dist -prune -o -path ./out -prune -o -path './.claude/worktrees' -prune -o -path ./.git -prune -o -type f -print 2>/dev/null | xargs ls -lO 2>/dev/null | grep -c dataless || true)
echo "  $FINAL files still dataless in repo (excluding node_modules / dist / out / worktrees)"
if [ "$FINAL" = "0" ] ; then
  echo ""
  echo "✓ Recovery complete."
else
  echo ""
  echo "⚠ $FINAL files survived recovery. They're not in HEAD's tree AND iCloud"
  echo "  doesn't have a copy. Restore from Time Machine or accept the loss."
  echo "  bash scripts/check-materialization.sh"
  echo "  to see which files are affected."
fi
echo ""
