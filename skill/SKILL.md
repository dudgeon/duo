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
| `duo navigate <url>` | Navigate the **active tab** to URL | JSON: `{ok, url, title}` |
| `duo open <path-or-url>` | Open a local file or URL in a **new** tab, activate it. Use for showing the user agent-generated artifacts. | JSON: `{ok, id, url, title}` |
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
| `duo tabs` / `duo tab <n>` / `duo close <n>` | List / switch / close browser tabs | JSON |
| `duo wait <selector> [--timeout <ms>]` | Wait for element | JSON |

## Patterns

### Read a Google Doc — the fast path (`export?format=md`)

Google Docs serves a same-origin export endpoint that Claude can hit via
`fetch()` from inside the authenticated page. The session cookies carry
the auth, and Google hands back a clean Markdown rendering of the **entire
document** — headings, bold, italic, links, lists, horizontal rules — not
just the part currently on screen.

```bash
# Get the doc content as Markdown (full doc, with formatting):
duo eval "(async () => {
  const m = location.pathname.match(/\\/document\\/d\\/([^/]+)/);
  if (!m) return 'not on a Doc page';
  const r = await fetch('/document/d/' + m[1] + '/export?format=md');
  return await r.text();
})()"
```

That's the canonical read of a Google Doc. Save it to a file with
`duo eval ... > /tmp/doc.md` and work from there — you get H1-H6,
`**bold**`, `*italic*`, `[text](url)`, `---`, and list items exactly as
Docs renders them.

**Other export formats** available at the same endpoint (swap `format=`):
`html` (full HTML+CSS), `txt` (plain text), `rtf`, `docx` (binary ZIP),
`epub` (binary). Prefer `md` unless you specifically need one of the
others — it's the cleanest structured surface.

### Read a Google Doc — no-network / offline fallbacks

