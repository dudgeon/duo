#!/usr/bin/env bash
#
# duo-hook-probe.sh — Does Claude Code run hooks on THIS machine?
# ----------------------------------------------------------------
# A self-contained diagnostic for corporate / managed installs. It tells you
# whether a SessionStart hook (and a couple of others) actually fires, or
# whether enterprise policy has silenced them. No repo clone, no dependencies
# beyond bash + the `claude` CLI. It NEVER touches your real ~/.claude config —
# everything lives in an isolated throwaway folder you can delete.
#
# Why this matters: Duo wants to auto-open a project's "start here" page when
# you enter the folder. The cleanest way to do that depends on whether hooks
# are available here. This probe gives a yes/no answer from evidence.
#
# Usage:
#   ./duo-hook-probe.sh setup     # build the isolated test project + inspect policy
#   # ...then follow the printed instructions (launch `claude` in the test dir)...
#   ./duo-hook-probe.sh check     # read the results and print a verdict
#   ./duo-hook-probe.sh clean     # delete the test folder
#   ./duo-hook-probe.sh inspect   # read-only policy inspection only (no setup)
#
# Safe by design: writes only under ~/duo-hook-probe/. Reads (never writes)
# the managed-settings policy file. Removing the folder undoes everything.

set -u

PROBE_DIR="$HOME/duo-hook-probe"
RESULTS_DIR="$PROBE_DIR/results"
LOG="$RESULTS_DIR/hook-events.log"
SENTINEL="DUO_HOOK_PROBE_SENTINEL_8f3a2c"

# Managed-settings policy file (the only place disableAllHooks is effective).
case "$(uname -s)" in
  Darwin) MANAGED="/Library/Application Support/ClaudeCode/managed-settings.json" ;;
  *)      MANAGED="/etc/claude-code/managed-settings.json" ;;
esac

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
yel()   { printf '\033[33m%s\033[0m\n' "$*"; }
rule()  { printf '%s\n' "------------------------------------------------------------"; }

# ---------------------------------------------------------------------------
# Read-only inspection of policy + existing Duo config. Writes nothing.
# ---------------------------------------------------------------------------
inspect() {
  bold "POLICY INSPECTION (read-only)"
  rule

  printf 'claude CLI:        '
  if command -v claude >/dev/null 2>&1; then
    green "$(command -v claude)  ($(claude --version 2>/dev/null || echo 'version unknown'))"
  else
    red "NOT on PATH — open this terminal from inside Duo, or add claude to PATH."
  fi

  printf 'managed-settings:  '
  if [ -r "$MANAGED" ]; then
    yel "$MANAGED (exists, readable)"
    if grep -Eq '"disableAllHooks"[[:space:]]*:[[:space:]]*true' "$MANAGED" 2>/dev/null; then
      red   '   -> disableAllHooks: true  ==> ALL non-managed hooks are silenced by policy.'
    elif grep -Eq '"allowManagedHooksOnly"[[:space:]]*:[[:space:]]*true' "$MANAGED" 2>/dev/null; then
      red   '   -> allowManagedHooksOnly: true  ==> only admin-managed hooks run; yours are blocked.'
    else
      green '   -> no disableAllHooks / allowManagedHooksOnly key found (hooks likely permitted).'
    fi
    if grep -Eq '"permissions"' "$MANAGED" 2>/dev/null; then
      yel  '   -> a "permissions" block exists; a Bash deny-rule could still block hook commands.'
    fi
  elif [ -e "$MANAGED" ]; then
    yel "$MANAGED (exists but not readable by you)"
  else
    green "none at $MANAGED (no machine-wide hook policy at the usual path)."
  fi

  printf 'user settings:     '
  if [ -f "$HOME/.claude/settings.json" ]; then
    yel "$HOME/.claude/settings.json (exists)"
    if grep -q '"SessionStart"' "$HOME/.claude/settings.json" 2>/dev/null; then
      printf '   -> already defines a SessionStart hook'
      grep -q '"_duo"' "$HOME/.claude/settings.json" 2>/dev/null && printf ' (Duo-managed entry present)'
      printf '\n'
    fi
  else
    green "no $HOME/.claude/settings.json yet."
  fi

  printf 'writable ~/.claude:'
  if [ -d "$HOME/.claude" ] && [ -w "$HOME/.claude" ]; then
    green " yes"
  elif [ ! -e "$HOME/.claude" ]; then
    yel " ~/.claude does not exist yet (created on first claude run)"
  else
    red " NO — Duo's installer can't write skill/agent/hook files here."
  fi
  rule
}

