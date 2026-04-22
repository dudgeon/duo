# Duo — Roadmap

> Status legend: ✅ done · 🔄 in progress · ⬜ not started

---

## Stage 1 — Core Shell `🔄 In Progress`

**Exit criteria:** Geoff can open the app, get multiple terminal tabs, run Claude Code in them.

### Infrastructure & Scaffold ✅
- [x] Repo scaffolded: electron-vite + React + Tailwind configured
- [x] TypeScript: split tsconfig (tsconfig.node.json for main/CLI, tsconfig.web.json for renderer)
- [x] electron-builder: universal macOS DMG config (arm64 + x64)
- [x] `asar: true` + `asarUnpack` for node-pty native module
- [x] macOS entitlements plist (hardenedRuntime)
- [x] All source directories per §12 of brief
- [x] `shared/types.ts` — DuoRequest/Response/CommandName, IPC channel map, ElectronAPI surface
- [x] `shared/constants.ts` — main-process paths (socket, session partition, skill install dir)

> **Learning:** `shared/constants.ts` uses Node.js `os`/`path` — renderer components
> must not import it directly. Renderer-safe values (e.g. scrollback) are defined inline.

### Main Process ✅
- [x] `electron/main.ts` — BrowserWindow (1440×900, dark, `hiddenInset` titlebar), dark mode forced, IPC setup
- [x] `electron/preload.ts` — contextBridge PTY API: create/write/resize/kill/onData/onExit/onTitle
- [x] `electron/pty-manager.ts` — node-pty session pool keyed by tab UUID; data/exit IPC events

### Renderer — Terminal ✅ (awaiting macOS test)
- [x] `renderer/App.tsx` — split layout, tab state management, drag-to-resize (20–80% range)
- [x] `renderer/components/TabBar.tsx` — tab list, ×close, +new, active indicator
- [x] `renderer/components/TerminalPane.tsx` — one xterm.js instance per tab, hidden (not unmounted) on switch, FitAddon + ResizeObserver, OSC title → `onTitleChange`
- [x] `renderer/hooks/useKeyboardShortcuts.ts` — ⌘T (new), ⌘W (close), ⌘1–9 (jump), ⌘⇧[/] (cycle)
- [x] Custom xterm.js dark theme (Zinc/Tailwind palette, purple cursor)
- [x] Tab title driven by OSC 2 sequences from the running shell

### Renderer — Browser Placeholder ✅
- [x] `renderer/components/BrowserPane.tsx` — placeholder with disabled address bar chrome

### Remaining for Stage 1
- [ ] `npm install` + `npm run dev` on macOS — first real smoke test
- [ ] Verify node-pty rebuilds correctly via `postinstall` / `electron-rebuild`
- [ ] CWD tracking per PTY tab (needed by Stage 4 skills panel)
- [ ] Handle "last tab closed" gracefully (currently prevented; may want to open fresh tab instead)

---

## Stage 2 — Browser Pane `⬜ Not Started`

**Exit criteria:** Geoff can log into Google once, reopen the app, still be logged in. Google Docs renders correctly.

### Stub in place
- [x] `electron/browser-manager.ts` — typed interface, all methods stubbed
- [x] `renderer/components/BrowserPane.tsx` — address bar + nav button chrome (disabled)
- [x] `renderer/components/AddressBar.tsx` — URL input with edit/commit/escape behavior

### To implement
- [ ] `BrowserManager`: WebContentsView creation, attach to `mainWindow.contentView`
- [ ] Bounds synchronization: renderer IPC → main repositions the view on split resize / window resize
- [ ] Navigation wired: `duo navigate`, back/forward/reload IPC handlers
- [ ] Address bar showing live URL and title
- [ ] Google SSO session persisted via `BROWSER_SESSION_PARTITION` (`persist:duo-browser`)
- [ ] Multiple browser tabs within the single browser pane
- [ ] `browser:navigate` + `browser:state` IPC channels in main.ts

> **Note:** WebContentsView is a main-process construct positioned *over* the renderer
> window — the renderer has no direct DOM access to it. Bounds must be sent via IPC
> whenever the split position or window size changes.

---

## Stage 3 — `duo` Bridge `⬜ Not Started`

