#!/usr/bin/env bash
# Stage 21 — signed + notarized DMG cut.
#
# Sources the cert env vars from ~/Documents/duo-private/.env and runs
# electron-builder. electron-builder picks up CSC_NAME / APPLE_API_KEY /
# APPLE_API_KEY_ID / APPLE_API_ISSUER / APPLE_TEAM_ID from the env and
# signs + notarizes the DMG.
#
# Usage (run from repo root):
#
#   bash scripts/dist-signed.sh
#
# Then validate:
#
#   bash scripts/validate-signed-dmg.sh
#
# === Why this script builds outside the repo's dist/ ============================
#
# If the repo lives under ~/Documents/ (the macOS default for users with iCloud
# Desktop & Documents sync), the iCloud File Provider tags directories inside the
# packaged .app with `com.apple.FinderInfo` and `com.apple.fileprovider.fpfs#P`
# extended attributes within milliseconds of creation. codesign then rejects
# helper bundles like `Duo Helper (GPU).app` with:
#
#   resource fork, Finder information, or similar detritus not allowed
#
# `xattr -cr` and `ditto --noextattr` strip the attrs but iCloud re-applies
# them faster than the next codesign call can read the file. The stable fix is
# to build OUTSIDE any iCloud-touched filesystem entirely. We point
# electron-builder at $DUO_BUILD_OUTPUT (default: $HOME/.cache/duo-build) and
# copy the resulting DMGs back to the repo's dist/ at the end so users still
# find their artifacts in the expected place.
#
# This is independent of `com.apple.provenance` (which is harmless on its own
# and present everywhere on Sequoia, including /tmp/).
#
# ================================================================================
#
# WARNING — keychain prompt: on first signing after a system reboot,
# macOS may prompt "codesign wants to access key … allow?" Click
# "Always Allow." If you miss this prompt, the build hangs forever.
# This is the FOLLOWUP-005 gotcha from v0.2.0; happens once per
# session.
#
# To skip signing (today's default behavior — unsigned DMG):
#
#   CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$HOME/Documents/duo-private/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found." >&2
  echo "  Run the cert pre-work first (see docs/dev/cert-procurement.md)." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

if [ -z "${CSC_NAME:-}" ]; then
  echo "ERROR: CSC_NAME unset after sourcing $ENV_FILE." >&2
  echo "  Check that the .env file has the cert common name set." >&2
  exit 1
fi

# electron-builder gotcha — it explicitly rejects CSC_NAME with the
# "Developer ID Application: " prefix even though that's the canonical
# common name string macOS keychain stores. The expected format is
# just the rest ("Geoffrey Dudgeon (TEAMID)"). Strip the prefix +
# any surrounding quotes so the .env file can use either shape.
CSC_NAME="${CSC_NAME#\"}"     # leading "
CSC_NAME="${CSC_NAME%\"}"     # trailing "
CSC_NAME="${CSC_NAME#Developer ID Application: }"
export CSC_NAME

if [ -z "${APPLE_API_KEY:-}" ] || [ -z "${APPLE_API_KEY_ID:-}" ] || [ -z "${APPLE_API_ISSUER:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "WARNING: notarization env vars incomplete; signing only (no notarize)." >&2
fi

# Build OUTSIDE the repo's dist/ to avoid iCloud File Provider xattrs (see
# header). Override is repo-root-agnostic: any caller can set
# $DUO_BUILD_OUTPUT to point elsewhere.
BUILD_DIR="${DUO_BUILD_OUTPUT:-$HOME/.cache/duo-build}"

echo "[duo] Signing identity: $CSC_NAME"
echo "[duo] Build output:     $BUILD_DIR"
echo "[duo] Repo root:        $REPO_ROOT"
echo

echo "[duo] Cleaning $BUILD_DIR..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

echo "[duo] Building app + CLI (npm run build:all)..."
npm run build:all

echo
echo "[duo] Running electron-builder with directories.output=$BUILD_DIR..."
# DO NOT pass CSC_IDENTITY_AUTO_DISCOVERY=false here — we WANT
# electron-builder to discover the identity from CSC_NAME / keychain.
node_modules/.bin/electron-builder -c.directories.output="$BUILD_DIR"

echo
echo "[duo] Copying DMGs from $BUILD_DIR to dist/..."
mkdir -p dist
DMG_COUNT=0
for dmg in "$BUILD_DIR"/Duo-*.dmg "$BUILD_DIR"/Duo-*.dmg.blockmap; do
  if [ -f "$dmg" ]; then
    cp "$dmg" dist/
    DMG_COUNT=$((DMG_COUNT + 1))
  fi
done
if [ "$DMG_COUNT" -eq 0 ]; then
  echo "ERROR: no DMG files found in $BUILD_DIR." >&2
  ls -la "$BUILD_DIR" >&2
  exit 1
fi

echo
echo "[duo] DMG output (in repo's dist/):"
ls -lh dist/Duo-*.dmg

echo
echo "[duo] Validating signature + notarization..."
bash "$REPO_ROOT/scripts/validate-signed-dmg.sh"
