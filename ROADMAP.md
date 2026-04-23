# Duo — Roadmap

> Status legend: ✅ done · 🔄 in progress · ⬜ not started

---

## Stage 1 — Core Shell `✅ Done — verified end-to-end`

**Exit criteria:** Geoff can open the app, get multiple terminal tabs, run Claude Code in them. ✅ Met.

### Infrastructure & Scaffold ✅
- [x] Repo scaffolded: electron-vite + React + Tailwind configured
- [x] TypeScript: split tsconfig (tsconfig.node.json for main/CLI, tsconfig.web.json for renderer)
- [x] electron-builder: universal macOS DMG config (arm64 + x64)
- [x] `asar: true` + `asarUnpack` for node-pty native module
- [x] macOS entitlements plist (hardenedRuntime)
- [x] All source directories per §12 of brief
- [x] `shared/types.ts` — DuoRequest/Response/CommandName, IPC channel map, ElectronAPI surface
- [x] `shared/constants.ts` — main-process paths (socket, session partition, skill install dir)

> **Note:** `shared/constants.ts` uses Node.js `os`/`path` — renderer components
> must not import it directly. Renderer-safe values are defined inline.

### Main Process ✅
- [x] `electron/main.ts` — BrowserWindow (1440×900, dark, `hiddenInset` titlebar), IPC setup
- [x] `electron/preload.ts` — contextBridge PTY API: create/write/resize/kill/onData/onExit
- [x] `electron/pty-manager.ts` — node-pty session pool keyed by tab UUID; data/exit IPC events

### Renderer — Terminal ✅
- [x] `renderer/App.tsx` — split layout, tab state, drag-to-resize (20–80%)
- [x] `renderer/components/TabBar.tsx` — tab list, ×close, +new, active indicator
- [x] `renderer/components/TerminalPane.tsx` — one xterm.js instance per tab, hidden-not-unmounted on switch, FitAddon + ResizeObserver, OSC title → tab name via `term.onTitleChange()`
- [x] `renderer/hooks/useKeyboardShortcuts.ts` — ⌘T, ⌘W, ⌘1–9, ⌘⇧[/]
- [x] Custom xterm.js dark theme (Zinc palette, purple cursor)

### Post-verification fixes landed
- [x] `npm install` + `npm run dev` smoke test passes (fixed tsconfig module, ESM config files, postcss/tailwind mjs rename, xterm fit-on-zero-size crash, StrictMode double-mount artefact)
- [x] `⌘L` focuses the address bar (Chrome parity)
- [x] `⌘T` → new browser tab; `⌘⇧T` → new terminal tab
- [ ] Handle "last terminal tab closed" gracefully (currently prevented at the UI level; no explicit "create fresh tab" recovery)

---

## Stage 2 + 3 — Browser Pane + `duo` Bridge `✅ Done — verified end-to-end`

**Exit criteria (Stage 2):** Geoff can log into Google once, reopen the app, and still be logged in. Google Docs renders correctly. ✅ Met.

**Exit criteria (Stage 3):** From any terminal tab, `duo text` returns the contents of whatever's in the browser. ✅ Met, and extended: `duo ax` returns canvas-rendered content (Google Docs, Sheets, etc.), plus `focus`/`type`/`key` for writing and `console` for diagnostics.

