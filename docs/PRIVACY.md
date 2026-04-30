# Duo — Privacy Policy

> **Last updated:** 2026-04-30. Effective on first publication of
> the Duo for Chrome extension to the Chrome Web Store. Applies to
> Duo for Chrome (the browser extension), Duo Desktop (the macOS
> Electron app), and the Duo CLI.

## TL;DR

**Duo does not collect any data.** Everything runs locally on your
computer. There are no servers, no analytics, no telemetry, no
trackers. The only network connections Duo initiates are to GitHub
(for app self-update via electron-updater).

## What we don't do

- We do not run any servers that receive your data.
- We do not collect, log, transmit, or sell user data of any kind.
- We do not have analytics frameworks (no Google Analytics,
  PostHog, Mixpanel, Sentry, etc.).
- We do not track usage patterns, feature adoption, or session
  duration.
- We do not embed third-party fingerprinting, advertising, or
  attribution code.
- We do not transmit page content, terminal output, file content,
  or any other personal data to any remote endpoint.

## What runs locally

### Duo Desktop (the macOS app)

- Spawns local PTY (terminal) processes via `node-pty`.
- Reads and writes files in directories you choose.
- Embeds a Chromium browser pane (visits whatever sites you
  navigate to).
- Listens on a Unix domain socket and a localhost TCP port for
  CLI requests.
- Self-updates via electron-updater, which fetches release
  artifacts from GitHub.

Nothing else.

### Duo for Chrome (the browser extension)

- Connects to Duo Desktop running locally on your computer via
  Chrome's Native Messaging protocol (`chrome.runtime.connectNative`).
- Reads page content, tab lists, and document state from your
  Chrome via `chrome.tabs`, `chrome.scripting`, and
  `chrome.debugger` APIs.
- Forwards that data to Duo Desktop running on your computer
  (Native Messaging is a local-only stdio channel; no network
  involved).

The Native Messaging connection between Chrome and Duo Desktop is
purely local — it cannot reach the internet. Chrome creates a
process pipe to a binary you've registered as the Native Messaging
host and forwards JSON messages over its stdin/stdout. There is
no IP address, port, or socket in this path.

### The CLI (`duo` / `duo-ext`)

- Connects to Duo Desktop's local socket (Unix or TCP `127.0.0.1`).
- Sends agent verbs; receives results.

That's the entire scope.

## What Chrome considers "user data"

Chrome's Web Store policy categorizes the following as user data
even though, in Duo's case, none of it leaves your machine:

- **Page content** of tabs you visit (via `chrome.scripting`).
- **Tab metadata** — URLs, titles, IDs (via `chrome.tabs`).
- **Active tab state** when the user invokes an agent verb.

Duo for Chrome reads these only to forward them to the local Duo
Desktop application. The data never traverses the internet, never
touches any server we operate, and is not retained beyond the
in-flight request that requested it.

We don't access:

- Cookies (we don't request the `cookies` permission)
- Browser history (the Chrome history; Duo Desktop maintains its
  own URL history for the embedded browser, stored locally at
  `~/.claude/duo/browser-history.json`)
- Passwords, autofill data, or saved form entries
- Other extensions' data
- File downloads from your browser
- Your account information

## Data flow diagram

```
[Chrome tab]                            [Your file system]
     │                                        │
     │ chrome.scripting / chrome.tabs         │ fs.read / fs.write
     ▼                                        ▼
[Duo for Chrome ext.] ── NM stdio ── [Duo Desktop app]
                                              │
                                              │ Unix sock / 127.0.0.1
                                              ▼
                                        [duo CLI in PTY]

         All edges are local. Nothing crosses the network.
```

The only network connection Duo initiates:

```
[Duo Desktop] ── HTTPS ── [github.com/dudgeon/duo/releases/...]
              for self-update via electron-updater (Stage 21c)
```

## What you can verify

The source code is open: https://github.com/dudgeon/duo. Audit
exactly what runs:

- `electron/` — Duo Desktop main process
- `phase0/extension/` (eventual `extension/` per Phase 8) — Chrome
  extension source
- `phase0/helper/` (eventual `nm-shim/`) — Native Messaging shim
- `cli/` — CLI sources

Search for any `fetch(`, `XMLHttpRequest`, or `WebSocket` and you
will find only:

- The electron-updater self-update path
- xterm.js's localhost-only WebSocket fallback (vendored in
  `phase0/extension/vendor/`, not used in production)

## Uninstalling

Removes everything Duo touched:

```bash
# Duo Desktop
rm -rf "/Applications/Duo.app"
rm -rf "$HOME/.claude/duo"
rm -rf "$HOME/Library/Application Support/duo"
rm -rf "$HOME/Library/Application Support/Duo"

# CLI
rm -f "$HOME/.claude/bin/duo"
rm -f "$HOME/.claude/bin/duo-ext"

# Skill files
rm -rf "$HOME/.claude/skills/duo"
rm -f "$HOME/.claude/agents/duo.md"

# Chrome extension
# In Chrome: chrome://extensions/ → Duo for Chrome → Remove
```

Once uninstalled, no Duo data persists anywhere. There's nowhere
for it to persist *to* — the extension and app are pure local
software with no remote backend.

## Changes to this policy

If we ever change this policy in a way that could affect how data
is handled (e.g., adding optional remote services, opt-in
analytics), we will:

- Bump the "Last updated" date at the top.
- Document the change in this file's git history (commits in
  `docs/PRIVACY.md`).
- Notify users via an in-app banner before the change takes effect.

For users running an older version: Duo Desktop's self-update is
opt-in. If you decline updates, the version you have is the
version that applies.

## Contact

- Issues: https://github.com/dudgeon/duo/issues
- Questions: dudgeon@gmail.com

## Open source

Duo is GPL-3.0 licensed. You can fork, audit, modify, and
redistribute the code under the GPL terms. See the repository's
LICENSE file.
