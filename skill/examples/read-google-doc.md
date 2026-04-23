# Example: Read a Google Doc

**Scenario:** The user says "summarize the doc open in my browser" or "what
does the PRD say about X?" and the Duo browser has a Google Doc open.

## The trap

Don't do this:

```bash
# Empty or near-empty output — the trap
duo text --selector ".kix-appview-canvas"
```

Google Docs (and Sheets, Slides, Figma, and newer Notion editors) render the
document body to an HTML `<canvas>`. Canvas elements have no text children,
so DOM-based text extraction returns chrome (menus, toolbars) with none of
the actual document content. `duo text` will succeed and return a few dozen
characters of UI labels; there is no error to tell you the read failed.

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

## Narrowing for long docs

For very large documents, `duo ax` output can get sizeable. Options:

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
