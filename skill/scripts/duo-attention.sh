#!/bin/sh
# duo-managed turn-boundary hook (ENH-225 attention badge + ENH-231 catch-up
# digest). Registered in ~/.claude/settings.json for three Claude Code events
# — UNCHANGED entries (the digest piggybacks the existing arms, so a version
# bump never duplicates a Stop hook):
#   Stop, Notification        → `duo-attention.sh set`    (session idle / prompting)
#   UserPromptSubmit          → `duo-attention.sh clear`   (user acted)
#
# Each arm does two things, both keyed on $DUO_TAB (the owning tab id, stamped
# on every Duo PTY by the PtyManager) and each guarded so neither can fail the
# hook:
#   1. flips THIS tab's "waiting on you" badge via `duo attention` (ENH-225);
#   2. materializes this session's catch-up digest via `duo session digest`
#      (ENH-231) — the "no inference at open" pre-hydration. `set` (Stop /
#      Notification, the rest-points) writes the FULL digest; `clear`
#      (UserPromptSubmit) refreshes only "You asked" (`--you-asked-only`),
#      since the new turn just started.
# `digest` is also accepted as a standalone arg (digest only, no badge) for
# manual/test invocation. The digest call is bounded by the duo CLI's own
# socket timeout, so it can never hang the hook.
#
# A no-op outside Duo, with no tab, or if the duo CLI can't be found — and it
# NEVER fails the hook (always exits 0) so a missing/old CLI can't break a
# session. The badge also clears when the user focuses the tab (renderer-side),
# so this is best-effort signalling, not load-bearing.

# Only act inside a Duo PTY that knows its tab id.
[ -n "$DUO_SESSION" ] && [ -n "$DUO_TAB" ] || exit 0

STATE="$1"
case "$STATE" in
  set | clear | digest) ;;
  *) exit 0 ;;
esac

# Resolve the duo CLI: PATH first (external Terminal/iTerm), then the install
# destination (~/.local/bin/duo) — GUI-launched apps often have a minimal PATH.
DUO_BIN="$(command -v duo 2>/dev/null)"
[ -n "$DUO_BIN" ] || DUO_BIN="$HOME/.local/bin/duo"
[ -x "$DUO_BIN" ] || exit 0

# ENH-231 — materialize the catch-up digest. Always `|| true`-guarded so a hung
# or missing-verb digest can never abort the badge (the next Stop corrects any
# staleness). $@ lets `clear` pass `--you-asked-only`.
fire_digest() {
  "$DUO_BIN" session digest "$DUO_TAB" "$@" >/dev/null 2>&1 || true
}

case "$STATE" in
  set)
    "$DUO_BIN" attention --tab "$DUO_TAB" --state set >/dev/null 2>&1 || true
    fire_digest
    ;;
  clear)
    "$DUO_BIN" attention --tab "$DUO_TAB" --state clear >/dev/null 2>&1 || true
    fire_digest --you-asked-only
    ;;
  digest)
    fire_digest
    ;;
esac
exit 0
