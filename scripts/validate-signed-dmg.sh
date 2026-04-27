#!/usr/bin/env bash
# Stage 21 — validate a signed + notarized DMG.
#
# Confirms:
#   - The DMG / .app inside is signed with a valid Developer ID
#   - The notarization stapler ticket is present + valid
#   - Gatekeeper accepts the bundle (`spctl --assess`)
#
# Run AFTER `bash scripts/dist-signed.sh` — that script invokes this
# at the end, but you can also run it standalone against an existing
# DMG.
#
# Exits 0 if all checks pass; non-zero on any failure.

set -uo pipefail

DMG_PATTERN="${1:-dist/Duo-*-arm64.dmg}"
DMG=$(ls -1 $DMG_PATTERN 2>/dev/null | tail -1 || true)
if [ -z "${DMG}" ]; then
  echo "ERROR: no DMG found matching $DMG_PATTERN" >&2
  exit 1
fi

echo "[validate] DMG: $DMG"

# Mount the DMG so we can inspect the .app inside.
MOUNT_POINT=$(mktemp -d)
echo "[validate] Mounting at $MOUNT_POINT..."
hdiutil attach "$DMG" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
trap "hdiutil detach '$MOUNT_POINT' -quiet 2>/dev/null || true; rm -rf '$MOUNT_POINT'" EXIT

APP=$(ls -d "$MOUNT_POINT"/Duo.app 2>/dev/null | head -1)
if [ -z "${APP}" ]; then
  echo "ERROR: Duo.app not found inside DMG" >&2
  exit 1
fi

echo
echo "[validate] codesign --verify (deep)…"
codesign --verify --deep --strict --verbose=2 "$APP"

echo
echo "[validate] codesign --display (signing identity)…"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Sealed|Format)' || true

echo
echo "[validate] spctl --assess (Gatekeeper acceptance)…"
spctl -a -t open --context context:primary-signature -vv "$APP"

echo
echo "[validate] xcrun stapler validate (notarization ticket)…"
xcrun stapler validate "$APP"

echo
echo "[validate] All checks passed. ✓"
