# Example: Edit a Google Doc

**Scenario:** the user says "add a bullet to the risks section saying
'X'", "append this paragraph to the PRD", or "make that heading bold".

## What works — plain-text insertion via `duo type`

`duo type "…"` routes through CDP's `Input.insertText`, which Docs
accepts directly at the cursor. This is the only Docs write primitive
that works reliably today.

Paragraph breaks: embed `\n` in the typed string — you do NOT need
`duo key Enter` (it's one of the things that doesn't route; see
below).

```bash
# Bash: use $'…' so \n is interpreted as a newline
duo type $'First new paragraph.\nSecond new paragraph.'
```

Verify with a follow-up read:

```bash
duo eval "(async () => {
  const m = location.pathname.match(/\\/document\\/d\\/([^/]+)/);
  const r = await fetch('/document/d/' + m[1] + '/export?format=md');
  return (await r.text()).slice(-400);
})()"
```

## What doesn't work — keyboard shortcuts and named keys

The synthesized-key path (`duo key <name>` and modifier shortcuts)
doesn't reliably reach the Docs keyboard listener. Docs routes all
keyboard input through a hidden `.docs-texteventtarget-iframe`; CDP's
`Input.dispatchKeyEvent` delivers to the main frame's focused element,
which isn't the iframe. On a Google Doc, these commands are silently
no-ops today:

- `duo key Enter / Backspace / ArrowLeft / Home / End` (navigation)
- `duo key b --modifiers cmd` / `i` / `u` (bold, italic, underline)
- `duo key z --modifiers cmd` (undo)
- `duo key a --modifiers cmd` (select all)
- Heading shortcuts (`Cmd+Alt+1..6`)

`document.execCommand('bold')` also has no effect — Docs uses its own
Kix selection model rather than the DOM Selection API.

## Cursor positioning without arrow keys

Since arrow keys don't route, use the Docs model's own selection API:

```bash
duo eval "(async () => {
  const r = await _docs_annotate_getAnnotatedText('');
  const len = r.getText().length;
  r.setSelection([{ start: len, end: len }]);  // move to end
  return 'ok';
})()"
```

Then `duo type "…"` inserts at that position. The selection-range
coordinates are UTF-16 offsets into the string returned by
`getText()`.

## How to handle "make X bold / H1 / a link" requests

You can't apply styling via `duo` today. Choose one:

1. **Defer to the user.** Type the raw text with `duo type`, then tell
   the user: "I've added the paragraph; select the heading line and
   press `⌘⌥1` for H1 style, or `⌘B` for bold." They have the doc open
   in the pane, so formatting is seconds of their time.

2. **Escalate to the Docs REST API.** The `documents.batchUpdate`
   endpoint supports structured inserts and style runs. Requires OAuth
   with `https://www.googleapis.com/auth/documents`. The Duo app will
   grow a consent flow for this in a later stage (see §17.4 of the
   brief). If it's available in the current session, prefer it for any
   styled edit. If not, fall back to option 1.

Do NOT grind through dozens of failed keyboard shortcuts hoping one
will take — they won't. Surface the limitation and let the user
choose.

## Focus recovery

If `duo type` stops landing text in the right place, the user has
probably clicked somewhere else (comments sidebar, title bar, a
different tab). Re-focus the doc:

```bash
duo click '.docs-texteventtarget-iframe'
# or:
duo eval "document.querySelector('.docs-texteventtarget-iframe').focus()"
```

Then retry `duo type`.
