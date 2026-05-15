#!/usr/bin/env bash
# ENH-160 — build a macOS Installer .pkg for a Duo distro pack (Path 1).
# (Renumbered from ENH-156 after collision with main's verb-split.)
#
# Produces a .pkg that bundles:
#   1. The canonical signed Duo.app (copied verbatim from /Applications/Duo.app
#      on this build machine; the inner code signature + notarization travel
#      intact inside the .pkg payload).
#   2. The distro pack folder.
#   3. A postinstall script that drops the pack into
#      $HOME/.claude/duo/extra-packs/<distro-name>/ for the installing user,
#      where Duo's install service discovers it on next launch.
#
# Usage (run from repo root):
#
#   bash scripts/build-pkg.sh --pack <pack-dir> [options]
#
# Options:
#   --pack <dir>            Path to the distro pack folder (required).
#   --output <pkg-path>     Output .pkg path.
#                           Default: dist/<pack-name>-<pack-version>-installer.pkg
#   --identifier <rdns>     Reverse-DNS package identifier.
#                           Default: com.duo.distro.<pack-name>.installer
#   --sign-identity <name>  Developer ID Installer cert common name.
#                           Omit for an unsigned .pkg (Gatekeeper warns at
#                           install; right-click → Open bypasses on a
#                           personal Mac; MDM-managed installs typically
#                           bypass anyway).
#   --duo-app <path>        Source Duo.app path. Default: /Applications/Duo.app.
#                           Useful for forks that ship a renamed bundle.
#   --help / -h             Show this message.
#
# Signing notes
# -------------
# The .pkg's own signature is independent of the inner Duo.app's signature.
# Without --sign-identity the resulting .pkg is unsigned; the Duo.app inside
# remains signed + notarized regardless (so once installed, Gatekeeper is
# happy with the .app every launch). Producing an unsigned .pkg is the
# normal path for shops that can't get a Developer ID Installer cert on
# the build machine.
#
# Requirements
# ------------
# - macOS (pkgbuild + productbuild + codesign are macOS-only).
# - jq (brew install jq) for reading plugin.json.
# - /Applications/Duo.app present (or pass --duo-app explicitly).
#
# Exit codes
# ----------
#   0   success
#   1   usage / argument error
#   2   missing dependency or missing input file
#   3   pkgbuild / productbuild / productsign failure (propagated)

set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "ERROR: build-pkg.sh runs on macOS only (uses pkgbuild + productbuild + codesign)." >&2
  exit 2
fi

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<USAGE
Usage: $SCRIPT_NAME --pack <pack-dir> [options]

Options:
  --pack <dir>             Path to the distro pack folder (required).
  --output <pkg-path>      Output .pkg path.
                           Default: dist/<pack-name>-<pack-version>-installer.pkg
  --identifier <rdns>      Package identifier (reverse-DNS).
                           Default: com.duo.distro.<pack-name>.installer
  --sign-identity <name>   Developer ID Installer cert common name.
                           Omit for an unsigned .pkg.
  --duo-app <path>         Source Duo.app path. Default: /Applications/Duo.app
  --help / -h              Show this message.

Examples:
  $SCRIPT_NAME --pack ~/Documents/my-team-pack/
  $SCRIPT_NAME --pack ./my-pack --output dist/special.pkg
  $SCRIPT_NAME --pack ./my-pack \\
      --sign-identity "Developer ID Installer: ACME Corp (TEAM123)"
USAGE
}

PACK_DIR=""
OUTPUT_PKG=""
IDENTIFIER=""
SIGN_IDENTITY=""
DUO_APP="/Applications/Duo.app"

while [ $# -gt 0 ]; do
  case "$1" in
    --pack)           PACK_DIR="${2:-}"; shift 2 ;;
    --output)         OUTPUT_PKG="${2:-}"; shift 2 ;;
    --identifier)     IDENTIFIER="${2:-}"; shift 2 ;;
    --sign-identity)  SIGN_IDENTITY="${2:-}"; shift 2 ;;
    --duo-app)        DUO_APP="${2:-}"; shift 2 ;;
    --help|-h)        usage; exit 0 ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [ -z "$PACK_DIR" ]; then
  echo "ERROR: --pack <pack-dir> is required." >&2
  usage
  exit 1
fi

if [ ! -d "$PACK_DIR" ]; then
  echo "ERROR: pack dir not found: $PACK_DIR" >&2
  exit 2
fi
PACK_DIR="$(cd "$PACK_DIR" && pwd)"

PLUGIN_JSON="$PACK_DIR/.claude-plugin/plugin.json"
if [ ! -f "$PLUGIN_JSON" ]; then
  echo "ERROR: $PLUGIN_JSON not found. Is this a Duo distro pack?" >&2
  echo "  Expected layout: <pack-dir>/.claude-plugin/plugin.json" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required. brew install jq" >&2
  exit 2
