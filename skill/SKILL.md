# orbit skill — v0.1.0

> This skill is bundled with the Orbit desktop app and installed to
> `~/.claude/skills/orbit/` on first launch. It teaches Claude Code how to
> use the `orbit` CLI to read and drive the browser.

---

## When to use `orbit`

Use `orbit` when you need to **interact with the live browser** running inside
the Orbit app:

- Read content from Google Docs, Notion, or other authenticated web apps
- Fill forms, click buttons, or navigate to URLs
- Capture screenshots to verify visual state
- Iterate on generated HTML/CSS artifacts by loading them in the browser

**Do not use `orbit` when:**

- You just need to fetch a public web page — use `WebFetch` instead
- You need to read a local file — use `Read` instead
- The information is already in your context

---

## Checking the app is running

```bash
orbit --version        # prints version; fails if app is not running
```

If `orbit` fails with "Cannot connect", the Orbit app is not running.
Ask the user to launch it.

---

## Command reference

| Command | Description | Output |
|---|---|---|
| `orbit navigate <url>` | Navigate to URL | JSON: `{ok, url, title}` |
| `orbit url` | Current URL | plain text |
| `orbit title` | Current page title | plain text |
| `orbit dom` | Full page HTML (outerHTML) | HTML |
| `orbit text` | Visible text (body innerText) | plain text |
| `orbit text --selector <css>` | innerText of matching element | plain text |
| `orbit click <selector>` | Click by CSS selector | JSON: `{ok, error?}` |
| `orbit fill <selector> <value>` | Fill an input | JSON: `{ok, error?}` |
| `orbit eval <js>` | Execute JS, return result | JSON-serialized |
| `orbit screenshot [--out path] [--selector css]` | PNG screenshot | file path |
| `orbit tabs` | List browser tabs | JSON array |
| `orbit tab <n>` | Switch to tab N | JSON: `{ok}` |
| `orbit wait <selector> [--timeout ms]` | Wait for element | JSON: `{ok, error?}` |

---

## Common patterns

### Read a Google Doc

```bash
orbit navigate "https://docs.google.com/document/d/DOCID/edit"
orbit wait ".kix-appview-canvas" --timeout 8000
orbit text --selector ".kix-appview-canvas"
```

> If `orbit text` returns too much text, use `--selector` to narrow to a
> section, or pipe through `head -n 100`.

### Fill and submit a form

```bash
orbit fill "input[name='email']" "user@example.com"
orbit fill "input[name='message']" "Hello from Claude"
orbit click "button[type='submit']"
orbit wait ".success-message" --timeout 5000
orbit text --selector ".success-message"
```

### Iterate on a generated HTML artifact

```bash
# Write the artifact
cat > /tmp/prototype.html << 'EOF'
<!-- your HTML here -->
EOF

orbit navigate "file:///tmp/prototype.html"
orbit screenshot --out /tmp/prototype.png
# Review the screenshot, then iterate
```

### Verify a visual state

```bash
orbit screenshot --out /tmp/state.png
# The screenshot path is printed; share it with the user or inspect it
```

### Error recovery

If a selector fails:

1. Dump the DOM and inspect: `orbit dom | grep -i "keyword"`
2. Try a broader selector or `orbit eval "document.querySelector('...')?.textContent"`
3. Use `orbit wait <selector>` if the element might not be loaded yet

---

## Error semantics

- Non-zero exit code on failure
- Human-readable error message on `stderr`
- Retry navigation/timing failures up to 3 times before giving up

---

## Version compatibility

This skill is compatible with `orbit` version `^0.1.0`.

Check compatibility:
```bash
orbit --version   # must be >= 0.1.0, < 0.2.0
```

If the version doesn't match, ask the user to update the Orbit app.