### Browser pane (Stage 2) ✅
- [x] `electron/browser-manager.ts` — WebContentsView per tab; active tab has real bounds, inactive tabs are 1×1; SSO via `persist:duo-browser`; popup redirection; goBack/goForward/reload/switchTab using Electron `navigationHistory` API
- [x] `renderer/components/BrowserPane.tsx` — live address bar + nav buttons; ResizeObserver sends pixel bounds to main process so WebContentsView overlays exactly
- [x] `renderer/components/AddressBar.tsx` — URL input with smart URL expansion (bare domain → https://, plain text → Google search)
- [x] `renderer/hooks/useBrowserState.ts` — subscribes to `browser:state` IPC
- [x] Bounds sync: renderer → `browser:bounds` IPC → main repositions WebContentsView on split resize / window resize
- [x] SSO persistence via `BROWSER_SESSION_PARTITION` (`persist:duo-browser`)
- [x] `browser:navigate` + `browser:state` IPC channels wired in main.ts

### CLI bridge (Stage 3) ✅
- [x] `electron/cdp-bridge.ts` — getDOM, getText, click, fill (React native-setter), evalJS, screenshot, waitForSelector
- [x] **`ax`** (accessibility tree) — CDP `Accessibility.getFullAXTree` / `getPartialAXTree` with ignored-node hoisting and a Markdown renderer
- [x] **`focus`** / **`type`** / **`key`** — CDP `Input.insertText` + `Input.dispatchKeyEvent` for canvas-app editing
- [x] **`console`** — `Runtime.consoleAPICalled` + `Log.entryAdded` subscription, 500-entry ring buffer, `--since` / `--level` / `--limit` filters
- [x] `electron/socket-server.ts` — Unix domain socket, newline-JSON protocol, all commands, socket chmod 0o700
- [x] `electron/main.ts` — SocketServer wired; CDP attached after first bounds report
- [x] `cli/duo.ts` — all commands + `install` command (symlinks to `/usr/local/bin/duo` or `~/.local/bin/duo`)
- [x] `cli/duo` — pre-compiled esbuild binary, tracked in git, ready to install without a build step
- [x] Browser tab strip + `BROWSER_*` IPC (addTab/switchTab/closeTab/getState/getTabs/onTabsChange)
- [x] Stale address bar after CDP-driven navigation fixed (state snapshot pulled on mount)

### Verified
- [x] E2E: `duo navigate / url / title / text / ax / focus / type / key / console / screenshot / eval` all round-trip correctly
- [x] SSO persistence: Docs stays logged-in across relaunches
- [x] Canvas path: `duo ax --selector '[role="document"]'` returns structured Markdown for a Google Doc

### Open
- [ ] First-launch install dialog (Electron prompt before installing CLI + skill) — currently installs via `./cli/duo install` + manual `cp`. Stage 6.
- [ ] `duo wait --timeout N` races with the CLI's 10s socket timeout for N ≥ 10000. Fix: make the CLI socket timeout `max(N + buffer, default)`.

> **DOM size note:** `duo dom` on long pages is still large. `duo ax --format json` is usually the better structured option; for text-only views, narrow with `--selector`. A `--max-chars` or `--save-to` flag remains a nice-to-have but isn't blocking.

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

## Stage 5 — `duo` Skill + subagent `✅ Done — verified end-to-end (install still manual)`

**Exit criteria:** A fresh Claude Code session in the app autonomously discovers and uses `duo` to read a Google Doc. ✅ Met — verified by launching `claude` inside a Duo terminal and asking "summarize the page open in my browser".

- [x] `skill/SKILL.md` — YAML frontmatter, prescriptive Docs rules (hard "no" on `duo dom`, `.kix-appview-canvas` selector, `/export?format=txt` URL), scroll-to-expand technique for long docs, delegation hint to the subagent
- [x] `skill/examples/read-google-doc.md` — rewritten to use `ax`, documents the four traps by name
- [x] `skill/examples/edit-google-doc.md` — focus + type + named keys + verification flow
- [x] `skill/examples/fill-form.md`
- [x] `skill/examples/iterate-artifact.md`
- [x] `agents/duo-browser.md` — **subagent** with Bash-only access; the preferred entry point for multi-step browser work (keeps parent context clean)
- [x] A.5.1 verified: fresh Claude Code session discovers skill + subagent, drives the browser with zero priming, returns accurate summary
- [x] A.5.3 verified (error recovery): when `[role="document"]` selector misses, the agent falls back to full `duo ax` without human intervention

- [ ] Version pinning: skill asserts `duo --version` is in a compatible range
- [ ] First-launch installer (copies `skill/` + `agents/` into `~/.claude/`) — currently manual. Stage 6.
- [ ] **Open ADR: skill scoping** — global `~/.claude/skills/duo/` vs. Duo-session-only (`docs/DECISIONS.md` → Open ADRs). Changes the first-launch install step if we pick per-session.

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

## Stage 7 — Agent-Driven File Navigator + Viewer `⬜ Backlog — scoped, not scheduled`

**Purpose:** Give the app a shared file navigator (a Finder/VS-Code-style
tree) and a file viewer, both drivable by the agent via the `duo` skill.
Makes file-oriented work (reviewing diffs, markdown briefs, generated
artifacts) as natural as driving the web browser is today.

**Core flow (from Geoff):**
The navigator is the primary surface for picking *where to work*.
User browses to a folder → "open terminal here" seeds a new tab's launch
CWD from the navigator's current folder → user runs `claude` in that tab.
After the handoff, the navigator is free: the user (or agent) can go
deeper, shallower, or sideways without affecting any existing tab.

**Decisions (from Geoff):**
- **Layout:** new fourth column, right of the browser pane (alongside the
  collapsible Skills panel from Stage 4).
- **Navigator scope:** **one shared, app-level tree.** Not per-tab. State
  (expanded folders, current selection, scroll) persists across tab
  switches. *Terminal* and *viewer/editor* may become tabbed later; the
  navigator never does.
- **Navigation freedom:** fully free — anywhere on disk the user can
  normally read. The navigator is *not* pinned to any tab's CWD. The
  Stage 4 Skills panel stays per-tab and pinned to PTY launch CWD — they
  answer different questions ("which project is this tree showing" vs.
  "which skills does this Claude have").
- **CWD handoff:** new tabs launched via the navigator inherit the
  navigator's *current* folder as their launch CWD. After launch, the
  tab's CWD is frozen (existing behavior) even if the navigator moves.
- **File types v1:** Markdown (rendered) + code (syntax-highlighted plain
  text). Images, PDFs, and other rich types are **future** but must not be
  precluded — see "Architecture guardrails" below.
- **Agent `reveal` behavior:** `duo reveal <path>` takes over the shared
  tree and jumps it to `<path>`. Simple and obvious for v1; revisit if
  yanking user focus proves annoying (see "Ideas" below).
- **Selection events:** pull-only for v1 — agent queries current selection
  via `duo viewer state`. No push notifications into Claude Code's stdin.

**Ideas (not committed backlog):**
- **Gentler reveal:** instead of jumping the tree, show a pending-reveal
  toast ("Claude wants to show you foo.md — click to jump"). Adds UI;
  defer until the simple version is shown to be disruptive.
- **Reveal history / back button** on the navigator so the user can undo
  an agent-driven jump.
- **Event log** the agent can poll (`duo viewer events --since <cursor>`)
  for user file selections. Adds state + cursor semantics; defer until
  there's real demand.
- **Push notifications** into the active tab (inject into stdin, or
  surface via `duo watch`). Complex; skip unless there's a clear
  user-collab flow.

**Architecture guardrails (so markdown-only v1 doesn't preclude images/PDFs):**
- Viewer is a **per-type component registry** keyed by MIME/extension, not
  a single Monaco/CodeMirror instance. v1 registers `.md` and
  `.ts/.js/...`; later PRs register `.png`, `.pdf` without rewriting the
  shell.
- File contents flow to the renderer as `Buffer` (not forced `utf8`), so
  binary payloads work when we add them.
- Prefer an Electron **custom protocol handler** (e.g. `duo-file://`) for
  renderer → disk reads rather than shipping bytes over IPC. Keeps large
  PDFs/images off the IPC bus and gives us a single place to enforce
  path policy.
- CLI + socket commands take `path` + optional `mime`, never assume text.
- Viewer state IPC carries `{path, mime, size}` — no `{text}` field baked
  in.
- **Viewer is viewer-shaped now.** Even though viewer may become tabbed
  later, v1 ships a single-slot viewer. Keep the component API
  (`open(path)`, `close()`, `state()`) stable so a later tabbed wrapper
  can multiplex without churning callers.

**Sketch of CLI surface:**
- `duo open <path>` — open a file in the viewer pane
- `duo reveal <path>` — focus a file/folder in the shared navigator
- `duo ls [path]` — list directory contents via the bridge
- `duo viewer close` / `duo viewer state`
- `duo nav state` — current navigator folder + selection

- [ ] `electron/navigator.ts` — single shared tree UI, expand/collapse/reveal
- [ ] `electron/file-viewer.ts` — viewer shell + per-type component registry (markdown + code for v1)
- [ ] "Open terminal here" action wired from navigator → `pty:create` with chosen CWD
- [ ] Custom protocol handler (`duo-file://`) with path policy enforcement
- [ ] Bridge methods for navigator/viewer: open, reveal, state, ls, nav-state
- [ ] New socket commands wired through `cli/duo.ts`
- [ ] `skill/SKILL.md` updated with navigator/viewer patterns + examples

---

## Backlog — unscheduled

> Raised by the owner in session; no commitment on stage mapping yet.

### Reader mode for the terminal (non-SWE friendly typography)

**Problem:** the default xterm.js theme is tuned for engineers (dense,
monospaced, 13px). A PM-first audience wants more-generous line height,
larger type, softer contrast — but Claude Code's TUI uses box-drawing,
inline ANSI, and fixed-column assumptions that break if we change the
font stack or character metrics naively.

- [ ] Opt-in "Reader" theme toggle (⌘⌥R?) that adjusts line-height,
      letter-spacing, font size, and contrast — but keeps a monospaced
      font and stable cell grid so Claude Code's TUI still renders.
- [ ] Verify against: Claude Code prompt rendering, progress spinners,
      diff output, box-drawing borders, interactive confirmation UIs.
- [ ] Surface the toggle both in a menu and as a per-tab setting (some
      users may want a Reader tab for skim-reading agent output and a
      Dev tab for hands-on editing).

### Markdown editor as a working pane mode

**Problem:** we currently have a polymorphic working pane
(browser / file viewer / markdown editor per §7 of the brief) but only
the browser is implemented. A markdown editor aimed at PMs wants more
than a raw textarea.

- [ ] First-class markdown editor pane with live decorations (headings,
      emphasis, code, lists) — not a preview split, but real inline
      formatting in the editing surface.
- [ ] Typography care: prose-width column, real heading hierarchy,
      comfortable line-height. Not terminal-monospaced.
- [ ] Lightweight UI: inline buttons for bold / italic / heading levels /
      lists / blockquote / link; no heavyweight toolbar chrome.
- [ ] Keyboard shortcuts for heading levels (⌘1..⌘6 → H1..H6, scoped
      to the editor pane), standard mac bindings for bold/italic/link.
- [ ] Stage 7 overlap: the markdown editor is one of the per-type viewer
      components in the file-viewer registry. Design the keybindings
      and pane-mode plumbing so it lands cleanly alongside Stage 7 rather
      than as a one-off.

### Browser tab numbers surfaced in the UI

**Problem:** the browser tab strip shows titles but not the numeric IDs
that `duo tab <n>` uses. Geoff wants to be able to tell Claude
"read tab 1, write a summary in tab 2" and have the agent reach for
`duo tab 1 && duo ax`, then `duo tab 2 && duo focus …` without
guessing.

- [ ] Show the 1-based tab ID in the browser tab strip (small chip, e.g.
      `1 · Google Docs`).
- [ ] Teach the skill / subagent that user references to "tab N" map to
      `duo tab N` and `duo tabs` for discovery.
- [ ] Consider a global `⌘⌥<n>` shortcut that switches the browser's
      active tab to N (distinct from `⌘<n>` which already jumps
      terminal tabs).

### Terminal selection / clipboard improvements

**Problem:** xterm.js default selection is not the best fit for the
"agent-conversation" usage pattern. Today selecting a block of Claude
Code output and `⌘C` copies that visible block, but the common needs
are subtly different.

- [ ] **Click to move cursor** in the terminal (when the underlying
      process doesn't claim mouse events, let a plain click place the
      cursor at that column — bash `readline` / zsh `zle` semantics).
- [ ] **⌘A copies the terminal command composer** — just the current
      unsubmitted input line, not the full scrollback.
- [ ] **⌘⇧A copies the full scrollback** (what today's ⌘A approximates
      but inconsistently).
- [ ] Validate against: Claude Code's TUI (which may intercept mouse
      events for its own selection model — don't fight it), `vim`,
      `less`, and `fzf` (which all use mouse events). The correct
      precedence is: if the foreground process is in app-cursor /
      mouse-tracking mode, defer to it; only apply Duo's own mouse
      semantics when the shell is at a prompt.

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
| Skill scoping: global `~/.claude/skills/duo/` vs. Duo-session-only (see `docs/DECISIONS.md` → Open ADRs) | Stage 5 |
