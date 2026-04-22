# Duo — First Run Procedures

> Follow these steps in order when you get home.
> Each section has a clear pass/fail check. Do not skip sections.

---

## Prerequisites

| Requirement | Check |
|---|---|
| macOS 13 Ventura or later | `sw_vers` |
| Xcode Command Line Tools | `xcode-select -p` → should print a path |
| Node.js ≥ 20 | `node --version` → should print `v20.x.x` or higher |
| npm ≥ 10 | `npm --version` |
| Git | `git --version` |

If Node.js is missing: install via `brew install node` or `nvm install 20`.

---

## Step 1 — Install dependencies

```bash
cd ~/duo          # or wherever you cloned the repo
npm install
```

**What to expect:**
- npm downloads all packages (first run takes 1–3 minutes)
- At the end, `electron-rebuild` runs automatically (the `postinstall` hook)
- You'll see output like `⠦ Rebuilding native modules` then `✔ Rebuild Complete`
- No red `ERR!` lines

**If `electron-rebuild` fails:**
```bash
# Make sure Xcode CLT are current
xcode-select --install
# Then retry
npm run postinstall
```

**If you see `node-pty` errors specifically:**
```bash
# Check that the right node version is active
node --version     # must match the Electron version's Node ABI
npm rebuild node-pty
```

**Pass check:** `ls node_modules/node-pty/build/Release/*.node` should show a `.node` file.

---

## Step 2 — Launch in dev mode

```bash
npm run dev
```

**What to expect:**
- Vite starts the renderer dev server (usually on port 5173)
- Electron launches and shows the Duo window (1440×900, dark background)
- The window has a tab bar at the top and a terminal pane on the left
- The browser pane on the right shows the address bar but the content area is blank (the WebContentsView is attached but shows nothing until you navigate)
- No crash dialog, no red console errors

**If the window never appears:**
1. Check the terminal for a stack trace — paste it to troubleshoot
2. Try `npm run build && npm run preview` as an alternative

**If you see `Error: cannot find module 'node-pty'`:**
```bash
npm run postinstall   # re-triggers electron-rebuild
npm run dev
```

**Pass check:** Duo window appears. Tab bar visible. Terminal cursor blinks in the first tab.

---

## Step 3 — Test terminal tabs

Inside the Duo window:

| Action | Expected result |
|---|---|
| Press `⌘T` | New tab appears in the tab bar |
| Press `⌘W` | Current tab closes (keeps at least one) |
| Press `⌘1` / `⌘2` | Switches to that tab number |
| Type `echo hello` in a terminal, press Enter | `hello` prints |
| Type `ls` | Directory listing appears |
| Resize the window | Terminal re-flows correctly |
| Drag the divider between terminal and browser panes | Split adjusts (20–80% range) |

**Pass check:** All rows above work without errors.

---

## Step 4 — Test browser pane

In the address bar (right pane, at the top):

| Action | Expected result |
|---|---|
| Click the address bar | It becomes editable |
| Type `google.com` and press Enter | Browser navigates to `https://google.com` |
| Back button becomes active | Click it → goes back to `about:blank` |
| Forward button becomes active | Click it → goes to google.com again |
| Type a search term (no `.` in it) | Navigates to `https://www.google.com/search?q=...` |
| Navigate to `docs.google.com` and sign in | SSO session saves to the persistent partition |
| Close and reopen the app | Sign-in session is preserved (no login prompt) |

**If the browser pane shows nothing / stays blank:**
1. Confirm the address bar navigation fires (check DevTools: `View → Toggle Developer Tools` on the renderer)
2. Look for `[BrowserManager]` or `[CdpBridge]` errors in the Electron main process console (the terminal where you ran `npm run dev`)

**Pass check:** Google loads. Navigating back/forward works. Sign-in persists on relaunch.

---

## Step 5 — Build and install the CLI binary

```bash
npm run build:cli
```

**What to expect:**
- esbuild bundles `cli/duo.ts` into `cli/duo` (a single self-contained JS file with a shebang)
- Takes about 1 second

```bash
# Verify
file cli/duo              # should say "... ASCII text executable"
node cli/duo --version    # should print 0.1.0
```

Install it so it's on your PATH:
```bash
node cli/duo install
```

**What to expect:**
- Prints `Installed: /usr/local/bin/duo → /path/to/cli/duo`
- If `/usr/local/bin` is not writable: `sudo node cli/duo install`

Verify:
```bash
which duo          # should print /usr/local/bin/duo
duo --version      # should print 0.1.0
```

**Pass check:** `duo --version` returns `0.1.0` from any directory.

---

## Step 6 — End-to-end CLI test

With the Duo app running and `duo` installed:

### 6a. Basic read commands

```bash
duo url              # → about:blank (or current URL)
duo title            # → page title
```

Navigate the browser to google.com via the address bar, then:

```bash
duo url              # → https://www.google.com/
duo title            # → Google
duo text             # → visible text content of the page
```

**Expected:** Each command returns in under 2 seconds with sensible output.

### 6b. Navigate via CLI

