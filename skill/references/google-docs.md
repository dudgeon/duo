# Google Docs — reading and editing via `duo`

Google Docs renders into a `<canvas>`, so the usual DOM extraction tools
(`duo text`, `duo dom`) return chrome or empty. This file is the deep
reference; the SKILL.md only carries a pointer.

## Read a Google Doc — the fast path (`export?format=md`)

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

## Read a Google Doc — no-network / offline fallbacks

If the `/export` fetch fails (the user is signed out, the doc isn't
shared to them, or they're in an offline-mode tab), these in-page
alternatives exist:

- **`_docs_annotate_getAnnotatedText('')`** is a Docs global that resolves
  to an object with `.getText()`, `.getAnnotations()`, `.getSelection()`.
  `getText()` returns the full plaintext of the doc including
  not-currently-rendered sections (ETX `` at doc start; FS ``
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

## Edit a Google Doc (what works today)

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
