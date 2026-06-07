# Patterns — browser pane

How to read, fill, and drive the live embedded browser, and how to show
the user a generated HTML artifact in a browser tab. For diagnosing a
`duo click` / `duo eval` that didn't do what you expected, see
[debugging.md](debugging.md).

## Contents

- [Read an ordinary DOM page](#read-an-ordinary-dom-page)
- [Fill and submit a form](#fill-and-submit-a-form)
- [Show the user a generated HTML artifact](#show-the-user-a-generated-html-artifact-show-me-x--open-that)
- [Diagnose a failing interaction](#diagnose-a-failing-interaction)

## Read an ordinary DOM page

```bash
duo navigate "https://example.com"
duo text                      # or: duo text --selector "article"
```

Use `duo text` for classic DOM-rendered pages — it's simpler than `ax` and
plenty accurate.

## Fill and submit a form

```bash
duo fill 'input[name="email"]' "user@example.com"
duo fill 'input[name="message"]' "Hello"
duo click 'button[type="submit"]'
duo wait ".success" --timeout 5000
duo text --selector ".success"
```

## Show the user a generated HTML artifact ("show me X" / "open that")

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
change, rewrite the same file and reload — either by re-running
`duo navigate` (finds the open tab by URL match and focuses
it, then a `duo reload` refreshes contents), or by calling `duo reload`
directly while the artifact tab is active:

```bash
# rewrite /tmp/countdown.html with the new styles…
duo navigate "file:///tmp/countdown.html"   # focuses existing tab if it matches
duo reload                                  # refreshes its contents
```

**When to use `duo open` vs `duo navigate`:**

- `duo open <path-or-url>` — first load of a new artifact, or any time
  you want a fresh tab. Use this for "show me X" and "open that".
- `duo navigate <url>` — opens the URL in a NEW tab, or
  focuses an existing matching tab. Does not clobber the active tab.
  Use this for switching the browser pane to a known URL without
  losing wherever the user has been browsing.

`duo open` accepts the same URL schemes as `duo navigate` (http(s),
file, about, data, etc.), plus local file paths with `~/` or relative
paths — path resolution happens client-side.

## Diagnose a failing interaction

If a `duo click` or `duo eval` doesn't produce the expected result, the
page probably logged a warning, threw an uncaught exception, or returned
a non-2xx from an API. The console/errors/network triage playbook lives
in [debugging.md § Diagnose a failing interaction with the page](debugging.md#diagnose-a-failing-interaction-with-the-page).
