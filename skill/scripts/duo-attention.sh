#!/bin/sh
# duo-managed attention hook (ENH-225 — the "waiting on you" tab badge).
#
# Installed by Duo's installer to ~/.claude/duo/hooks/duo-attention.sh and
# registered in ~/.claude/settings.json for three Claude Code hook events:
#   Stop, Notification        → `duo-attention.sh set`   (session idle / prompting)
#   UserPromptSubmit          → `duo-attention.sh clear`  (user acted)
#
# It flips THIS tab's badge by posting to Duo's socket via the duo CLI, keyed on
# $DUO_TAB (the owning tab id, stamped on every Duo PTY by the PtyManager). It is
# a no-op outside Duo, with no tab, or if the duo CLI can't be found — and it
# NEVER fails the hook (always exits 0) so a missing/old CLI can't break a
# session. The badge also clears when the user focuses the tab (renderer-side),
# so this is best-effort signalling, not load-bearing.

# Only act inside a Duo PTY that knows its tab id.
[ -n "$DUO_SESSION" ] && [ -n "$DUO_TAB" ] || exit 0

STATE="$1"
[ "$STATE" = "set" ] || [ "$STATE" = "clear" ] || exit 0

# Resolve the duo CLI: PATH first (external Terminal/iTerm), then the install
# destination (~/.local/bin/duo) — GUI-launched apps often have a minimal PATH.
DUO_BIN="$(command -v duo 2>/dev/null)"
[ -n "$DUO_BIN" ] || DUO_BIN="$HOME/.local/bin/duo"
[ -x "$DUO_BIN" ] || exit 0

"$DUO_BIN" attention --tab "$DUO_TAB" --state "$STATE" >/dev/null 2>&1 || true
exit 0
