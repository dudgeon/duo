#!/bin/bash
# Duo Phase 0 — Native Messaging registry installer (macOS).
#
# Usage: ./install.sh <extension-id>
#
# extension-id is the Chrome ID shown on chrome://extensions/ after
# loading phase0/extension/ as an unpacked extension. Looks like
# "abcdefghijklmnopqrstuvwxyzabcdef" (32 lowercase letters).

set -e

if [ $# -lt 1 ]; then
  echo "usage: $0 <extension-id>"
  echo
  echo "Get the extension-id by:"
  echo "  1. open chrome://extensions/"
  echo "  2. flip 'Developer mode' on"
  echo "  3. 'Load unpacked' → select phase0/extension/"
  echo "  4. copy the ID shown under the extension card"
  exit 1
fi

EXTENSION_ID="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_PATH="$SCRIPT_DIR/duo-helper.js"
NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
NM_PATH="$NM_DIR/com.duo.phase0.json"

mkdir -p "$NM_DIR"
chmod +x "$HELPER_PATH"

cat > "$NM_PATH" <<EOF
{
  "name": "com.duo.phase0",
  "description": "Duo Phase 0 — keep-alive probe helper",
  "path": "$HELPER_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "✓ Native Messaging manifest installed"
echo "  manifest: $NM_PATH"
echo "  helper:   $HELPER_PATH"
echo "  origin:   chrome-extension://$EXTENSION_ID/"
echo
echo "Next:"
echo "  1. open the extension popup, click 'Send ping to helper'"
echo "  2. expected: ✓ pong in &lt;10ms"
echo "  3. tail the helper log to watch keep-alive ticks:"
echo "     tail -f \"\$HOME/.claude/duo/phase0-helper.log\""
echo
echo "To uninstall: rm \"$NM_PATH\""
