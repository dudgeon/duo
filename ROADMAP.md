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
> must not import it directly. Renderer-safe values are defined inline.

### Main Process ✅
- [x] `electron/main.ts` — BrowserWindow (1440×900, dark, `hiddenInset` titlebar), IPC setup
- [x] `electron/preload.ts` — contextBridge PTY API: create/write/resize/kill/onData/onExit/onTitle
- [x] `electron/pty-manager.ts` — node-pty session pool keyed by tab UUID; data/exit IPC events

### Renderer — Terminal ✅ (awaiting macOS test)
- [x] `renderer/App.tsx` — split layout, tab state, drag-to-resize (20–80%)
- [x] `renderer/components/TabBar.tsx` — tab list, ×close, +new, active indicator
- [x] `renderer/components/TerminalPane.tsx` — one xterm.js instance per tab, hidden-not-unmounted on switch, FitAddon + ResizeObserver, OSC title → tab name
- [x] `renderer/hooks/useKeyboardShortcuts.ts` — ⌘T, ⌘W, ⌘1–9, ⌘⇧[/]
- [x] Custom xterm.js dark theme (Zinc palette, purple cursor)

### Remaining for Stage 1
- [ ] `npm install` + `npm run dev` on macOS — first real smoke test (node-pty native rebuild)
- [ ] CWD tracking per PTY tab (needed by Stage 4 skills panel)
- [ ] Handle "last tab closed" gracefully

---

## Stage 2 + 3 — Browser Pane + `duo` Bridge `⬜ Not Started`

> **Decision:** Stages 2 and 3 will be implemented together since the CDP bridge
> is only meaningful with a real WebContentsView in place.

**Exit criteria (Stage 2):** Geoff can log into Google once, reopen the app, and still be logged in. Google Docs renders correctly.

**Exit criteria (Stage 3):** From any terminal tab, `duo text` returns the contents of whatever's in the browser.

### Browser pane (Stage 2)
- [x] `electron/browser-manager.ts` — typed stub
- [x] `renderer/components/BrowserPane.tsx` — address bar + nav chrome (disabled placeholder)
- [x] `renderer/components/AddressBar.tsx` — URL input with edit/commit/escape

> **Decision:** Browser pane uses minimal UX — address bar + back/forward/reload only.
> No visible tab bar in the browser pane. `duo tabs` / `duo tab <n>` manage browser tabs
> programmatically via CLI.

- [ ] `BrowserManager`: create WebContentsView, attach to `mainWindow.contentView`
- [ ] Bounds sync: renderer → IPC → main repositions view on split resize / window resize
- [ ] Navigation: address bar commits, back/forward/reload wired
- [ ] SSO persistence via `BROWSER_SESSION_PARTITION` (`persist:duo-browser`)
- [ ] `browser:navigate` + `browser:state` IPC channels in main.ts
- [ ] Browser tabs managed internally (not visible in UI); `duo tab <n>` switches between them

### CLI bridge (Stage 3)
- [x] `cli/duo.ts` — full command dispatch (all 13 commands), socket transport, help text
- [x] `cli/install.sh` — symlink to `/usr/local/bin/duo` or `~/.local/bin/duo`
- [x] `electron/socket-server.ts` — stub with protocol docs, types wired
- [x] `electron/cdp-bridge.ts` — stub with all method signatures

