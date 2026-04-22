# Orbit — Roadmap

> Status legend: ✅ done · 🔄 in progress · ⬜ not started

---

## Stage 1 — Core Shell `🔄 In Progress`

**Exit criteria:** Geoff can open the app, get multiple terminal tabs, run Claude Code in them.

### Infrastructure & Scaffold
- [x] Repo scaffolded: electron-vite + React + Tailwind configured
- [x] TypeScript: split tsconfig (Node.js main / browser renderer)
- [x] electron-builder: universal macOS DMG config (arm64 + x64)
- [x] `asar` unpack for `node-pty` native module
- [x] macOS entitlements plist (hardenedRuntime)
- [x] All directory structure per §12 of brief
- [x] `shared/types.ts` — socket protocol types + IPC channel names
- [x] `shared/constants.ts` — paths, defaults, partition names

### Main Process
- [x] `electron/main.ts` — BrowserWindow, dark mode, IPC setup
- [x] `electron/preload.ts` — contextBridge PTY API exposed to renderer
- [x] `electron/pty-manager.ts` — node-pty pool, session lifecycle
- [ ] `electron/main.ts` — wire PTY title changes (OSC 2 → IPC)
- [ ] Smoke test: `npm run build` succeeds on macOS

### Renderer — Terminal
- [x] `renderer/App.tsx` — split layout, tab state, drag-resize
- [x] `renderer/components/TabBar.tsx` — tab list, new/close, active indicator
- [x] `renderer/components/TerminalPane.tsx` — multi-instance xterm.js, show/hide by tab
- [x] `renderer/hooks/useKeyboardShortcuts.ts` — ⌘T, ⌘W, ⌘1–9, ⌘⇧[/]
- [x] Dark xterm.js theme matching app palette
- [x] FitAddon + ResizeObserver wired up (terminal fills container, responds to resize)
- [ ] Tab title updated from PTY title changes (OSC 2 sequences from shell/vim/etc.)
- [ ] CWD tracking per tab (for Skills panel in Stage 4)

### Renderer — Shell & Polish
- [x] `renderer/components/BrowserPane.tsx` — placeholder with nav chrome
- [ ] Manual end-to-end test: launch app, open 3 tabs, run Claude Code, resize split

---

## Stage 2 — Browser Pane `⬜ Not Started`

**Exit criteria:** Geoff can log into Google once, reopen the app, still be logged in. Google Docs renders correctly.

- [ ] `electron/browser-manager.ts` — WebContentsView creation, attach to BrowserWindow
- [ ] Browser positioned and resized to match right pane (IPC ↔ renderer for bounds)
- [ ] Address bar in `BrowserPane.tsx` wired to real navigation state
- [ ] Back / forward / reload working
- [ ] Google SSO session persisted via `BROWSER_SESSION_PARTITION`
- [ ] Multiple browser tabs within the single browser pane
- [ ] Tab switcher UI in the browser pane header
- [ ] `electron/main.ts` — expose `browser:navigate`, `browser:state` IPC handlers

---

## Stage 3 — `orbit` Bridge `⬜ Not Started`

**Exit criteria:** From any terminal tab in the app, `orbit text` returns the contents of whatever's in the browser.

- [ ] `electron/cdp-bridge.ts` — implement all CDP commands (navigate, dom, text, click, fill, eval, screenshot, wait)
- [ ] `electron/socket-server.ts` — Unix socket server, JSON line-delimited protocol
- [ ] `cli/orbit.ts` — compile to executable (esbuild or `pkg`), test all commands
- [ ] `cli/install.sh` — verified on macOS
- [ ] `scripts/postinstall.ts` — called from `electron/main.ts` on first launch
- [ ] CLI symlink installation dialog on first launch
- [ ] End-to-end: Claude Code in terminal tab → `orbit text` → returns Google Doc text

---

## Stage 4 — Skills Context Panel `⬜ Not Started`

**Exit criteria:** Switching between tabs changes the sidebar contents to reflect that tab's project context.

- [ ] `electron/skills-scanner.ts` — CWD scan complete (SKILL.md, CLAUDE.md, .claude/skills)
- [ ] CWD tracking per PTY tab (chokidar or polling)
- [ ] `renderer/hooks/useSkillsContext.ts` — wired to IPC
- [ ] `renderer/components/SkillsPanel.tsx` — integrated into layout
- [ ] Brainstem.cc API query for personal context (optional, needs API key config)
- [ ] Skills panel collapses/expands

---

## Stage 5 — `orbit` Skill `⬜ Not Started`

**Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `orbit` to read a Google Doc.

- [x] `skill/SKILL.md` — authored per §10 of brief
- [x] `skill/examples/read-google-doc.md`
- [x] `skill/examples/fill-form.md`
- [x] `skill/examples/iterate-artifact.md`
- [ ] Version pinning: skill tests `orbit --version` matches compatible range
- [ ] Smoke test in CI: each example runs without error
- [ ] `scripts/postinstall.ts` — installs skill on first launch (verified)
- [ ] **Confirm working name "Orbit" with Geoff before skill is published** (§7 of brief)

---

## Stage 6 — Polish & Distribution `⬜ Not Started`

**Exit criteria:** A PM in the Trailblazers cohort can install and use without terminal setup.

- [ ] App icon (`.icns`) + branded DMG background
- [ ] Code signing — Apple Developer ID cert configured in CI
- [ ] Notarization — `electron-builder` + `notarytool` pipeline
- [ ] `electron-updater` — auto-update from GitHub Releases or S3
- [ ] Session restore on relaunch (terminal tabs, browser URL)
- [ ] Theming pass: Dark, dense, Warp × Linear aesthetic
- [ ] Notifications for agent-driven browser navigation
- [ ] Security: launch-time auth token on Unix socket (before wider distribution)
- [ ] README / install guide for Trailblazers cohort

---

## Open Questions (from §7 of brief)

| Question | Assumption Made | Needs Confirmation Before |
|---|---|---|
| App name | "Orbit" (coined by Claude, not Geoff) | Stage 5 (skill authoring) |
| Distribution scope | Personal → Trailblazers → broader | Stage 6 |
| Browser tab count | Multiple tabs in single pane | Stage 2 |
| Skills data sources | CWD scan + brainstem.cc | Stage 4 |
| Socket security | No auth for MVP | Stage 6 / broader distribution |
