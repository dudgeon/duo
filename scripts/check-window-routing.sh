#!/usr/bin/env bash
# ENH-191 P2 (item 9) — the routing grep-gate.
#
# Fails on any NEW main->renderer send / executeJavaScript that bypasses the
# WindowRegistry seam, or any focus-based default resolution. The registry-of-
# one refactor (P2) drove the `mainWindow.webContents.send`/`executeJavaScript`
# baseline in electron/main.ts to ZERO — every send now routes through
# safeSend / resolveDefault / broadcastAll (electron/window-resolve.ts). This
# gate keeps it there: it's what makes the harness's routing guarantee durable
# against a future "consistency fix" that re-introduces a raw mainWindow send.
#
# NOT wired into CI (there is no CI in this repo). Run at a cut boundary, as a
# local pre-commit hook, or via `npm run check:routing`. `--selftest` proves
# the gate actually fires on a known violation (the negative-control fixture).
#
# Cardinal rule (spec §2.3): default sends resolve by IDENTITY (the registry),
# NEVER by focus. The ONE legitimate getFocusedWebContents (the "Copy as Plain
# Text" menu item) is allowlisted; getFocusedWindow is banned outright.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$ROOT/electron/main.ts"
FIXTURE="$ROOT/scripts/__fixtures__/routing-violation.ts.txt"

# Match ALL three token forms — mainWindow. / mainWindow?. / mainWindow!. —
# the last is the form the reqId dispatch sends used and the PRD's `\??` regex
# would have missed.
SEND_RE='mainWindow[?!]?\.webContents\.(send|executeJavaScript)'
DIALOG_RE='dialog\.show[A-Za-z]*\(\s*mainWindow'

if [ "${1:-}" = "--selftest" ]; then
  if grep -qE "$SEND_RE" "$FIXTURE" && grep -qE "$DIALOG_RE" "$FIXTURE"; then
    echo "check:routing selftest OK — gate regexes match the negative-control fixture"
    exit 0
  fi
  echo "check:routing selftest FAIL — gate did NOT match the fixture; the gate is broken"
  exit 1
fi

fail=0

send_count=$(grep -cE "$SEND_RE" "$MAIN" || true)
if [ "$send_count" -gt 0 ]; then
  echo "FAIL: $send_count mainWindow send/executeJavaScript site(s) in electron/main.ts"
  echo "      (baseline is 0 — route via safeSend / resolveDefault / broadcastAll):"
  grep -nE "$SEND_RE" "$MAIN" || true
  fail=1
fi

dialog_count=$(grep -cE "$DIALOG_RE" "$MAIN" || true)
if [ "$dialog_count" -gt 0 ]; then
  echo "FAIL: $dialog_count dialog.show*(mainWindow, ...) site(s) — use liveMainWindow():"
  grep -nE "$DIALOG_RE" "$MAIN" || true
  fail=1
fi

gfw_count=$(grep -cE 'getFocusedWindow' "$MAIN" || true)
if [ "$gfw_count" -gt 0 ]; then
  echo "FAIL: $gfw_count getFocusedWindow call(s) — default sends resolve by IDENTITY, never focus:"
  grep -nE 'getFocusedWindow' "$MAIN" || true
  fail=1
fi

# Exactly ONE getFocusedWebContents is allowlisted (Copy as Plain Text).
gfwc_count=$(grep -cE 'getFocusedWebContents' "$MAIN" || true)
if [ "$gfwc_count" -gt 1 ]; then
  echo "FAIL: $gfwc_count getFocusedWebContents call(s) — only the lone Copy-as-Plain-Text item is allowlisted:"
  grep -nE 'getFocusedWebContents' "$MAIN" || true
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "check:routing OK — mainWindow send/dialog baseline 0; getFocusedWebContents=$gfwc_count (<=1 allowlisted); getFocusedWindow=0"
fi
exit "$fail"