# ---------------------------------------------------------------------------
# Build the isolated test project with a project-scoped .claude/settings.json.
# Project scope is representative: disableAllHooks / allowManagedHooksOnly kill
# non-managed hooks at EVERY scope, so if project hooks fire, user hooks would
# too — and we never risk your real ~/.claude/settings.json.
# ---------------------------------------------------------------------------
setup() {
  rm -rf "$PROBE_DIR"
  mkdir -p "$RESULTS_DIR" "$PROBE_DIR/.claude"

  # Helper the hooks call. Records that an event fired + dumps the event JSON.
  cat > "$PROBE_DIR/record.sh" <<EOF
#!/usr/bin/env bash
EVENT="\$1"
DIR="$RESULTS_DIR"
mkdir -p "\$DIR"
STDIN="\$(cat 2>/dev/null)"
printf '%s\t%s\n' "\$(date '+%Y-%m-%dT%H:%M:%S')" "\$EVENT" >> "$LOG"
printf '%s\n' "\$STDIN" > "\$DIR/\$EVENT.last.json"
# SessionStart stdout is injected into Claude's context — emit a sentinel so we
# can also confirm the *context-injection* path (the one a real feature needs).
if [ "\$EVENT" = "SessionStart" ]; then
  echo "$SENTINEL — if you can read this line, reply with the exact token $SENTINEL."
fi
exit 0
EOF
  chmod +x "$PROBE_DIR/record.sh"

  cat > "$PROBE_DIR/.claude/settings.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "$PROBE_DIR/record.sh SessionStart" } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "$PROBE_DIR/record.sh UserPromptSubmit" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "$PROBE_DIR/record.sh PreToolUse" } ] }
    ]
  }
}
EOF

  : > "$LOG"

  inspect
  echo
  bold "TEST PROJECT READY"
  rule
  echo "An isolated test project was created at:"
  echo "    $PROBE_DIR"
  echo
  bold "Now do this, in order:"
  echo "  1. Open a NEW terminal and change into the test folder:"
  echo "         cd \"$PROBE_DIR\""
  echo "  2. Launch Claude Code there:"
  echo "         claude"
  echo "     - If asked to TRUST the folder, accept it."
  echo "     - If asked to REVIEW / APPROVE hooks, approve them."
  echo "       (Being unable to approve is itself a finding — note it.)"
  echo "  3. SessionStart fires on launch. To also exercise the other two hooks,"
  echo "     type this prompt and let Claude run it:"
  echo "         Run this bash command for me: echo probe-ok"
  echo "  4. (Context-injection check) ask Claude:"
  echo "         Did you receive a token starting with DUO_HOOK_PROBE? If so, repeat it."
  echo "     If Claude echoes $SENTINEL, SessionStart context-injection works."
  echo "  5. Exit Claude, return to THIS terminal, and run:"
  echo "         ./duo-hook-probe.sh check"
  rule
}

# ---------------------------------------------------------------------------
# Read results and print a verdict + what it implies for the feature.
# ---------------------------------------------------------------------------
check() {
  if [ ! -f "$LOG" ]; then
    red "No results found. Run './duo-hook-probe.sh setup' first, then launch claude in $PROBE_DIR."
    exit 1
  fi

  bold "HOOK PROBE RESULTS"
  rule
  fired() { grep -q "	$1$" "$LOG" 2>/dev/null; }

  for e in SessionStart UserPromptSubmit PreToolUse; do
    if fired "$e"; then
      green "  [FIRED]   $e"
    else
      red   "  [silent]  $e"
    fi
  done
  echo
  echo "Raw event log ($LOG):"
  sed 's/^/    /' "$LOG" 2>/dev/null || true
  rule

  echo
  bold "VERDICT"
  rule
  if fired SessionStart; then
    green "SessionStart hooks FIRE on this machine."
    echo  "  -> A SessionStart hook is a viable, low-complexity home for the"
    echo  "     duo-project detect + auto-open. We can keep this simple."
    echo  "  -> Confirm the context-injection check (step 4) too: if Claude echoed"
    echo  "     $SENTINEL, the hook can also hand Claude instructions, not just run a command."
  else
    red  "SessionStart hooks DID NOT fire."
    echo "  -> Likely cause: disableAllHooks / allowManagedHooksOnly in the managed"
    echo "     policy file, a Bash permission deny-rule, or an un-approvable hook prompt."
    echo "     (Re-read the POLICY INSPECTION above for which.)"
    echo "  -> Implication: don't rely on Claude Code hooks for the feature. Use a"
    echo "     Duo-native trigger (Duo's own terminal-spawn opens the file) or the"
    echo "     PATH-shim wrapper — both are hook-free and immune to this policy."
  fi
  rule
  echo "When done: ./duo-hook-probe.sh clean   (removes $PROBE_DIR)"
}

clean() {
  rm -rf "$PROBE_DIR"
  green "Removed $PROBE_DIR"
}

case "${1:-}" in
  setup)   setup ;;
  check)   check ;;
  inspect) inspect ;;
  clean)   clean ;;
  *)
    bold "duo-hook-probe.sh — does Claude Code run hooks on this machine?"
    echo
    echo "  ./duo-hook-probe.sh setup     build isolated test + inspect policy, then follow steps"
    echo "  ./duo-hook-probe.sh check     read results, print verdict"
    echo "  ./duo-hook-probe.sh inspect   read-only policy inspection (no files written)"
    echo "  ./duo-hook-probe.sh clean     delete the test folder"
    ;;
esac