> **Decision:** `duo` CLI is compiled to a self-contained binary via **esbuild** (no
> external Node.js required on the user's machine). The binary lives in the app bundle's
> `cli/` extra-resources directory; `install.sh` symlinks it to `/usr/local/bin/duo`.

- [ ] `CdpBridge`: implement all CDP commands via `webContents.debugger`
- [ ] `SocketServer`: listen on `SOCKET_PATH`, dispatch to CdpBridge
- [ ] Wire `SocketServer` startup into `electron/main.ts`
- [ ] Add esbuild script to compile `cli/duo.ts` → binary in `cli/duo`
- [ ] `scripts/postinstall.ts` called on first launch: install skill + run `install.sh`
- [ ] CLI symlink installation dialog on first launch (Electron dialog)
- [ ] End-to-end: `duo text` returns page content from terminal tab

> **DOM size note:** `duo dom` on a long Google Doc can be very large. Plan to add
> `duo text --max-chars N` and `duo text --save-to <file>` before Stage 5.

---

## Stage 4 — Skills Context Panel `⬜ Deprioritized`

> **Not urgent — do other things first. Revisit before Stage 5.**

**Purpose:** A collapsible right sidebar showing the Claude Code skills available
to the agent running in the active terminal tab.

**Two scopes (both must be shown):**
1. **Project scope** — skills in the directory where Claude Code was invoked
   (the PTY's *launch* CWD, not the shell's moving CWD). Scanned for:
   `SKILL.md`, `CLAUDE.md`, `.claude/skills/`
2. **Home scope** — skills in `~/.claude/skills/` (available to Claude regardless
   of project)

> **CWD tracking:** No shell hooks or polling needed. The relevant CWD is the
> PTY's *initial* working directory — captured at `pty:create` time and fixed
> for the life of that tab. If Claude moves directories inside the terminal, the
> Skills panel still reflects what Claude was launched into.

- [x] `electron/skills-scanner.ts` — CWD scan: SKILL.md, CLAUDE.md, .claude/skills
- [x] `renderer/components/SkillsPanel.tsx` — UI component (not yet in layout)
- [x] `renderer/hooks/useSkillsContext.ts` — stub, returns empty

- [ ] Pass PTY launch CWD through `TabSession` (already in type, needs to be wired)
- [ ] `skills:scan` IPC handler: scan launch CWD + `~/.claude/skills/`, merge results
- [ ] `useSkillsContext` wired to IPC
- [ ] `SkillsPanel` added as collapsible third column (right of browser pane, toggle with ⌘⇧S or similar)

---

## Stage 5 — `duo` Skill `⬜ Not Started`

**Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `duo` to read a Google Doc.

- [x] `skill/SKILL.md` — when to use, command reference, patterns, error recovery, version pinning
- [x] `skill/examples/read-google-doc.md`
- [x] `skill/examples/fill-form.md`
- [x] `skill/examples/iterate-artifact.md`

- [ ] Version pinning: skill asserts `duo --version` is in compatible range
- [ ] Postinstall verified: skill copied to `~/.claude/skills/duo/` on first launch

---

## Stage 6 — Polish & Distribution `⬜ Not Started`

**Exit criteria:** A PM in the Trailblazers cohort can install and use without terminal setup.

- [ ] App icon (`build/icon.icns`) + branded DMG background
- [ ] Code signing — Apple Developer ID (**needs cert from Geoff**)
- [ ] Notarization — `notarytool` via electron-builder
- [ ] `electron-updater` — auto-update from GitHub Releases or private S3
- [ ] Session restore on relaunch (terminal CWDs, browser URL, split position)
- [ ] Security: launch-time auth token on the Unix socket (before Trailblazers)
- [ ] Theming pass: refine Warp × Linear aesthetic
- [ ] Notifications for agent-driven browser navigation
- [ ] README + install guide for Trailblazers cohort

---

## Decisions Log (from owner)

| Decision | Choice | Impact |
|---|---|---|
| App name | **Duo** | CLI is `duo`, skill installs to `~/.claude/skills/duo/` |
| CLI packaging | **esbuild compiled binary** | No Node.js required; symlinked from app bundle |
| Browser tab UX | **Minimal — address bar only** | No tab bar in browser pane; tabs managed via `duo tab <n>` |
| Brainstem / MCP | **Not included** | Stage 4 is CWD-scan only; `SkillEntry.source` type simplified |
| Stage order | **2 + 3 together** | Browser pane and CDP bridge implemented in one pass |
| Skills panel layout | **Collapsible sidebar** | Third column right of browser pane |
| Skills CWD source | **PTY launch CWD** | No shell hooks; capture at `pty:create` time; two scopes: project + home |
| First-launch install | **Electron permission dialog** | Prompt before installing CLI + skill |
| Distribution / cert | **No cert — personal use** | Ad-hoc or unsigned; get cert before Stage 6 |

## Open Questions

| Question | Needed Before |
|---|---|
| Apple Developer ID cert | Stage 6 |
| Distribution timeline (personal → Trailblazers) | Stage 6 |
| Socket auth approach for Trailblazers | Stage 6 |