fi

PACK_NAME=$(jq -r '.name' "$PLUGIN_JSON")
PACK_VERSION=$(jq -r '.version' "$PLUGIN_JSON")

if [ -z "$PACK_NAME" ] || [ "$PACK_NAME" = "null" ]; then
  echo "ERROR: plugin.json § name missing or null." >&2
  exit 2
fi
if [ -z "$PACK_VERSION" ] || [ "$PACK_VERSION" = "null" ]; then
  echo "ERROR: plugin.json § version missing or null." >&2
  exit 2
fi

# Defense-in-depth: pack name is interpolated into the postinstall's `rm -rf`
# target path. Restrict to lowercase alphanumeric + hyphen (the pack-naming
# convention already enforced elsewhere) so a malformed name can't break out
# into adjacent dirs.
if ! [[ "$PACK_NAME" =~ ^[a-z0-9-]+$ ]]; then
  echo "ERROR: pack name '$PACK_NAME' must match [a-z0-9-]+ (lowercase alphanumeric + hyphen)." >&2
  exit 2
fi

if [ ! -d "$DUO_APP" ]; then
  echo "ERROR: $DUO_APP not found." >&2
  echo "  build-pkg bundles whatever Duo.app is currently installed at the path" >&2
  echo "  given by --duo-app (default: /Applications/Duo.app). Install the" >&2
  echo "  canonical signed Duo DMG first, or pass --duo-app <path>." >&2
  exit 2
fi

for cmd in pkgbuild productbuild codesign; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: $cmd not found. build-pkg requires macOS." >&2
    exit 2
  fi
done

if [ -z "$OUTPUT_PKG" ]; then
  OUTPUT_PKG="$REPO_ROOT/dist/${PACK_NAME}-${PACK_VERSION}-installer.pkg"
fi
if [ -z "$IDENTIFIER" ]; then
  IDENTIFIER="com.duo.distro.${PACK_NAME}.installer"
fi

mkdir -p "$(dirname "$OUTPUT_PKG")"

