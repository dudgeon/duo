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

## Prefer delegating to the `duo-browser` subagent

Browser interactions tend to fan out into several CLI round-trips (url,
title, wait, ax, verify). Running them inline bloats the parent
conversation with CLI noise the user doesn't need to see. Unless the
request is a genuine one-liner (e.g. "what URL is open?"), **delegate to
the `duo-browser` subagent** with a high-level goal ("summarize the doc
open in my browser", "add a bullet saying X to the risks section") and
let it return only the outcome.

Use this skill's direct CLI reference when the subagent isn't available,
or when you're doing a single simple call.

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

Google Docs renders the document body to a `<canvas>` element. The visible
text lives in the accessibility tree, not the DOM. **There is exactly one
right way to read a Docs page:**

```bash
duo navigate "https://docs.google.com/document/d/DOC_ID/edit"   # skip if already there
duo wait '[role="document"]' --timeout 9000
duo ax --selector '[role="document"]'
```

**On any `docs.google.com/*/edit` URL, these are traps — do not use them:**

- `duo text` / `duo text --selector ".kix-appview-canvas"` — canvas has no
  innerText; returns chrome (menus, toolbars) or empty.
- `duo dom` — Google's initial HTML includes a `<noscript>` block that says
  "JavaScript isn't enabled in your browser, so this file can't be opened."
  Agents that extract visible text from `dom` read that string and wrongly
  conclude JS is broken. It isn't — the Electron browser has JS enabled;
  you're just looking at the wrong layer. Use `ax`.
- `https://docs.google.com/document/d/ID/export?format=txt` — this URL
  serves a download (Content-Disposition: attachment), so `duo navigate`
  hits `ERR_FAILED`. It is not a fallback — there is no fallback.
- `duo eval` that tries to scrape text from `.kix-paragraphrenderer` or
  similar class names — those are canvas scaffolding with no text nodes.

**If `duo ax --selector '[role="document"]'` returns empty or the selector
wait times out:**

1. Check `duo url` — you may have been bounced to an account picker or
   "requesting access" page. The user needs to resolve that in the browser
   pane; you cannot.
2. Re-run the `wait` with a longer timeout (up to 20s) — large docs can be
   slow to mount the accessibility tree.
3. Grab `duo screenshot --out /tmp/duo-debug.png` and look; if the doc is
   visually present but `ax` is empty, the tree is still populating —
   sleep 2s and retry.

**Long docs need scrolling.** Google Docs virtualizes the canvas: only the
portion near the current scroll position gets rendered into the
accessibility tree. For a full read of a long doc, scroll to the bottom
(forcing render), scroll back to the top, then read:

```bash
duo eval "window.scrollTo(0, document.body.scrollHeight)"
duo eval "window.scrollTo(0, 0)"
duo ax --selector '[role="document"]'
```

Or chunk the read by scrolling incrementally and concatenating:

```bash
duo eval "window.scrollTo(0, 0)"
duo ax --selector '[role="document"]' > /tmp/doc-top.md

duo eval "window.scrollBy(0, window.innerHeight * 5)"
duo ax --selector '[role="document"]' > /tmp/doc-mid.md
# ... repeat until scrollY stops changing
```

The same rules apply to Google Sheets, Slides, Figma, and other
canvas-rendered apps: `ax` is the only read path, and scrolling expands
coverage on long surfaces.

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
