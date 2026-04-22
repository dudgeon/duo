# duo skill — v0.1.0

> This skill is bundled with the Duo desktop app and installed to
> `~/.claude/skills/duo/` on first launch. It teaches Claude Code how to
> use the `duo` CLI to read and drive the browser.

---

## When to use `duo`

Use `duo` when you need to **interact with the live browser** running inside
the Duo app:

- Read content from Google Docs, Notion, or other authenticated web apps
- Fill forms, click buttons, or navigate to URLs
- Capture screenshots to verify visual state
- Iterate on generated HTML/CSS artifacts by loading them in the browser

**Do not use `duo` when:**

- You just need to fetch a public web page — use `WebFetch` instead
- You need to read a local file — use `Read` instead
- The information is already in your context

---

## Checking the app is running

```bash
duo --version        # prints version; fails if app is not running
```

If `duo` fails with "Cannot connect", the Duo app is not running.
Ask the user to launch it.

---

## Command reference

| Command | Description | Output |
|---|---|---|
| `duo navigate <url>` | Navigate to URL | JSON: `{ok, url, title}` |
| `duo url` | Current URL | plain text |
| `duo title` | Current page title | plain text |
| `duo dom` | Full page HTML (outerHTML) | HTML |
| `duo text` | Visible text (body innerText) | plain text |
| `duo text --selector <css>` | innerText of matching element | plain text |
| `duo click <selector>` | Click by CSS selector | JSON: `{ok, error?}` |
| `duo fill <selector> <value>` | Fill an input | JSON: `{ok, error?}` |
| `duo eval <js>` | Execute JS, return result | JSON-serialized |
| `duo screenshot [--out path] [--selector css]` | PNG screenshot | file path |
| `duo tabs` | List browser tabs | JSON array |
| `duo tab <n>` | Switch to tab N | JSON: `{ok}` |
| `duo wait <selector> [--timeout ms]` | Wait for element | JSON: `{ok, error?}` |

---

## Common patterns

### Read a Google Doc

```bash
duo navigate "https://docs.google.com/document/d/DOCID/edit"
duo wait ".kix-appview-canvas" --timeout 8000
duo text --selector ".kix-appview-canvas"
```

> If `duo text` returns too much text, use `--selector` to narrow to a
> section, or pipe through `head -n 100`.

### Fill and submit a form

```bash
duo fill "input[name='email']" "user@example.com"
duo fill "input[name='message']" "Hello from Claude"
duo click "button[type='submit']"
duo wait ".success-message" --timeout 5000
duo text --selector ".success-message"
```

### Iterate on a generated HTML artifact

```bash
# Write the artifact
cat > /tmp/prototype.html << 'EOF'
<!-- your HTML here -->
EOF

duo navigate "file:///tmp/prototype.html"
duo screenshot --out /tmp/prototype.png
# Review the screenshot, then iterate
```

### Verify a visual state

```bash
duo screenshot --out /tmp/state.png
# The screenshot path is printed; share it with the user or inspect it
```

### Error recovery

If a selector fails:

1. Dump the DOM and inspect: `duo dom | grep -i "keyword"`
2. Try a broader selector or `duo eval "document.querySelector('...')?.textContent"`
3. Use `duo wait <selector>` if the element might not be loaded yet

---

## Error semantics

- Non-zero exit code on failure
- Human-readable error message on `stderr`
- Retry navigation/timing failures up to 3 times before giving up

---

## Version compatibility

This skill is compatible with `duo` version `^0.1.0`.

Check compatibility:
```bash
duo --version   # must be >= 0.1.0, < 0.2.0
```

If the version doesn't match, ask the user to update the Duo app.
