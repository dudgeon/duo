# duo-ext — drive Chrome from a Duo terminal

> **Scope:** Chrome-extension exploration only. Phase 7 will fold
> these verbs into the main `cli/duo` binary; for now they live in
> `phase0/cli/duo-ext`. Symlinked into `~/.claude/bin/duo-ext` by
> `phase0/helper/install.sh` so you can call it directly from any
> terminal that has `~/.claude/bin/` on PATH.

You're an agent working inside a Duo PTY. The Duo Chrome extension
is installed and connected. You can drive the user's actual Chrome
tabs by running `duo-ext` verbs.

## When to reach for `duo-ext`

You're inside a terminal that's part of the Duo Chrome extension
side panel — you can tell because:

- The terminal opened from the side panel rail (folder + clock
  icons visible)
- `chrome://extensions/` shows "Duo" enabled (you can confirm via
  `duo-ext doctor`)
- The user is browsing Chrome alongside this terminal — the
  extension's job is to let you ride along

In that context, `duo-ext` lets you read Chrome's current state and
script tabs without the user having to context-switch. Same shape
as the main `duo` CLI but targets the user's actual Chrome instead
of an embedded surface.

If you're inside the Electron Duo app (you'd see an embedded
browser pane in your same window), use `duo` instead — that drives
the embedded surface. `duo-ext` works there too but talks to
Chrome, not the embedded pane.

## Verb cheat-sheet

| Verb | What it does |
|---|---|
| `duo-ext doctor` | Reports helper connectivity (Unix socket fast path + TCP fallback). Run first if anything's failing. |
| `duo-ext tabs` | Lists all open Chrome tabs as JSON. `DUO_FORMAT=human duo-ext tabs` for terse text. |
| `duo-ext open <url>` | Opens a new Chrome tab. Returns `{id, windowId, url}`. |
| `duo-ext close <id>` | Closes a tab by id. |
| `duo-ext activate <id>` | Brings a tab to focus. |
| `duo-ext title [tabId]` | Returns `document.title` for the active tab (or `tabId` if given). Uses `chrome.scripting`; no debugger banner. |
| `duo-ext script <body>` | Runs a JS function body in the active tab. Use for click / fill / read text. |
| `duo-ext eval <expr>` | Runs `Runtime.evaluate(expr)` via `chrome.debugger`. **Triggers the yellow "Duo started debugging" bar** — visible to the user, used only for ops the lighter `chrome.scripting` API can't do. |

## Examples

```bash
# What's the user looking at?
duo-ext tabs | jq -r '.[] | select(.active) | .url'

# Open an issue and confirm it loaded
duo-ext open https://github.com/dudgeon/duo/issues/27
sleep 1
duo-ext title  # → GitHub issue page title

# Click a "Sign in" link on the active tab
duo-ext script '(d) => d.querySelector("a[href*=signin]")?.click()'

# Read the page heading
DUO_FORMAT=human duo-ext script '(d) => d.querySelector("h1")?.textContent'

# Find page metrics via debugger CDP (yellow bar flashes)
duo-ext eval 'JSON.stringify(performance.getEntriesByType("navigation")[0])'
```

## Sandbox behavior

`duo-ext` works inside Claude Code's bash sandbox. It tries the
helper's Unix socket first (`~/Library/Application Support/Duo/duo-helper.sock`);
on `EPERM` / `ECONNREFUSED` / timeout it reads
`~/Library/Application Support/Duo/duo-helper.port` and reconnects
over TCP `127.0.0.1` with an auth token. The TCP path passes the
sandbox's network filter. No agent-side configuration needed.

## Failure modes

- **`error: ~/Library/Application Support/Duo/duo-helper.port`
  missing** — the Duo extension isn't running. Ask the user to
  reload the extension at `chrome://extensions/`.
- **`✗ no active tab`** — Chrome isn't focused or has no tabs.
- **`✗ tab #N CDP eval threw`** — the expression you passed to
  `eval` raised. Wrap it in `try { ... } catch(e){ return null }`
  if that's expected.
- **Yellow "Duo started debugging" bar persists** — should auto-
  disappear after `duo-ext eval` returns, but if you see it stuck,
  call `duo-ext eval '1'` again (the helper's `finally` block will
  detach the debugger). Filed as a known gotcha.

## What you cannot do (yet)

These are scoped out for the exploration phase; Phase 7+ may add:

- **Screenshots.** No `duo-ext screenshot`. Add via `chrome.tabs.captureVisibleTab`
  in a future verb.
- **Network interception.** Need `chrome.debugger` Network domain;
  works with the existing `eval` primitive but no convenience verb yet.
- **Multi-tab parallelism.** `duo-ext` is one-shot per invocation;
  you'd need to script multiple verbs sequentially.
- **Selector matching.** No `duo-ext click <css-selector>` syntactic
  sugar; use `script '(d) => d.querySelector(sel).click()'` for now.

## Migration note

When Phase 7 ships, `duo-ext` collapses into `cli/duo`:

- `duo-ext tabs` → `duo chrome:tabs`
- `duo-ext title` → `duo chrome:title`
- `duo-ext eval '1+1'` → `duo chrome:eval '1+1'`

The `chrome:` prefix routes through the extension; `embedded:` routes
through Electron's embedded browser; bare verbs auto-target whichever
surface is adjacent to the calling terminal. The strategy doc at
`docs/research/duo-as-chrome-extension/distribution-strategy.md`
covers the rationale.