```bash
duo navigate https://example.com
duo url              # → https://www.example.com/
duo title            # → Example Domain
duo text             # → This domain is for use in illustrative examples...
```

### 6c. DOM inspection

```bash
duo dom | head -100  # → first 100 lines of the page HTML
duo text --selector h1   # → text of the first <h1> element
```

### 6d. Click and fill

Navigate to a search page that has a visible input:
```bash
duo navigate https://duckduckgo.com
duo fill 'input[name="q"]' 'Claude AI'
duo click 'input[type="submit"]'
duo url              # → https://duckduckgo.com/?q=Claude+AI...
```

### 6e. Screenshot

```bash
duo screenshot --out /tmp/duo-test.png
open /tmp/duo-test.png    # should open the screenshot in Preview
```

### 6f. Tab management

```bash
duo tabs             # → JSON array with one tab (id: 1)
```

### 6g. Wait for element

```bash
duo navigate https://example.com
duo wait h1 --timeout 5000   # → {"ok":true}
```

### 6h. Eval

```bash
duo eval 'document.title'    # → "Example Domain"
duo eval '1 + 1'             # → 2
```

**Pass check:** All commands above return expected output without errors.

---

## Step 7 — Verify CLI error handling

With the Duo app **closed**:

```bash
duo url
```

**Expected:** `duo: Cannot connect: Duo app is not running.` on stderr, exit code 1.

**Pass check:** Graceful error, no crash or hung process.

---

## Step 8 — Verify session persistence

1. Navigate to `mail.google.com` in the Duo browser pane and sign into your Google account
2. Quit the Duo app (`⌘Q`)
3. Relaunch: `npm run dev`
4. Check the browser pane — it should show Gmail **without** prompting for login

**If it asks for login again:**
- Check that `BROWSER_SESSION_PARTITION = 'persist:duo-browser'` is set in `shared/constants.ts`
- Verify the session data dir: `ls ~/Library/Application\ Support/duo/`
  - Should contain a `browser-session` folder (or Electron's default Chromium profile storage)

**Pass check:** Gmail loads without login after relaunch.

---

## Step 9 — Type-check the codebase

```bash
npm run typecheck
```

**Expected:** No errors. (Warnings about Electron's deprecated `canGoBack()` are acceptable — they'll be fixed before Stage 6.)

**Pass check:** Zero TypeScript errors.

---

## Step 10 — Update the roadmap

Open `ROADMAP.md` and check off the completed items:

```
- [x] BrowserManager: create WebContentsView, attach to window.contentView
- [x] Bounds sync: renderer → IPC → main
- [x] Navigation: address bar commits, back/forward/reload wired
- [x] SSO persistence via BROWSER_SESSION_PARTITION
- [x] browser:navigate + browser:state IPC channels in main.ts
- [x] CdpBridge: implement all CDP commands via webContents.debugger
- [x] SocketServer: listen on SOCKET_PATH, dispatch to CdpBridge
- [x] Wire SocketServer startup into electron/main.ts
- [x] Add esbuild script to compile cli/duo.ts → binary in cli/duo
- [x] End-to-end: duo text returns page content from terminal tab
```

---

## Known issues / things to investigate if something breaks

### "WebContentsView is not a constructor"
- Means Electron version is below 29. Check `node_modules/electron/dist/Electron.app` → Get Info → version
- Fix: `npm install electron@latest`

### Address bar shows URL but browser content stays blank
- The WebContentsView bounds aren't being set correctly
- Open DevTools on the renderer (`View → Toggle Developer Tools`)
- Watch for `browser:bounds` IPC calls in the Network/IPC tab
- Also check: is the split pane giving the browser div any space? (Try dragging the divider right)

### `duo` commands hang and time out
- The socket server isn't starting. Check the Electron console for `[SocketServer] error:`
- Check if a stale socket file exists: `ls ~/Library/Application\ Support/duo/duo.sock`
- If it does, delete it and restart the app: `rm ~/Library/Application\ Support/duo/duo.sock`

### `duo screenshot` returns blank/white image
- Make sure `Page.enable` is being called on CDP attach — already done in CdpBridge.attach()
- Try navigating to a real page first before screenshotting

### Google Docs shows blank / doesn't render
- This is a known Chromium rendering quirk in some Electron versions when `contextIsolation: true`
- First try: reload the page from the address bar
- If persistent: check if `webSecurity: false` helps (temporary debug only — do not ship)

### `npm run typecheck` errors about `canGoBack` deprecation
- Electron 32 deprecated `webContents.canGoBack()` in favor of `webContents.navigationHistory.canGoBack()`
- Non-breaking for now; update in a follow-up commit before Stage 6

---

## What comes next (Stage 4)

After all 10 steps above pass:

1. **CWD tracking per tab** — emit `cwd` updates from PTY via shell precmd hook or polling
2. **Skills scanner** — scan the active tab's CWD for SKILL.md / CLAUDE.md / `.claude/skills/`
3. **Skills panel** — collapsible right sidebar showing available skills

Ping in chat when Stage 3 tests pass and we'll move to Stage 4.
