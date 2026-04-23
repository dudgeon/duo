# Example: Read a Google Doc

**Scenario:** the user says "summarize the doc open in my browser" or
"what does the PRD say about X?" and the Duo browser has a Google Doc
open.

## The fast path — `export?format=md`

Google Docs exposes a same-origin export endpoint that Claude can hit
via `fetch()` from inside the authenticated page. The session cookies
carry the auth, and Google returns a clean Markdown rendering of the
**entire document** — headings, bold, italic, links, lists, horizontal
rules.

```bash
duo eval "(async () => {
  const m = location.pathname.match(/\\/document\\/d\\/([^/]+)/);
  if (!m) return 'not on a Doc page';
  const r = await fetch('/document/d/' + m[1] + '/export?format=md');
  return await r.text();
})()"
```

Pipe the output to a file if it's long: `... > /tmp/doc.md`.

Other formats at the same endpoint: `html` (CSS classes preserved),
`txt` (plain), `rtf`, `docx` (binary). Prefer `md` — it's the cleanest
structured surface for reasoning.

## Fallback — the Docs internal annotator

If the `/export` fetch fails (auth expired, offline mode, sharing
issue), a built-in Docs global exposes the doc's model without a
network call:

```bash
duo eval "(async () => {
  const r = await _docs_annotate_getAnnotatedText('');
  return { text: r.getText(), links: r.getAnnotations().link || [] };
})()"
```

`.getText()` returns the full plaintext including not-currently-
rendered sections. Control characters to know: `\u0003` at doc start,
`\u001c` between sections, `\n` between paragraphs.

`.getAnnotations()` returns `link` (URLs with ranges) and
`horizontalRule` positions — **not** text styles (bold, italic,
headings). For styled structure, prefer the `/export?format=md` path.

## Weaker fallback — `duo ax`

```bash
duo ax --selector '[role="document"]'
```

This only captures what's currently rendered into the accessibility
tree — Docs virtualizes the canvas, so large docs only return the
viewport. Useful when the other two paths don't work and the portion
you need is on screen. For long docs, scroll the whole thing first:

```bash
duo eval "window.scrollTo(0, document.body.scrollHeight)"
duo eval "window.scrollTo(0, 0)"
duo ax --selector '[role="document"]'
```

## The traps — do not use these on Google Docs

```bash
# 1) Canvas trap — canvas has no innerText; you get chrome or empty
duo text --selector ".kix-appview-canvas"

# 2) noscript trap — the raw HTML includes a <noscript> fallback
#    ("JavaScript isn't enabled in your browser…"). Extracting visible
#    text from `duo dom` surfaces that string and makes you think JS is
#    broken. It isn't. You're reading the wrong layer.
duo dom | <any text extractor>

# 3) Navigate-to-export trap — the /export URLs serve downloads
#    (Content-Disposition: attachment). In-page navigation fails with
#    ERR_FAILED. You want `fetch()` from *inside* the doc page, not a
#    `duo navigate` away.
duo navigate "https://docs.google.com/document/d/ID/export?format=txt"

# 4) Class-name scraping — .kix-paragraphrenderer and friends are
#    canvas scaffolding. They render visually but have no text nodes.
duo eval "document.querySelectorAll('.kix-paragraphrenderer')"
```

## If the doc doesn't load

- Export fetch returns a sign-in page: the user's session is stale.
  Ask them to log in via the browser pane.
- `duo url` shows a redirect to `accounts.google.com`: same deal.
- Doc loads but the `/export` 404s: the doc might be private and not
  shared with the signed-in user. Verify with `duo url` that you're on
  the right doc.
