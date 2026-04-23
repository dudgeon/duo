---
name: duo
description: Interact with the live browser running inside the Duo desktop app — navigate, read page content (including Google Docs and other canvas-rendered apps via the accessibility tree), click, fill, type, press keys, take screenshots, and diagnose failures via captured console logs. Use whenever the user asks you to work with whatever is currently open in the Duo browser pane, or to drive Google Docs / Sheets / Slides / Figma / Notion in a live session.
---

# duo — driving the live browser from a Duo terminal

This skill teaches you to use the `duo` CLI to interact with the browser pane
in the Duo desktop app. When the user asks "summarize the doc open in my
browser", "click the Sign-in button", "add a bullet to the risks section",
etc., **reach for `duo`** — it is the only tool that can read and write the
live authenticated web surface the user is looking at.

## When NOT to use `duo`

- Public web page with no auth — use `WebFetch`.
- Local files on disk — use `Read`.
- Terminal or shell state — not `duo`'s job.
- Content that's already in your context.

## Sanity check

```bash
duo --version
```

If this fails with "Cannot connect", the Duo app is not running. Ask the user
to launch it before retrying.

## Command reference

| Command | Purpose | Output |
|---|---|---|
| `duo navigate <url>` | Navigate the browser | JSON: `{ok, url, title}` |
| `duo url` | Current URL | plain text |
| `duo title` | Current page title | plain text |
| `duo text [--selector <css>]` | Visible text (DOM `innerText`) | plain text |
| `duo ax [--selector <css>] [--format md\|json]` | **Accessibility tree** — use for canvas apps | Markdown (default) or JSON |
| `duo dom` | Full page HTML | HTML |
| `duo click <selector>` | Click element | JSON |
| `duo fill <selector> <value>` | Set input value (DOM-level) | JSON |
| `duo focus <selector>` | Focus element (required before `type`/`key` in canvas apps) | JSON |
| `duo type <text>` | Synthesize keystrokes into the focused element | JSON |
| `duo key <name> [--modifiers cmd,shift,alt,ctrl]` | Dispatch a named key (Enter, Backspace, ArrowDown, Home, End, Tab, PageUp/Down, or single letter) | JSON |
| `duo eval <js>` | Execute JS, return its value | JSON |
| `duo screenshot [--out <path>] [--selector <css>]` | PNG (base64 or file path) | path or base64 |
| `duo console [--since <ms>] [--level log,warn,error,...] [--limit N]` | Buffered console events | NDJSON |
| `duo tabs` / `duo tab <n>` | List / switch browser tabs | JSON |
| `duo wait <selector> [--timeout <ms>]` | Wait for element | JSON |

## Patterns

### Read a Google Doc (the canonical canvas-app read)

Google Docs renders the document body to a `<canvas>` element. **`duo text`
returns almost nothing** on a Docs page — the visible text lives in the
accessibility tree, not the DOM. Always use `duo ax`:

```bash
duo navigate "https://docs.google.com/document/d/DOC_ID/edit"
duo wait '[role="document"]' --timeout 10000
duo ax --selector '[role="document"]'
```

The same pattern applies to Google Sheets, Slides, Figma, and any other app
that renders to canvas and exposes content via ARIA.

### Edit a Google Doc (casual text edits)

For appending, replacing a selection, or quick edits, synthesize input:

```bash
duo focus '[role="document"]'
duo key End                          # cursor to end of line
duo type "New content to append."
```

Useful keys for structural edits:

- `duo key Enter` — new paragraph
- `duo key Tab` — list indent
- `duo key Backspace`
- `duo key ArrowDown --modifiers shift` — extend selection down
- `duo key b --modifiers cmd` — bold the current selection

Always verify with a follow-up `duo ax --selector '[role="document"]'` so the
user's doc actually reflects what you intended.

**For structural edits** (inserting a table, restructuring headings), prefer
the Google Docs REST API path when available (documented separately); raw
keystrokes are fragile for complex changes.

### Read an ordinary DOM page

```bash
duo navigate "https://example.com"
duo text                      # or: duo text --selector "article"
```

Use `duo text` for classic DOM-rendered pages — it's simpler than `ax` and
plenty accurate.

### Fill and submit a form

```bash
duo fill 'input[name="email"]' "user@example.com"
duo fill 'input[name="message"]' "Hello"
duo click 'button[type="submit"]'
duo wait ".success" --timeout 5000
duo text --selector ".success"
```

### Iterate on a generated HTML artifact

```bash
# write the file locally, then:
duo navigate "file:///tmp/prototype.html"
duo screenshot --out /tmp/prototype.png
# review the screenshot, tweak, repeat
```

### Diagnose a failing interaction with the page

If a `duo click` or `duo eval` doesn't produce the expected result, the page
probably logged a warning or error. Grab a timestamp *before* the action and
pull console output after:

```bash
TS=$(date +%s000)
duo click "button.flaky"
sleep 1
duo console --since $TS --level warn,error
```

## Error recovery

When a selector fails:

1. Confirm the element actually exists:
   ```bash
   duo eval "!!document.querySelector('YOUR_SELECTOR')"
   ```
2. Inspect the surrounding DOM:
   ```bash
   duo dom | grep -i "part_of_the_text"
   ```
3. Re-issue `duo focus` immediately before `duo type` — focus is easy to
   lose between commands, especially in canvas apps.
4. For canvas apps, never assume `duo text` captured anything meaningful;
   switch to `duo ax`.
5. Retry transient navigation/timing errors up to three times before
   declaring the operation impossible.

## The canvas-text trap (why `ax` exists)

```bash
# This will return almost nothing on a Google Doc, even if the doc is huge.
duo text --selector ".kix-appview-canvas"
```

Canvas elements have no text children. Google Docs, Sheets, Slides, Figma,
and newer Notion surfaces all fall into this pattern. If a page looks rich
but `duo text` returns a short string or chrome-only content, assume canvas
rendering and retry with `duo ax`.

## Version compatibility

This skill targets `duo` v0.1.x. Run `duo --version` and verify the
major/minor match before trusting complex patterns.
