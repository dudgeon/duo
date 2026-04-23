# Example: Read a Google Doc

**Scenario:** The user says "summarize the doc open in my browser" or "what
does the PRD say about X?" and the Duo browser has a Google Doc open.

## The traps

**Don't do any of these** on a Google Doc:

```bash
# 1) Canvas trap — empty or chrome-only output, no error
duo text --selector ".kix-appview-canvas"

# 2) noscript trap — extracting text from the raw HTML surfaces Google's
#    noscript fallback ("JavaScript isn't enabled in your browser…").
#    This is misleading: JS IS enabled in the Electron browser. You are
#    reading the wrong layer, not diagnosing a broken page.
duo dom | <any text extractor>

# 3) Export URL trap — this URL serves a download, so the in-page
#    navigation hits ERR_FAILED. There is no fallback export path.
duo navigate "https://docs.google.com/document/d/ID/export?format=txt"

# 4) Class-name scraping — .kix-paragraphrenderer and friends are canvas
#    scaffolding. They render visually but have no text nodes.
duo eval "document.querySelectorAll('.kix-paragraphrenderer')"
```

Google Docs (and Sheets, Slides, Figma, and newer Notion editors) render the
document body to an HTML `<canvas>`. Canvas elements have no text children,
so DOM-based text extraction returns chrome (menus, toolbars) with none of
the actual document content — or worse, Google's `<noscript>` fallback. The
only reliable read path is the accessibility tree.

## The right way

```bash
# 1. Navigate if not already there (or skip if duo url already points at the doc)
duo navigate "https://docs.google.com/document/d/DOC_ID/edit"

# 2. Wait for the doc body to mount
duo wait '[role="document"]' --timeout 10000

# 3. Read via the accessibility tree
duo ax --selector '[role="document"]'
```

`duo ax` pulls the CDP accessibility tree and renders it to Markdown:
headings become `# …`, list items become `- …`, links become `[text](#)`,
and paragraphs come through as plain text. The output reflects the live
visible document in screen order.

## Long docs — scroll to expand coverage

Google Docs virtualizes the canvas: only the portion near the current
scroll position gets rendered into the accessibility tree. If a doc is
longer than a few pages, `duo ax` on a freshly-loaded doc will only
capture the top. Scroll the whole thing before reading:

```bash
# Pass 1: force render by scrolling through the doc
duo eval "window.scrollTo(0, document.body.scrollHeight)"
duo eval "window.scrollTo(0, 0)"

# Pass 2: now read
duo ax --selector '[role="document"]'
```

For very large docs, chunk the read:

```bash
duo eval "window.scrollTo(0, 0)"
for i in 0 1 2 3 4; do
  duo ax --selector '[role="document"]' >> /tmp/doc.md
  duo eval "window.scrollBy(0, window.innerHeight * 5)"
  sleep 0.3
done
# dedupe overlapping paragraphs afterward
```

Other narrowing options:

```bash
# Narrow to a labelled landmark
duo ax --selector '[role="region"][aria-label="Risks"]'

# Or fetch as JSON and process programmatically
duo ax --format json | jq '.children[] | select(.role == "heading")'
```

## If the doc doesn't load

- `duo ax` returns an account-picker tree: the user's SSO session is stale.
  Ask them to log in via the browser pane.
- `duo wait '[role="document"]'` times out: the page may be stuck on a
  "requesting access" screen. Use `duo screenshot` to see what's on screen.
- Doc loads but `ax` is empty: the user is probably in a preview/embed view,
  not the editor. Navigate to the `/edit` URL.