DUO_APP_VERSION=$(defaults read "$DUO_APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "unknown")

echo "[build-pkg] Pack name:       $PACK_NAME"
echo "[build-pkg] Pack version:    $PACK_VERSION"
echo "[build-pkg] Identifier:      $IDENTIFIER"
echo "[build-pkg] Duo.app source:  $DUO_APP (version $DUO_APP_VERSION)"
echo "[build-pkg] Output:          $OUTPUT_PKG"
if [ -n "$SIGN_IDENTITY" ]; then
  echo "[build-pkg] Signing:         $SIGN_IDENTITY"
else
  echo "[build-pkg] Signing:         (unsigned)"
fi
echo

STAGING_ROOT="$(mktemp -d -t duo-build-pkg)"
trap 'rm -rf "$STAGING_ROOT"' EXIT

PAYLOAD_ROOT="$STAGING_ROOT/payload"
SCRIPTS_DIR="$STAGING_ROOT/scripts"

# Payload tree: every file under PAYLOAD_ROOT will land at its corresponding
# absolute path on the target system, because we pass --install-location "/"
# to pkgbuild.
#
# 1. Duo.app → /Applications/Duo.app
#    ditto preserves resource forks, xattrs, and the code signature.
mkdir -p "$PAYLOAD_ROOT/Applications"
echo "[build-pkg] Staging Duo.app (ditto preserves signature)..."
ditto "$DUO_APP" "$PAYLOAD_ROOT/Applications/Duo.app"

# Sanity check: confirm the staged copy still verifies. If ditto dropped a
# metadata bit, fail loudly here rather than silently shipping a broken pkg.
echo "[build-pkg] Verifying staged Duo.app signature..."
if codesign --verify --deep --strict "$PAYLOAD_ROOT/Applications/Duo.app" 2>/dev/null; then
  echo "[build-pkg]   ✓ signature intact in staging"
else
  echo "[build-pkg]   ⚠ signature did not verify in staging." >&2
  echo "[build-pkg]     Possible causes:" >&2
  echo "[build-pkg]       - Source Duo.app at $DUO_APP is itself unsigned (dev build)." >&2
  echo "[build-pkg]       - ditto failed to preserve metadata (rare)." >&2
  echo "[build-pkg]     Continuing build, but verify the produced .pkg before distributing." >&2
fi

# 2. Pack content → /private/var/tmp/duo-pack-staging/<pack-name>/
#    Postinstall moves it from here into the installing user's home.
#    /private/var/tmp/ is world-readable (mode 1777) — the staging directory
#    is intentionally public during the brief install window. Distro packs
#    must not contain secrets; pack content is assumed to be cohort-public
#    material (skills, agents, canvases, CLAUDE.md guidance).
STAGE_PARENT="$PAYLOAD_ROOT/private/var/tmp/duo-pack-staging"
mkdir -p "$STAGE_PARENT"
echo "[build-pkg] Staging pack content..."
ditto "$PACK_DIR" "$STAGE_PARENT/$PACK_NAME"

# 3. Postinstall script. Uses a quoted heredoc so $-refs stay literal until
#    install-time; pack-name is substituted via sed afterwards.
mkdir -p "$SCRIPTS_DIR"
cat > "$SCRIPTS_DIR/postinstall" <<'POSTINSTALL'
#!/bin/bash
# Postinstall for the Duo distro pack.
# Relocates the staged pack into the installing user's
# ~/.claude/duo/extra-packs/<pack-name>/ directory. Duo's install
# service picks up the pack on next launch.
set -euo pipefail

PACK_NAME="__PACK_NAME__"
STAGE="/private/var/tmp/duo-pack-staging/$PACK_NAME"

if [ ! -d "$STAGE" ]; then
  echo "ERROR: staged pack not found at $STAGE" >&2
  exit 1
fi

# Identify the user who initiated the install. macOS Installer runs
# postinstall as root; the console user (whoever is logged in at the
# GUI) is the right placement target.
CONSOLE_USER=$(stat -f "%Su" /dev/console 2>/dev/null || true)
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  CONSOLE_USER="${USER:-$(logname 2>/dev/null || true)}"
fi
if [ -z "$CONSOLE_USER" ] || [ "$CONSOLE_USER" = "root" ]; then
  echo "ERROR: cannot determine the installing user; pack placement aborted." >&2
  echo "  Manually copy $STAGE to ~/.claude/duo/extra-packs/$PACK_NAME/" >&2
  echo "  as the target user." >&2
  exit 1
fi

USER_HOME=$(dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')
if [ -z "$USER_HOME" ] || [ ! -d "$USER_HOME" ]; then
  echo "ERROR: cannot resolve home directory for $CONSOLE_USER" >&2
  exit 1
fi

DEST="$USER_HOME/.claude/duo/extra-packs/$PACK_NAME"
DEST_PARENT="$(dirname "$DEST")"

sudo -u "$CONSOLE_USER" mkdir -p "$DEST_PARENT"

# Atomic-replace: clear any prior install of the same pack name. Duo's
# install service does its own atomic-replace on the next launch's
# detection of a name+version change, but clearing here keeps the
# extra-packs/ surface clean.
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
fi

cp -R "$STAGE" "$DEST"
chown -R "$CONSOLE_USER:staff" "$DEST"

rm -rf "$STAGE"
rmdir /private/var/tmp/duo-pack-staging 2>/dev/null || true

echo "[$PACK_NAME] installed to $DEST"
echo "[$PACK_NAME] Duo will discover the pack on next launch."

exit 0
POSTINSTALL

# Substitute the pack name into the postinstall (build-time bake).
sed -i.bak "s/__PACK_NAME__/$PACK_NAME/g" "$SCRIPTS_DIR/postinstall"
rm "$SCRIPTS_DIR/postinstall.bak"
chmod +x "$SCRIPTS_DIR/postinstall"

# Component pkg (raw payload + scripts).
COMPONENT_PKG="$STAGING_ROOT/component.pkg"
echo "[build-pkg] Running pkgbuild..."
pkgbuild \
  --root "$PAYLOAD_ROOT" \
  --scripts "$SCRIPTS_DIR" \
  --identifier "$IDENTIFIER" \
  --version "$PACK_VERSION" \
  --install-location "/" \
  "$COMPONENT_PKG"

# Distribution pkg (productbuild wraps for a friendlier installer UI and is
# required as the input shape for productsign).
DIST_PKG="$STAGING_ROOT/distribution.pkg"
echo "[build-pkg] Running productbuild..."
productbuild \
  --package "$COMPONENT_PKG" \
  "$DIST_PKG"

if [ -n "$SIGN_IDENTITY" ]; then
  echo "[build-pkg] Signing with $SIGN_IDENTITY..."
  productsign --sign "$SIGN_IDENTITY" "$DIST_PKG" "$OUTPUT_PKG"
else
  cp "$DIST_PKG" "$OUTPUT_PKG"
fi

PKG_SIZE=$(du -sh "$OUTPUT_PKG" | awk '{print $1}')
echo
echo "[build-pkg] Done."
echo "[build-pkg]   Output: $OUTPUT_PKG ($PKG_SIZE)"
if [ -z "$SIGN_IDENTITY" ]; then
  echo
  echo "[build-pkg] Note: unsigned .pkg."
  echo "  - End users may need to right-click → Open the first time to bypass Gatekeeper."
  echo "  - MDM-managed installs (Jamf / Munki / Kandji) typically bypass Gatekeeper anyway."
  echo "  - The inner Duo.app remains signed + notarized; Gatekeeper is satisfied at app launch."
fi