**Exit criteria:** From any terminal tab in the app, `duo text` returns the contents of whatever's in the browser.

### Already authored
- [x] `cli/duo.ts` — full command dispatch (all 13 commands), socket transport, timeout, help text, error handling
- [x] `cli/install.sh` — symlink to `/usr/local/bin/duo` or `~/.local/bin/duo`
- [x] `electron/socket-server.ts` — stub with correct protocol docs, types wired
- [x] `electron/cdp-bridge.ts` — stub with all method signatures + CDP domain notes

### To implement
- [ ] `CdpBridge`: attach debugger, implement all CDP commands (navigate, dom, text, click, fill, eval, screenshot, wait)
- [ ] `SocketServer`: listen on `SOCKET_PATH`, dispatch to CdpBridge, respond with DuoResponse
- [ ] Wire `SocketServer` startup into `electron/main.ts`
- [ ] Compile `cli/duo.ts` to executable (esbuild `--bundle --platform=node`, or `pkg`)
- [ ] `scripts/postinstall.ts` called from main on first launch: install skill + CLI symlink
- [ ] CLI symlink installation dialog (AppleScript or Electron dialog) on first launch

> **Note for large DOM:** `duo dom` on a long Google Doc can produce a very large string.
> Plan to add `duo text --max-chars N` and `duo text --save-to <file>` options before Stage 5.

---

## Stage 4 — Skills Context Panel `⬜ Not Started`

**Exit criteria:** Switching between tabs changes the sidebar contents to reflect that tab's project context.

### Stub in place
- [x] `electron/skills-scanner.ts` — CWD scan logic for SKILL.md, CLAUDE.md, .claude/skills
- [x] `renderer/components/SkillsPanel.tsx` — UI component (not yet in layout)
- [x] `renderer/hooks/useSkillsContext.ts` — stub, returns empty

### To implement
- [ ] CWD tracking per PTY tab (chokidar or PWD polling via `echo $PWD`)
- [ ] `skills:scan` IPC handler in main.ts; `useSkillsContext` wired to IPC
- [ ] `SkillsPanel` integrated into App layout (collapsible third column on right)
- [ ] Brainstem.cc API query (**requires API key and endpoint from Geoff**)

---

## Stage 5 — `duo` Skill `⬜ Not Started`

**Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `duo` to read a Google Doc.

### Already authored
- [x] `skill/SKILL.md` — when to use, command reference, common patterns, error recovery, version pinning
- [x] `skill/examples/read-google-doc.md`
- [x] `skill/examples/fill-form.md`
- [x] `skill/examples/iterate-artifact.md`

### To implement
- [ ] Version pinning: skill asserts `duo --version` is in compatible range
- [ ] Smoke test: each example command runs in CI (needs real app running; may be manual)
- [ ] Postinstall verified: skill copied to `~/.claude/skills/duo/` on first launch

---

## Stage 6 — Polish & Distribution `⬜ Not Started`

**Exit criteria:** A PM in the Trailblazers cohort can install and use without terminal setup.

- [ ] App icon (`build/icon.icns`) + branded DMG background
- [ ] Code signing — Apple Developer ID (**needs cert from Geoff**)
- [ ] Notarization — `notarytool` via electron-builder
- [ ] `electron-updater` — auto-update from GitHub Releases or private S3
- [ ] Session restore on relaunch (terminal CWDs, browser URL, split position)
- [ ] Security: launch-time auth token written to socket on startup (before Trailblazers)
- [ ] Theming pass: refine the Warp × Linear feel
- [ ] Notifications for agent-driven browser navigation changes
- [ ] README + install guide for Trailblazers cohort

---

## Open Questions

| Question | Needed Before | Status |
|---|---|---|
| Brainstem.cc API endpoint + auth | Stage 4 | ❓ pending |
| Apple Developer ID cert | Stage 6 | ❓ pending |
| Distribution timeline (personal → Trailblazers) | Stage 6 | ❓ pending |
| Socket auth approach for Trailblazers | Stage 6 | ❓ pending |
| `duo` CLI distribution format (compiled binary vs Node.js script?) | Stage 3 | ❓ pending |
