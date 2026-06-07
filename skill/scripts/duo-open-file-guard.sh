#!/bin/sh
# duo-open-file-guard — PreToolUse nudge (warn-only).
#
# What it does: when Edit/Write/MultiEdit targets a file that's currently
# open in Duo (markdown / HTML / JSON-family), it prints a one-paragraph
# stderr nudge toward the matching `duo` verb (duo doc / duo html / duo
# json) so the edit goes through the live surface instead of around it —
# direct filesystem writes can be silently clobbered by the editor's
# autosave and skip the change-highlight a `duo` verb paints.
#
# WARN-ONLY / NON-BLOCKING: this hook NEVER blocks a tool call. It exits 0
# on every path — success, miss, or any error — and only ever writes to
# stderr. The nudge is advisory; the original Edit/Write/MultiEdit always
# proceeds.
#
# DUO_SESSION-gated: does nothing outside a Duo PTY (no DUO_SESSION env).
# Fail-open: every branch (bad JSON on stdin, no file_path, `duo status`
# missing / erroring / slow, malformed status) exits 0 silently. Uses only
# sh builtins + node (guaranteed) + the duo CLI — no jq, no bash-isms.
#
# Safe to delete: Duo re-installs this hook on its next launch. Removing it
# (or the duo-managed block from ~/.claude/settings.json) just turns the
# nudge off.

# 1. Outside Duo → nothing to guard against.
[ -n "$DUO_SESSION" ] || exit 0

# 2. Read the PreToolUse event JSON from stdin, then pull tool_input.file_path
#    out of it with a tiny node reader (node is guaranteed on the PATH a Duo
#    PTY sees; jq is not). Any parse failure yields an empty TARGET.
EVENT=$(cat)
TARGET=$(printf '%s' "$EVENT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=JSON.parse(s);process.stdout.write((e.tool_input&&e.tool_input.file_path)||"")}catch(_){}})' 2>/dev/null)

# 3. No file_path (e.g. a non-file tool, or unparseable event) → nothing to do.
[ -n "$TARGET" ] || exit 0

# 4. Only nudge for the surfaces a `duo` verb can drive. Everything else
#    (source code, binaries, etc.) → stay silent; Edit/Write are correct there.
case "$TARGET" in
  *.md|*.markdown|*.html|*.htm|*.json|*.yaml|*.yml|*.jsonl) ;;
  *) exit 0 ;;
esac

# 5. Ask Duo what's open. Bounded so the hook can never hang on a wedged
#    bridge: a node-based ~1500ms timeout wrapper around `duo status`. If it
#    exits non-zero, times out, or prints nothing → fail open (exit 0).
#    If this install predates the `duo status` verb the call just errors and
#    we no-op — exactly the intended fail-open behaviour.
STATUS=$(node -e '
const {execFile}=require("child_process");
const child=execFile("duo",["status"],{timeout:1500,maxBuffer:1<<20},(err,stdout)=>{
  if(err){process.exit(0)}            // non-zero / timeout / spawn failure → emit nothing
  process.stdout.write(stdout||"");
});
child.on("error",()=>process.exit(0)); // duo not on PATH → emit nothing
' 2>/dev/null)
[ -n "$STATUS" ] || exit 0

# 6. Is TARGET in Duo's open set? `duo status` returns open tabs under
#    `open` (fallback `tabs`); each entry carries a `path`. Print "1" on a
#    hit, nothing otherwise. Any malformed JSON → empty (fail open).
HIT=$(printf '%s' "$STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const open=(j.open||j.tabs||[]);process.stdout.write(open.some(t=>t&&t.path===process.argv[1])?"1":"")}catch(_){}})' "$TARGET" 2>/dev/null)

# 7. Not open in Duo → the plain Edit/Write is fine; stay silent.
[ -n "$HIT" ] || exit 0

# 8. Open in Duo. Print a kind-specific nudge to stderr (never stdout, never
#    a non-zero exit). Branch on the extension so the suggestion names the
#    right verb family.
case "$TARGET" in
  *.md|*.markdown)
    echo "Duo: '$TARGET' is open in the markdown editor. Prefer a duo doc verb so your change lands in the live buffer and paints the change-highlight: 'duo doc edit <path> --find \"…\" --replace \"…\"' for a surgical swap, or 'duo doc write --replace-all' (stdin) to rewrite the body. A direct Write can be clobbered by the editor's autosave and skips the highlight. Proceeding anyway." >&2
    ;;
  *.html|*.htm)
    echo "Duo: '$TARGET' is open in the HTML canvas. Prefer the duo html verbs so element IDs + comment threads survive: 'duo html set --id <duo-id> --content \"…\"' / 'duo html replace --id <duo-id> --html \"…\"' / 'duo html append --parent <duo-id> --html \"…\"' / 'duo html attr --id <duo-id> --set k=v'. A direct Write can be clobbered by autosave, drops data-duo-id anchors, and paints no change-highlight. Proceeding anyway." >&2
    ;;
  *.json|*.yaml|*.yml|*.jsonl)
    echo "Duo: '$TARGET' is open in the JSON/YAML view. Prefer a duo json verb so the edit goes through the live surface: 'duo json set <path> <dotpath> <value>' for a single key, or 'duo json merge <path> <file.json>' to deep-merge. A direct Write can be clobbered by the view's autosave and skips the change-highlight. Proceeding anyway." >&2
    ;;
esac

# 9. Always succeed — advisory only, never blocks the tool call.
exit 0
