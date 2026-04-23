# Example: Edit a Google Doc

**Scenario:** The user says "add a bullet to the risks section of the doc
open in my browser saying 'X'" or "append this paragraph to the PRD".

## Why keystrokes, not DOM

You cannot set the text of a Google Doc by writing to the DOM — the visible
document is a `<canvas>`, and the real input target is a hidden
`contenteditable` element that Docs manages internally. The only way to
feed input into it is to synthesize keyboard events at the page level. The
`duo focus` + `duo type` + `duo key` primitives do exactly that.

## The pattern

```bash
# 1. Focus the doc body (required — text is routed via a hidden input proxy)
duo focus '[role="document"]'

# 2. Position the cursor
duo key End                 # end of line
# or: duo key Home / ArrowDown --modifiers shift (select down), etc.

# 3. Type
duo type "New content goes here."
duo key Enter               # new paragraph (optional)

# 4. Verify
duo ax --selector '[role="document"]' | tail -20
```

The final `duo ax` is not optional — it is how you confirm the text actually
landed in the doc. Focus can be lost between commands, and you want to catch
that before the user does.

## Useful keys inside Docs

- `Enter` / `Return` — new paragraph
- `Tab` — list indent (in a list)
- `Shift+Tab` — list outdent (use `--modifiers shift`)
- `Backspace`, `Delete`
- `Home`, `End`, `PageUp`, `PageDown`
- `ArrowUp/Down/Left/Right` — plain movement, or `--modifiers shift` to extend selection
- `b` / `i` / `u` with `--modifiers cmd` — bold / italic / underline
- `z` with `--modifiers cmd` — undo (useful to back out of a bad edit while
  testing)

## If the edit goes somewhere unexpected

Focus is the most common failure mode. Docs has several focusable surfaces:
the comments sidebar, the title input, the headers area, etc. If `duo type`
appears to do nothing or edits the wrong part of the doc:

1. Re-issue `duo focus '[role="document"]'` immediately before typing.
2. If that doesn't help, click the doc body first:
   `duo click '[role="document"]'` then retry focus + type.
3. Confirm with `duo ax --selector '[role="document"]' | tail` so you can
   see where the text actually landed.

## When NOT to use keystrokes

Raw keystroke synthesis is fragile for structural edits:

- Inserting a table
- Rewriting a whole heading block
- Moving content across sections
- Bulk replace across a long doc

For those, prefer the Google Docs REST API path (`batchUpdate`) — the app
has a documented escape hatch, ask the user to grant consent if needed. If
the API route isn't available in this session, say so explicitly rather
than attempting a long keystroke sequence that's likely to go wrong.
