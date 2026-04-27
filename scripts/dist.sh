#!/usr/bin/env bash
# Stage 21e-i — fork-aware build wrapper.
#
# Sources `fork.config.{json,default.json}` via `scripts/load-fork-config.cjs`
# so `electron-builder.yml`'s ${env.DUO_*} interpolations resolve, then
# runs `npm run build:all && electron-builder $@`.
#
# Usage:
#   bash scripts/dist.sh                    # full build (DMG)
#   bash scripts/dist.sh --dir              # pack only (no DMG; faster)
#   bash scripts/dist.sh -c.directories.output=/tmp/foo   # any electron-builder flag
#
# The signed-cut variant `scripts/dist-signed.sh` wraps THIS script so the
# fork-config sourcing happens once at the outermost level.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Source fork config — sets DUO_APP_ID, DUO_PRODUCT_NAME, DUO_PUBLISH_OWNER,
# etc. We use `eval "$(...)"` rather than `source <(...)` because the
# process-substitution form runs in a subshell and exports don't
# propagate back to the parent under some bash versions (3.2 on macOS).
# eval is the boring-and-works path.
eval "$(node "$REPO_ROOT/scripts/load-fork-config.cjs" --shell-export)"

echo "[dist.sh] Fork identity: $DUO_APP_ID ($DUO_PUBLISH_OWNER/$DUO_PUBLISH_REPO)"

# Stage 1 — TS bundle + CLI compile. Independent of electron-builder.
echo "[dist.sh] Building app + CLI..."
npm run build:all

# Stage 2 — electron-builder with fork-identity injected via CLI overrides.
# Yml doesn't include appId/productName/copyright/publish — those come
# from the fork config we just sourced (see header). Any caller-passed
# args get forwarded after our overrides so caller can additionally
# override anything (e.g. -c.directories.output=...).
echo "[dist.sh] Running electron-builder $*"
node_modules/.bin/electron-builder \
  -c.appId="$DUO_APP_ID" \
  -c.productName="$DUO_PRODUCT_NAME" \
  -c.copyright="$DUO_COPYRIGHT" \
  -c.publish.provider="$DUO_PUBLISH_PROVIDER" \
  -c.publish.owner="$DUO_PUBLISH_OWNER" \
  -c.publish.repo="$DUO_PUBLISH_REPO" \
  -c.publish.releaseType=release \
  "$@"
