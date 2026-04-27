#!/usr/bin/env bash
# Stage 21 — signed + notarized DMG cut.
#
# Sources the cert env vars from ~/Documents/duo-private/.env and runs
# `npm run dist`. electron-builder picks up CSC_NAME / APPLE_API_KEY /
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

if [ -z "${APPLE_API_KEY:-}" ] || [ -z "${APPLE_API_KEY_ID:-}" ] || [ -z "${APPLE_API_ISSUER:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "WARNING: notarization env vars incomplete; signing only (no notarize)." >&2
fi

echo "[duo] Signing identity: $CSC_NAME"
echo "[duo] Running npm run dist..."

# DO NOT pass CSC_IDENTITY_AUTO_DISCOVERY=false here — we WANT
# electron-builder to discover the identity from CSC_NAME / keychain.
npm run dist

echo
echo "[duo] DMG output:"
ls -lh dist/Duo-*.dmg

echo
echo "[duo] Validating signature + notarization..."
bash "$(dirname "$0")/validate-signed-dmg.sh"
