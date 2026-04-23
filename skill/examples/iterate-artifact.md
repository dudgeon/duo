# Example: Generate, open, and iterate on an HTML artifact

**Scenario:** the user says "show me a countdown timer for 5 minutes",
"make me a quick data visualizer", or similar — anything where the
answer is a small interactive HTML page, not text. Claude generates
the HTML, opens it in a new browser tab with `duo open`, optionally
verifies it works, and iterates in place.

## First load — `duo open`

```bash
# 1. Write the artifact
cat > /tmp/duo-countdown.html << 'EOF'
<!doctype html>
<html>
<head><title>Countdown</title></head>
<body>
  <div id="t">05:00</div>
  <button id="start">Start</button>
  <script>/* … countdown logic … */</script>
</body>
</html>
EOF

# 2. Open in a new tab (becomes active)
duo open /tmp/duo-countdown.html
# → { ok: true, id: 2, url: "file:///tmp/duo-countdown.html", title: "Countdown" }
```

After `duo open`, the new tab is the active one, so every subsequent
`duo` command targets it — no extra plumbing.

## Verify it works before handing back to the user

For anything interactive, a quick sanity check saves the user from
seeing broken code:

```bash
duo eval "document.getElementById('t').textContent"   # → "05:00"
duo click "#start"
sleep 2
duo eval "document.getElementById('t').textContent"   # → "04:58" (or similar)
duo click "#reset"                                      # back to 05:00
```

If the page throws during load or a handler errors, `duo console
--since <ts> --level error,warn` will surface it.

## Iterate in place — `duo navigate <same-url>`

When the user asks for a change ("make the font bigger", "use red for
the reset button"), rewrite the same file and reload the active tab:

```bash
# rewrite /tmp/duo-countdown.html with the tweak, then:
duo navigate "file:///tmp/duo-countdown.html"
# the active tab IS the countdown tab, so this reloads in place —
# no tab clutter
```

## Screenshots for headless review

If the user is looking elsewhere or the artifact is complex, grab a
screenshot as evidence:

```bash
duo screenshot --out /tmp/duo-countdown.png
# then: Read /tmp/duo-countdown.png  (pulls the image into context)
```

## `duo open` vs `duo navigate`

| Command | When |
|---|---|
| `duo open <path-or-url>` | First load of a new artifact, or any time you want a fresh tab. "Show me X" / "open that" live here. |
| `duo navigate <url>` | Reload the current artifact in place, or move an existing tab to a different URL. |

`duo open` accepts local file paths (absolute, `~/…`, or relative to
the caller's CWD) and any URL scheme. Path resolution is done by the
CLI; the socket always receives a fully-resolved URL.

## Tips

- Prefer self-contained single-file HTML (inline CSS + JS) — keeps the
  prototype trivially portable and doesn't require you to also host
  assets.
- For artifacts that need to fetch data, use `fetch()` inside the
  page; the CORS rules apply, but same-origin to `file://` is almost
  unrestricted within the Electron browser.
- If the prototype needs to persist state, use `localStorage` —
  Electron's browser partition persists across restarts.
- Name your generated files with something unique (`/tmp/duo-<topic>-
  <timestamp>.html`) so iterating on multiple artifacts doesn't clash.