If the `/export` fetch fails (the user is signed out, the doc isn't
shared to them, or they're in an offline-mode tab), these in-page
alternatives exist:

- **`_docs_annotate_getAnnotatedText('')`** is a Docs global that resolves
  to an object with `.getText()`, `.getAnnotations()`, `.getSelection()`.
  `getText()` returns the full plaintext of the doc including
  not-currently-rendered sections (ETX `\u0003` at doc start; FS `\u001c`
  between sections; `\n` between paragraphs; various other control chars
  for inline objects). `getAnnotations()` returns link URLs and
  horizontal-rule ranges but **not** text styles (bold/italic/headings).

  ```bash
  duo eval "(async () => {
    const r = await _docs_annotate_getAnnotatedText('');
    return { text: r.getText(), links: r.getAnnotations().link || [] };
  })()"
  ```

- **`duo ax --selector '[role="document"]'`** — if present, the AX tree
  renders the currently-visible portion of the canvas into structured
  Markdown. It's viewport-limited (Docs virtualizes content), so it's
  only useful when the Doc is short or you've scrolled the part you care
  about into view. New docs with Google's AI starter overlay don't expose
  `[role="document"]` at all; the `/export` path works on those too.

**On any `docs.google.com/*/edit` URL, these are traps — do not use them:**

- `duo text` / `duo text --selector ".kix-appview-canvas"` — canvas has no
  innerText; returns chrome or empty.
- `duo dom` (and anything that extracts visible text from the raw HTML) —
  Google's initial HTML includes a `<noscript>` block that says
  "JavaScript isn't enabled in your browser, so this file can't be opened."
  Naive text extractors read that and wrongly conclude JS is broken. It
  isn't — you're reading the wrong layer. Use `/export?format=md`.
- **Navigating** to `/document/d/ID/export?format=txt` (i.e. `duo navigate
  https://docs...export?format=txt`) — that URL serves a download
  (Content-Disposition: attachment), so in-page navigation hits
  `ERR_FAILED`. The right call is `fetch()` from *inside* the doc page
  (shown above), not a `duo navigate` away.
- `duo eval` that tries to scrape text from `.kix-paragraphrenderer` or
  similar class names — canvas scaffolding with no text nodes.

### Edit a Google Doc (what works today)

**What works reliably:**

- **Plain-text insertion** via `duo type "…"`. This routes through CDP's
  `Input.insertText`, which Docs accepts directly. Include `\n` inside
  the string to create paragraph breaks — you do NOT need `duo key
  Enter`:

  ```bash
  duo type $'First paragraph.\nSecond paragraph.\nThird paragraph.'
  ```

- **Cursor placement** via `_docs_annotate_getAnnotatedText('')` —
  `await r.getSelection()` to read, `r.setSelection(...)` to move.
  (Prefer this over arrow-key navigation — see below.)

**What does NOT work today (known limitation):**

The synthesized-key path (`duo key <name>` and `duo key <letter>
--modifiers cmd,...`) doesn't reliably reach the Docs keyboard
listener. Docs routes all keyboard input through a hidden
`.docs-texteventtarget-iframe`; CDP's `Input.dispatchKeyEvent` delivers
to the main frame's focused element, and `duo focus` can't cross the
iframe boundary to give the hidden target true keyboard focus. As a
result, on a Docs page these commands are silently no-ops:

- `duo key Enter / Backspace / ArrowLeft / Home / End` — navigation
- `duo key b --modifiers cmd` / `i` / `u` — bold, italic, underline
- `duo key z --modifiers cmd` — undo
- `duo key a --modifiers cmd` — select all
- `duo key 1 --modifiers cmd,alt` — heading 1 (and other heading
  shortcuts)

`document.execCommand('bold')` also does nothing — Docs uses its own
Kix selection model, not the DOM Selection API.

**Practical consequence:** if the user asks you to bold, italicize,
apply a heading style, or otherwise format a Doc, you can't do it via
`duo` today. Say so plainly and either:

1. **Defer to the user.** Type the plain text via `duo type`, then ask
   the user to apply the formatting by hand — they have the Doc open
   in the pane, so it's quick.
2. **Escalate to the Docs REST API.** `documents.googleapis.com/v1/
   documents/{id}:batchUpdate` supports structured inserts and style
   runs. Requires OAuth with `https://www.googleapis.com/auth/documents`;
   the Duo app will grow a consent flow for this in a later stage. If
   that flow is available in the current session, prefer it for any
   non-trivial edit (tables, heading restructures, formatted blocks).
   If not, fall back to option 1 rather than grinding through
   workarounds.

Always verify with a follow-up read (the `/export?format=md` fetch) so
the user's doc actually reflects what you intended.

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

### Show the user a generated HTML artifact ("show me X" / "open that")

When the user asks for an interactive prototype, a quick visualization,
or "show me {UI idea}", write the HTML to disk and open it in a new
browser tab with `duo open`. A single command handles path resolution
(absolute, `~/…`, relative) and opens a fresh tab so existing tabs
aren't disturbed.

```bash
# 1. Generate HTML locally
cat > /tmp/countdown.html << 'EOF'
<!doctype html>
<!-- your prototype here -->
EOF

# 2. Open it in a new tab (becomes active)
duo open /tmp/countdown.html
# → { ok: true, id: 2, url: "file:///tmp/countdown.html", title: "Countdown" }

# 3. Interact with it — the new tab is active, so every other duo command
#    targets it automatically:
duo click "#start"
duo eval "document.getElementById('t').textContent"
duo screenshot --out /tmp/countdown.png
```

**Iterating.** Once the artifact is open and the user asks for a
change, rewrite the same file and reload the same tab by re-navigating:

```bash
# rewrite /tmp/countdown.html with the new styles…
duo navigate "file:///tmp/countdown.html"   # targets the ACTIVE tab
```

The active tab is the artifact you just opened, so `duo navigate`
reloads in place — no new tabs accumulate.

**When to use `duo open` vs `duo navigate`:**

- `duo open <path-or-url>` — first load of a new artifact, or any time
  you want a fresh tab. Use this for "show me X" and "open that".
- `duo navigate <url>` — replaces the URL of the currently-active tab.
  Use this for iterating on the prototype in place, or for navigating
  an existing tab to a different page.

`duo open` accepts the same URL schemes as `duo navigate` (http(s),
file, about, data, etc.), plus local file paths with `~/` or relative
paths — path resolution happens client-side.

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
