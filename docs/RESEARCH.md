# Orbit — Research Notes

> Findings that informed decisions during the planning and build phases.
> Not a living document — update when new research changes a decision.

---

## Electron WebContentsView (Stage 2)

**Status:** Researched, not yet implemented.

`WebContentsView` was introduced in Electron 28 as the replacement for
the deprecated `BrowserView`. Key properties:

- Created via `new WebContentsView({ webPreferences: { ... } })`
- Attached to a `BrowserWindow` via `window.contentView.addChildView(view)`
- Positioned by setting `view.setBounds({ x, y, width, height })`
- Shares the window's visual layer; does NOT appear inside the renderer HTML

**Implementation pattern for Stage 2:**

```typescript
// In main process
const view = new WebContentsView({
  webPreferences: {
    partition: BROWSER_SESSION_PARTITION
  }
})
mainWindow.contentView.addChildView(view)
view.setBounds({ x: splitX, y: tabBarH, width: rightPaneW, height: contentH })
```

**Bounds synchronization:** The renderer knows the split position and tab bar
height. It must IPC the bounds to the main process whenever either changes.
The main process repositions the view accordingly.

**SSO persistence:** The `partition` string must be prefixed with `persist:`
for the session to survive app restarts. The session data lives at
`~/Library/Application Support/<appName>/<partition-name>/`.

---

## Chrome DevTools Protocol via `webContents.debugger` (Stage 3)

**Status:** Researched, not yet implemented.

Electron exposes CDP via the `webContents.debugger` API. No external Chrome
connection needed.

```typescript
const dbg = webContents.debugger
dbg.attach('1.3')
dbg.on('message', (_, method, params) => { ... })
const result = await dbg.sendCommand('Runtime.evaluate', {
  expression: 'document.body.innerText',
  returnByValue: true
})
```

**Key CDP domains for the orbit CLI surface:**

| orbit command | CDP method |
|---|---|
| `navigate` | `Page.navigate` |
| `dom` | `DOM.getOuterHTML` (or `Runtime.evaluate` on `document.documentElement.outerHTML`) |
| `text` | `Runtime.evaluate` on `document.body.innerText` |
| `click` | `DOM.querySelector` + `Input.dispatchMouseEvent` |
| `fill` | `DOM.querySelector` + `Input.insertText` or `Runtime.evaluate` |
| `eval` | `Runtime.evaluate` |
| `screenshot` | `Page.captureScreenshot` |
| `wait` | Poll `DOM.querySelector` until element found or timeout |

**Large DOM issue:** `orbit dom` on a long Google Doc will return a very large
string. The brief flags this as a known risk (§14). Mitigations to implement:
- `orbit text --max-chars N` to truncate
- `orbit text --save-to <file>` to write to disk instead of stdout
- Encourage `--selector` narrowing in the skill docs

---

## Google SSO in Electron Chromium

**Status:** Analyzed, not yet tested.

Google detects headless/automated Chromium via `navigator.webdriver`. Electron
sets this to `false` by default (unlike Puppeteer), so standard Google SSO
should work without spoofing.

**Potential issue:** Google may challenge login if the user-agent doesn't match
a stable Chrome release. Electron ships with a Chrome user-agent that includes
`Electron/X.Y.Z` — this has historically not caused Google SSO issues, but
should be tested in Stage 2.

**Mitigation if needed:**
```typescript
// In main process, override UA to match stable Chrome:
view.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36')
```

The session partition persists cookies, localStorage, and IndexedDB — so once
logged in, Google stays logged in across app restarts.

---

## node-pty native module rebuild

**Status:** Known requirement, automated in `postinstall`.

`node-pty` includes a native `.node` file compiled against a specific Node.js
ABI. Electron ships its own Node.js with a different ABI, so the module must be
rebuilt against the Electron version being used.

**Automated via:**
```json
// package.json
"postinstall": "electron-rebuild"
```

**In CI:** add `npx electron-rebuild` after `npm install`.

**In electron-builder:** `asarUnpack: ["**/node_modules/node-pty/**"]` ensures
the native module is accessible at runtime (asar cannot contain native `.node` files).

---

## xterm.js v5 package changes

**Status:** Breaking change from `xterm` → `@xterm/xterm` at v5.5.

The xterm.js project moved to a scoped `@xterm` namespace in v5.5. Addons
similarly moved:

| Old package | New package |
|---|---|
| `xterm` | `@xterm/xterm` |
| `xterm-addon-fit` | `@xterm/addon-fit` |
| `xterm-addon-web-links` | `@xterm/addon-web-links` |
| `xterm-addon-unicode11` | `@xterm/addon-unicode11` |

The API is identical — only the import paths changed. This project uses the
new `@xterm/*` packages throughout.

---

## Brainstem.cc API (Stage 4)

**Status:** Not yet researched — needed for Stage 4.

Geoff's personal MCP server at brainstem.cc provides cross-session context.
For Stage 4, the skills scanner should optionally query it for context relevant
to the active CWD.

**Open questions:**
- Is there a REST API, or only MCP protocol?
- What auth is needed (API key, OAuth)?
- What does a "relevant context for CWD" query look like?

**Action:** Ask Geoff for brainstem.cc API docs before implementing Stage 4.
