# Duo — Roadmap

> Status legend: ✅ done · 🔄 in progress · ⬜ not started
>
> Stage numbers are a chronological record of when work was planned, not a
> priority order. For the actual build order going forward, read
> **[Build order](#build-order-resequenced-per-visionmd) below**.

---

## Build order (re-sequenced per [VISION.md](docs/VISION.md))

[VISION.md](docs/VISION.md) names "the reading and writing pair" — a
prose-first terminal + a docs-style markdown editor — as the flagship
bet. Everything else is supporting cast. With that framing, the original
stage order was wrong: polish + distribution (Stage 6) and a thin file
viewer (Stage 7) were scheduled before the two surfaces that actually
deliver the north-star experience. Re-sequenced:

| # | Stage | Ship state |
|---|---|---|
| 1 | Core shell (terminal, tabs, layout) | ✅ done |
| 2 | Browser pane + SSO | ✅ done |
| 3 | `duo` CLI bridge + CDP primitives | ✅ done |
| 5 | Skill + subagent authoring | ✅ done |
| 8 | Agent-generated HTML via `duo open` | ✅ done |
| **9** | **Cozy-mode terminal (typography v1)** | ✅ **shipped 2026-04-22; graduated 2026-04-25** |
| **10** | **File browser / context drawer** | 🔄 **in progress — spec locked** |
| **11** | **Collaborative markdown editor — human↔agent** | 🔄 **11a shipped 2026-04-24; 11b–e next** |
| 12 | Unified skill + connector management surface | ⬜ (supersedes old Stage 4) |
| 13 | Tab numbers in UI + terminal selection polish + `duo doctor` + TCP transport | ⬜ |
| **15** | **Human↔agent interaction primitives** (events, notify, tab identity, pre-typed cmd, zap, file→composer, **Send→Duo**) | ⬜ (issues #9, #11, #13, #15, #18, #19; 15g raised 2026-04-25) |
| 16 | Multi-window support | ⬜ **backlog** (issue #16) |
| **14a** | **First-launch self-install** (double-click → app prompts, copies skill/agent into `~/.claude/`, installs CLI to sandbox-safe PATH; ad-hoc-signed local build) | ⬜ (split from old Stage 6 on 2026-04-26 — **no cert needed**, can ship before 14b) |
| 14b | Distribution polish (Apple Developer ID code signing, notarization, electron-updater, icon, DMG background, README install guide) | ⬜ (gated on cert from Geoff) |

Stages 4 (skills panel — CWD-scan narrow scope) and 7 (file navigator +
viewer — thin read-only version) are **superseded** by this sequence.
Their work items are absorbed into Stages 10, 11, and 12. The original
sections below are preserved for history and for the architectural
guardrails they captured.

### Layout commitment (owner, 2026-04-23)

The app layout is locked to a three-column shape:

```
┌────┐┌─────────────────┐┌─────────────────┐
│    ││                 ││ Viewer/Editor   │
│Files││    Terminal    ││ (polymorphic)   │
│    ││                 ││                 │
│    │└─────────────────┘│                 │
│    │┌─────────────────┐│                 │
│    ││  Agent tools    ││                 │
│    ││  (collapsible)  ││                 │
└────┘└─────────────────┘└─────────────────┘
```

See [docs/DECISIONS.md § Layout model + working-pane model](docs/DECISIONS.md)
for the full ADR. Mapping to stages:

- **Files column** → Stage 10.
- **Terminal** → middle-top, relocated from left during the Stage 10
  reshape.
- **Agent tools** → middle-bottom, collapsible, Stage 12.
- **Viewer/Editor** → right. Tabbed polymorphic surface with **one
  unified tab strip across all modalities**. A tab can be a browser
  page, a markdown editor, an HTML/code source editor, or a file
  preview (image/PDF/CSV). The same file can live in multiple tabs
  under different types (edit the source in tab 3, render it in
  browser tab 4). `duo tabs` returns the mixed list; tab IDs are
  continuous regardless of type. Browser tabs are shipped; editor
  and preview tab types land in Stages 10–11.

Today's layout (terminal-left, browser-right, no Files column) is a
waypoint. The reshape lands with Stage 10.

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
- [x] **Google Docs rich-text path (verified on a 48k-char production PRD):** same-origin `fetch('/document/d/<id>/export?format=md')` returns the **full** doc as clean Markdown (H1–H6, `**bold**`, `*italic*`, links, `---`, lists). Session-authenticated via cookies; not viewport-limited; bypasses every DOM/noscript trap. This is now the primary read path in the skill. `duo ax` moved to fallback.
- [x] **Docs in-page annotator:** `_docs_annotate_getAnnotatedText('')` returns `{ getText, getAnnotations, getSelection, setSelection }`. `getText()` is the full plaintext (not viewport-limited); `setSelection([{start,end}])` is the only reliable programmatic cursor placement inside a Doc.

### Known limitations
- [ ] **Google Docs keyboard path is broken.** `duo key <named>` (Enter, Arrow*, Backspace, Home, End) and all modifier shortcuts (`Cmd+B/I/U/Z/A`, `Cmd+Alt+1..6`) are silent no-ops on a Docs page. Root cause: Docs listens on a hidden `.docs-texteventtarget-iframe`; CDP `Input.dispatchKeyEvent` delivers to the main frame's focused element, and `duo focus` (which uses `el.focus()` in page JS) can't cross the iframe boundary. `Input.insertText` (i.e. `duo type`) works because it bypasses the keyboard pipeline. Fix requires attaching CDP to the iframe's frame target or routing via a different input API. Until fixed, the skill tells the agent: insert plain text via `duo type`, and defer styling to the user or the Docs REST API. See commit d3d5e0e for the empirical report.
- [ ] **No Docs REST API escalation path yet.** Structural edits (tables, heading changes, styled blocks) should use `documents.googleapis.com/v1/documents/{id}:batchUpdate` with the `documents` OAuth scope. The Duo app should grow a one-time consent flow so the token can be bootstrapped from the signed-in Electron session (brief §17.4). Until then, agents must defer styling to the user.
- [ ] First-launch install dialog (Electron prompt before installing CLI + skill) — currently installs via `./cli/duo install` + `npm run sync:claude`. **Stage 14a** (split out of old Stage 6 on 2026-04-26 so it can ship before the cert lands).
- [ ] `duo wait --timeout N` races with the CLI's 10s socket timeout for N ≥ 10000. Fix: make the CLI socket timeout `max(N + buffer, default)`.

> **DOM size note:** `duo dom` on long pages is still large. `duo ax --format json` is usually the better structured option; for text-only views, narrow with `--selector`. A `--max-chars` or `--save-to` flag remains a nice-to-have but isn't blocking.

---

## Stage 4 — Skills Context Panel `⬜ Superseded by Stage 12`

> **Superseded.** This stage was a narrow CWD-scan sidebar — the scanner
> (`electron/skills-scanner.ts`) already exists. The broader product need
> — unified skill + connector management — is now **Stage 12**, which
> absorbs these work items and extends them with MCP setup + toggle +
> templates per VISION §Skill discovery, install, and editing.

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
- [ ] First-launch installer (copies `skill/` + `agents/` into `~/.claude/`) — currently manual. **Stage 14a** (no cert required; split from old Stage 6 on 2026-04-26).
- [x] **Skill scoping** — locked 2026-04-25: global `~/.claude/skills/duo/`. See [docs/DECISIONS.md § Skill scoping](docs/DECISIONS.md). The per-session alternatives (shell-init `--plugin-dir`, `--add-dir`, project-level symlink) remain documented for future reference if the skill ever needs Duo-specific guardrails that shouldn't leak to other Claude sessions.
- [x] **Skill docs: Claude Code sandbox troubleshooting section** — `skill/SKILL.md` now carries a "Troubleshooting: Claude Code sandbox" block (failure signatures, `duo doctor` as first move, the recommended `allowUnixSockets: true` + socket-read allowlist, `dangerouslyDisableSandbox` called out as last resort). `agents/duo-browser.md` mirrors the short version in its "Diagnosing failures" section. See `docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant transport and install paths for the `duo` CLI*.

---

## Stage 14 — Polish & Distribution `⬜ Held — split into 14a + 14b on 2026-04-26`

> **Originally Stage 6**, re-sequenced per VISION.md to land **after**
> Stages 9 + 10 + 11 (the flagship reading/writing pair). On
> 2026-04-26, split into two halves so the user-facing first-launch UX
> doesn't stay blocked on the Apple Developer ID cert it doesn't
> actually need:
>
> - **Stage 14a — First-launch self-install (no cert).** The
>   double-click-and-go behaviour. Can ship against an ad-hoc-signed
>   local build today.
> - **Stage 14b — Distribution polish (cert-gated).** Code signing,
>   notarization, electron-updater, icon, DMG background, install
>   guide. Held on the cert.
>
> Both halves were a single `⬜ Held` Stage 6/14 prior to the split.
> The bullet list below is partitioned but otherwise unchanged.

### Stage 14a — First-launch self-install `⬜ Not started — no cert needed`

**Why pulled forward:** the gap between "developer runs `npm run dev`"
and "Trailblazer double-clicks an `.app`" is doing too much work in
the user's hands. None of these items require code signing — they
just need an Electron entry point that detects first launch and
performs side-effect installs into `~/.claude/` and PATH.

**Exit criteria:** Geoff hands a Trailblazer the unsigned/ad-hoc-signed
`.app`, they double-click it (using the macOS "right-click → Open"
gatekeeper bypass once), and from that point on every `duo` command
in their Claude Code session works without any terminal setup.

- [ ] **Validate `npm run dist` end-to-end.** Confirm the produced
      `.app` (and DMG) launches when moved out of the build dir,
      that the bundled `cli/duo` binary is reachable via
      `process.resourcesPath`, and that `skill/` + `agents/` are
      packaged as resources rather than left behind at `node_modules/`.
- [ ] **First-launch detection.** On Electron `app.whenReady()`,
      check whether `~/.claude/skills/duo/SKILL.md` already exists
      and matches the bundled version's `name`/`description`
      frontmatter. If absent or mismatched, show a one-time consent
      sheet ("Duo wants to install its Claude Code skill, subagent,
      and CLI helper. This adds three files to ~/.claude/ and one
      symlink to ~/.claude/bin/. [Install] [Skip]").
- [ ] **First-launch install action.** On consent, copy
      `app.getAppPath()/skill/SKILL.md` → `~/.claude/skills/duo/SKILL.md`,
      copy `app.getAppPath()/skill/examples/*` → `.../examples/`,
      copy `agents/duo-browser.md` → `~/.claude/agents/duo-browser.md`,
      and symlink `app.getAppPath()/cli/duo` → `~/.claude/bin/duo`
      (creating `~/.claude/bin` if needed). Write a `~/.claude/duo/
      installed-version.json` so we can detect "skill out of date,
      app updated" later.
- [ ] **Sandbox-safe install path for `duo install`.** Today the
      install logic tries `/usr/local/bin/duo` then falls back to
      `~/.local/bin/duo` — both write outside the Claude Code
      sandbox's permitted cwd. Prefer `~/.claude/bin/duo` (inside
      the sandbox-writable `~/.claude/` tree), fall back to
      `~/.local/bin/duo`, and only touch `/usr/local/bin/duo` on
      explicit opt-in. Print the required `export PATH=…` fragment
      after install. See `docs/DECISIONS.md` → Open ADRs →
      *Sandbox-tolerant transport and install paths for the `duo`
      CLI*.
- [ ] **Re-install / update flow.** When the bundled skill version
      is newer than `installed-version.json`, prompt before
      overwriting (so a user who hand-edited their skill doesn't
      lose changes silently).
- [ ] **Bundled Claude Code settings fragment.** Ship a
      copy-pasteable `.claude/settings.json` allowlist in the
      skill (socket path read-allowed + `allowUnixSockets: true`)
      for teams that want to keep Duo on the Unix-socket fast path
      rather than the TCP fallback. Optional for users because the
      fallback heals sandboxed runs transparently; valuable as
      documentation for sandbox-conscious reviewers. See
      `docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant
      transport and install paths for the `duo` CLI*.

### Stage 14b — Distribution polish `⬜ Held — gated on Apple Developer ID cert`

**Exit criteria:** A PM in the Trailblazers cohort installs from a
download link, with no gatekeeper warnings, and gets auto-updates.

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

## Stage 7 — Agent-Driven File Navigator + Viewer `⬜ Superseded by Stages 10 + 11`

> **Superseded.** This stage's thin "markdown + code viewer" framing
> undersized the writing surface that VISION.md subsequently named as the
> flagship. Split into:
>
> - **Stage 10** — file browser / context drawer. The navigator half of
>   this stage, plus VISION's "drag file into the conversation"
>   framing. Keeps the architectural guardrails below (per-type
>   component registry, `duo-file://` protocol, Buffer not forced utf8).
> - **Stage 11** — the collaborative markdown editor. The viewer half
>   of this stage becomes the editor-viewer spectrum. "Read-only
>   markdown + code" is still the v1 for non-`.md` file types; `.md`
>   files get the full editor.
>
> One naming-collision note: this stage originally sketched
> `duo open <path>` for the file viewer. That name is now taken by Stage
> 8 (HTML-in-browser). The file-viewer analog will be renamed — candidates:
> `duo view <path>`, `duo edit <path>`, `duo reveal <path>`. Pick at
> Stage 10 kickoff.

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

## Stage 8 — Agent-generated HTML artifacts in the browser `✅ v1 shipped`

**Goal:** Claude Code can generate HTML (interactive prototypes, rich
training material, data viz, simple tools) and load it into the Duo
browser pane on demand. Users can say "show me a countdown timer for
5 minutes" or "open that" referring to the file Claude just wrote, and
the artifact appears in a new tab, ready to interact with.

**Primary use cases:**
- **Interactive prototyping.** User says "show me {UI idea}" → Claude
  writes HTML → Duo opens it → user plays with it → iterative
  refinement.
- **Rich training material.** PMs often want to explain a concept with
  a small simulation or interactive diagram — Claude generates it in
  a single HTML file on the fly.
- **Disposable tools.** Quick date calculators, one-off data
  visualizations, pretty-printed JSON inspectors — things that would
  otherwise need a separate webapp.

**User flow:**
```
user: "show me a countdown timer, 5 minutes"
claude (code): writes /tmp/countdown-xyz.html
claude (code): runs `duo open /tmp/countdown-xyz.html`
duo: opens a new browser tab with the file loaded, activates it
user: sees the timer, uses it, asks "make the font bigger"
claude (code): rewrites the file, `duo navigate <same-file-url>`
              (current tab = the prototype tab, so this is a reload)
duo: reloads with the new styles
```

**Core mechanic:** `duo open <path-or-url>` — a higher-level command
that:
- Accepts a local file path (absolute or relative) → resolves to `file://`
- Accepts any URL scheme and passes it through
- Opens in a new browser tab and makes it active
- Returns `{ok, id, url, title}` so the agent knows which tab to drive next

**Interaction after open:** once loaded, every other `duo` command
(click, fill, type, eval, screenshot, ax, wait) works against the new
tab just like any other browser pane.

**Scope for first pass:**
- [x] New socket command `open` → calls existing `BrowserManager.openTab(url)`.
- [x] `duo open <path-or-url>` in `cli/duo.ts` with path resolution
      (absolute path, `~/` expansion, relative-to-cwd, URL passthrough).
- [x] `BrowserManager.openTab` returns the resolved `{url, title}` after
      load (with a 2s settle deadline) so agents know exactly what
      they just showed.
- [x] `skill/examples/iterate-artifact.md` — rewritten around the
      `duo open` + `duo navigate` (reload in place) pattern.
- [x] `skill/SKILL.md` — "Show the user a generated HTML artifact"
      pattern with the `duo open` vs `duo navigate` decision rule.
- [x] `agents/duo-browser.md` — subagent prefers `duo open` for
      prototype / artifact delivery.
- [x] Smoke test: generated `/tmp/duo-countdown.html` (interactive 5-min
      timer), `duo open`'d it, verified new tab created and active,
      clicked `#start`, read elapsed time after 3s, clicked `#reset`,
      confirmed state reset. Also verified URL passthrough
      (`duo open https://example.com` creates new tab with live page).
- [x] `duo close <n>` — close a tab from the CLI (refuses the last).

**Deliberately deferred:**
- In-place reload after the agent updates a file. Workaround: call
  `duo navigate <same-url>` (targets the active tab). Revisit if the
  workaround feels annoying in practice.
- A `duo reload` command. Same workaround as above.
- Artifact-scoped permissions (e.g. block a prototype from making
  outbound fetch calls). MVP treats agent-generated HTML as fully
  trusted — it comes from the same agent the user is talking to.

---

## Stage 9 — Cozy-mode terminal (typography v1) `✅ Shipped 2026-04-22; graduated 2026-04-25`

> **PRD:** [docs/prd/stage-9-cozy-mode.md](docs/prd/stage-9-cozy-mode.md).
> All C1–C17 decisions and the validation checklist live there. Originally
> shipped behind a `(preview)` label on the menu item while the TUI
> shake-out window ran; validated via daily driving 2026-04-22 \u2192
> 2026-04-25 with no TUI regressions. Label dropped 2026-04-25.
>
> **Naming:** The terminal's flagship feature is "cozy mode" — per
> owner, because it's both **reading** (long agent prose) and (in a
> later wave) **writing** (composition decorations).
> [docs/research/terminal-cozy-mode.md](docs/research/terminal-cozy-mode.md)
> grounds the scope in what's actually feasible inside xterm.js around
> a running Claude Code instance.

**Layout placement:** middle column, top region (the terminal part of
the locked three-column layout in [DECISIONS.md § Layout model](docs/DECISIONS.md)).
Stage 9 is typography + outer-pane chrome only; the column relocation
itself happens as part of Stage 10.

**Goal:** ship the **reading** half of cozy mode — a terminal that feels
good for long, prose-heavy agent conversations — without breaking
Claude Code's TUI rendering. Per
[VISION.md § The flagship bet](docs/VISION.md#the-flagship-bet--the-reading-and-writing-pair).

**Resolved decisions (from research + owner):**

- **Scope:** per-terminal-tab toggle. Browser and editor tabs are
  unaffected; they have their own typography stories.
- **Keybinding:** menu item only (no global shortcut). Label: "Cozy
  mode (current tab)" under View.
- **What cozy mode v1 does:** typography pass + reader-width cap on
  the terminal pane.
    - `fontSize` 13 → 14.
    - `lineHeight` 1.2 → 1.4 (xterm.js's option, not CSS).
    - Softer foreground color for less TUI fatigue.
    - Generous outer-pane padding (16–20px).
    - CSS `max-width` on the terminal host at ~92ch so that wrapped
      agent prose doesn't stretch edge-to-edge on wide displays.
      `FitAddon.fit()` recomputes cols; `SIGWINCH` propagates to
      Claude Code, which re-lays out naturally. We already wire this
      resize path.
- **What cozy mode v1 does NOT do:**
    - **No compose-area markdown rendering.** Claude Code runs its
      own Ink-based input editor; stylizing it from the outside would
      mean building a Warp-style composition interposer. That is a
      separate, significantly bigger piece of work. See
      [research note §4](docs/research/terminal-cozy-mode.md).
    - **No click-to-cursor.** Claude Code turns on mouse tracking
      mode 1003; our click handler would collide with Claude's. Mouse
      passthrough to Claude is the right v1 behavior — its click
      handling in its own input editor is likely already adequate.
      See [research note §5](docs/research/terminal-cozy-mode.md).
    - **No letter-spacing or per-line CSS.** Breaks xterm.js cell
      alignment and selection.
    - **No DOM-renderer switch.** Slower on long output; the canvas /
      WebGL renderer stays. See [research note §2](docs/research/terminal-cozy-mode.md).

**Exit criteria:**

- Active terminal tab with cozy on feels *pleasant to read* for a
  30-minute exploratory conversation.
- Claude Code's TUI — box-drawing borders, progress spinners, diff
  output, `shift+tab` mode switches, `/tui fullscreen` — renders
  correctly in both cozy-on and cozy-off. No regressions.
- Toggle on/off survives a full agent answer streaming in without
  visual corruption.
- Reader-width max-width gracefully no-ops on narrow displays.

**Work items:**

- [x] Per-tab cozy state in renderer; menu item wired via Electron's
      app menu (View → Cozy mode — current tab).
- [x] `TerminalPane` applies the cozy font size, line height,
      padding, and reader-width cap when the per-tab flag is on.
- [x] localStorage persistence: per-tab map + last-choice default
      (PRD § C4–C6).
- [x] Validated via daily driving 2026-04-22 → 2026-04-25 (no TUI
      regressions in actual long-form Claude Code use); `(preview)`
      label dropped from the menu item, PRD, and this roadmap.

**Follow-up stages (not Stage 9):**

- **Stage 9b — Compose-area interposer (deferred).** The *writing*
  half of cozy mode — markdown-rendered composition — requires
  taking over Claude Code's input area. That's Warp-scale work
  (Warp wrote a terminal from scratch in Rust specifically for this).
  Defer; may fold into the Stage 11 editor arc once we have a
  production text-editing model to reuse. See
  [research note §4](docs/research/terminal-cozy-mode.md).
- Watch `anthropics/claude-code#22528` and `#26235` — if Claude Code
  starts emitting OSC 133 or custom prose-region markers, we gain
  scrollback decoration options and click-to-cursor becomes safer.
- [ ] Regression test checklist: TUI rendering inside Claude Code,
      `vim`, `less`, `fzf`, `htop`.
- [ ] Minimum: reader theme and default theme are both dark,
      professional, and discernibly different.

**Pulls in from old backlog:** the "Reader mode for the terminal"
bullet is now this stage.

---

## Stage 10 — File browser / context drawer `🔄 In progress — spec locked`

> **PRD:** [docs/prd/stage-10-file-navigator.md](docs/prd/stage-10-file-navigator.md).
> All v1 decisions (D1–D32) are captured there with a phased build plan.
> Supporting research: [docs/research/file-navigator-v1.md](docs/research/file-navigator-v1.md).

**Layout placement:** leftmost column, full-height, narrow. Per the
owner's locked layout (see [DECISIONS.md § Layout model](docs/DECISIONS.md)).
This stage also owns the layout reshape: relocating the terminal from
the left to the middle column and promoting today's `BrowserPane` +
`BrowserTabStrip` into a higher-level `WorkingPane` shell whose
unified tab strip supports mixed types (browser today; editor and
preview to follow in Stages 10 and 11).

**CLI naming settled** (was open): the file-surface CLI is **`duo view
<path>`**. `duo open` stays the browser-tab command (from Stage 8).
See [research note §6](docs/research/file-navigator-v1.md).

**Goal:** a sidebar surface that shows files around the current working
directory plus a pinned home scope, lets the user drag any file into the
agent conversation, and understands what the agent can do with each
type. Per [VISION.md § Visual file browser / context drawer](docs/VISION.md#visual-file-browser--context-drawer).

**Exit criteria:**
- A PM can see the contents of the folder they're working in without
  knowing or typing a path.
- Clicking a `.md` file opens it in the Stage 11 editor; clicking a
  `.png`/`.pdf` opens a read-only preview; clicking a `.csv` offers a
  summary action.
- "Open terminal here" seeds a new terminal tab with the selected
  folder as its launch CWD — preserving the Stage 7 decision.
- The agent can drive the navigator via `duo` commands (reveal, ls,
  state) without trampling the user's current selection.

**Keeps from old Stage 7:**
- Single shared, app-level tree (not per-tab).
- CWD handoff ("open terminal here" → `pty:create`).
- Architecture guardrails:
    - Per-type component registry (not a single editor instance).
    - `duo-file://` custom protocol handler for renderer → disk reads.
    - `Buffer` not forced utf8; binary types supported.
    - CLI commands take `path` + optional `mime`.
- CLI surface: `duo view <path>` (renamed from `duo open`), `duo reveal
  <path>`, `duo ls [path]`, `duo viewer close`, `duo viewer state`,
  `duo nav state`.

**Adds from VISION:**
- "Drag file → conversation" UX. Dropping a file into the active
  terminal issues `@path` into Claude Code's input (or the equivalent
  syntax the harness expects), so the file enters context without the
  user typing the path.
- Per-file-type action chips: summarize-this-CSV, diff-these-two,
  convert-PDF-to-markdown — driven by skills. Skill surface (Stage 12)
  catalogues which actions are available.
- Pinned "home scope" shortcut in the drawer (`~/` + any starred
  folders) for the "where are my docs again" moment.

**Work items:**
- [ ] `electron/navigator.ts` — shared tree UI, expand/collapse/reveal.
- [ ] Custom protocol handler (`duo-file://`) with path-policy checks.
- [ ] Bridge methods: `open/view/reveal/state/ls/nav-state`.
- [ ] New socket commands wired through `cli/duo.ts`.
- [ ] Drag-to-conversation: Electron's `dragstart` on a navigator row →
      shell input injection to the active PTY (`ptyManager.write` with
      `@path ` + space).
- [ ] Per-type previewers registered for: `.md` (full Stage 11 editor),
      `.png`/`.jpg`/`.gif` (native image), `.pdf` (Electron's built-in
      viewer), `.csv` (first 50 rows in a scrollable table).
- [ ] `skill/SKILL.md` updated with navigator/viewer patterns +
      drag-to-conversation affordance.

**Stage 10 follow-ups (raised 2026-04-25):**
- [ ] **Persist tree expand/collapse state across relaunches.** The
      navigator's `NavStateSnapshot` already carries `expanded:
      string[]`; today it's in-memory. Persist to localStorage (or
      Electron `userData`) and rehydrate on app boot so the user's
      tree shape survives a quit/relaunch. Also covers per-tab
      memory if the navigator ever goes per-tab. Keys live alongside
      the existing nav-state push channel.
- [ ] **Highlight files that are open in WorkingPane tabs.** Any file
      tab in `fileTabs` (App.tsx) should render a visible accent on
      its corresponding navigator row — same affordance as VS Code's
      "open editors" subtle highlight. Bonus: a small dot or chip
      indicating dirty state for `.md` editor tabs (already tracked
      via `tab.dirty`). Plumbing: navigator subscribes to a derived
      `openPaths: Set<string>` from `fileTabs`; the tree row component
      checks membership at render time.

---

## Stage 11 — Collaborative markdown editor (human↔agent) `🔄 11a shipped 2026-04-24; 11b–e next`

> **PRD:** [docs/prd/stage-11-markdown-editor.md](docs/prd/stage-11-markdown-editor.md).
> All v1 decisions (D1–D34 plus D12a table controls, D29a–c selection
> API + persistence, D33a–f new-file + theme + shortcut guarantees)
> are captured there with a 5-sub-stage build plan. The sub-stage
> sketch below is kept for dependency context; the PRD is authoritative
> for scope + decisions.
>
> **11a shipped (2026-04-24):**
> TipTap/ProseMirror editor, tiptap-markdown serializer with frontmatter
> preservation, core marks + nodes (H1–H6, B/I/U/S, inline code,
> blockquote, lists, task lists, horizontal rule, links, images),
> GFM tables with contextual row/col toolbar, syntax-highlighted
> fenced code blocks via lowlight, atomic autosave + `⌘S` + dirty dot,
> `⌘N` new-file flow with filename interstitial that hands focus to
> the prose on commit, persistent selection overlay across focus
> changes, theme toggle (System/Light/Dark) with macOS appearance
> follow, xterm terminal theme swap. CLI: `duo edit`, `duo selection`,
> `duo doc write` (replace-selection / replace-all), `duo theme`.
>
> **11a tail (3 items pending — call this 11a.1):**
> Frontmatter properties panel (D15, D16) — YAML preserved on disk
> but invisible in the UI today. Paste + drag-drop images (D9, D13,
> D32) with sibling `<stem>_assets/` folder per PRD. Slash menu
> (D7) + floating selection bubble (D5). Each is a small, focused PR.
>
> **11b–e pending:**
> 11b external-write reconciliation (chokidar + three-pane diff),
> 11c full agent-write transient highlight + warn-before-overwrite,
> 11d CriticMarkup track-changes + comment rail, 11e outline sidebar
> + find & replace.

**Layout placement:** a new tab type (`editor`) inside the right-column
Viewer/Editor shell. The shell has one unified tab strip across all
modalities — browser, editor, preview — so the same `duo tabs`
list can contain mixed types (e.g. tab 1 Gmail, tab 2 a `.md` file,
tab 3 an HTML source editor, tab 4 a rendered-browser tab of that
HTML file). The editor does not replace the browser; it sits beside
browser tabs in the shared strip. Scope is local `.md` files only —
Google Docs stays as a browser-type tab via the verified
`/export?format=md` read path. See
[DECISIONS.md § Layout model](docs/DECISIONS.md).

**Goal:** build a rich editing surface for local `.md` files that
**feels like Google Docs** on the human side and is **a first-class
collaboration surface** on the agent side. Not "a markdown renderer."
The editor is a view onto a file the agent reads and writes too, and
the experience of working together inside it is the point.

**Why this is flagship-scale, not a backlog bullet:**
- This is the surface PMs will spend the most time in. Terminal and
  browser are instrumental; the editor is where drafts happen.
- Every other cloud-docs editor the primary persona knows — Google
  Docs, Notion, Quip, Dropbox Paper — has invested dozens of
  person-years into live formatting, typography, collaboration, and
  change review. Duo doesn't need to match all of that, but it needs to
  make the collaboration-with-an-agent shape feel native rather than
  grafted on.
- Open GitHub issues #5, #6, #7 all describe this editor.

**Exit criteria:**
- A PM opens a `.md` file, sees clean prose typography (no visible
  asterisks or pound signs unless they explicitly show markup), types,
  saves, and the file on disk is plain markdown the agent can read and
  rewrite.
- When the agent rewrites the same file, the editor shows what changed
  (issue #5), and the user can accept, reject, or ignore the change
  (issue #6).
- Nothing is ever lost to an accidental overwrite (issue #7).

**Sub-stages** (ordered by dependency — each validates the next):

### 11a — Core editor and file binding

- [ ] Pick the editor framework. Primary candidates:
    - **ProseMirror (direct or via TipTap):** canonical foundation for
      collaborative editors (Notion, CodeMirror, Tiptap all build on
      it). Rich model, clean markdown round-trip via remark.
      Heavier.
    - **CodeMirror 6 + markdown plugin:** lighter, text-centric,
      great fine-grained editing, but decorations-driven "live
      formatting" is more work to polish.
    - **Lexical:** newer, React-native. Good alignment with our
      renderer but less mature collaboration story.
  Decision at Stage 11a kickoff; blocking.
- [ ] Live formatting for the markdown subset we commit to: H1–H6,
      bold, italic, inline code, code fences (with language hints),
      blockquote, ordered and unordered lists (nested), links, images,
      horizontal rules, tables.
- [ ] Typography pass — prose width, heading hierarchy, line-height,
      font stack. Must *feel* like Google Docs / Notion.
- [ ] Round-trip fidelity: parse `.md` → editor model → serialize
      back to `.md`; byte-equality-preserving (or documented minimal
      normalization) for files the editor wrote itself.
- [ ] Save on ⌘S and on autosave tick. Write via the Stage 10
      `duo-file://` protocol handler where possible.
- [ ] Keyboard shortcuts: ⌘1..6 for H1–H6, ⌘B/I/U/K standard set,
      ⌘L for list, ⌘⇧K for code, ⌘Z/⌘⇧Z undo/redo, ⌘/ comment
      toggle.
- [ ] Paste-from-web: HTML clipboard → markdown via a sanitizer.
- [ ] Drag-and-drop image: copy the file into a sibling `assets/`
      folder and insert `![alt](assets/…)`.

### 11b — Agent-visible change surface (GitHub issue #5)

- [ ] File-watcher bound to the open file. When the agent writes to
      the file on disk, the editor detects the change and enters a
      "changes-from-disk" state.
- [ ] Visual diff within the editor: new/removed/modified ranges
      highlighted inline (green/red gutters, strike-through for
      removals, underline for insertions).
- [ ] Scroll-to-change: auto-scroll to the top of the first agent-made
      change on arrival. Debounced so rapid-fire writes don't jerk the
      viewport.
- [ ] "Changes from Claude" strip at the top of the editor with a
      count and prev/next navigation.
- [ ] Decision: does the agent's write land *immediately* in the
      editor model, or is it buffered until the user clicks accept?
      See Stage 11d for the pending-suggestion path.

### 11c — Save state and overwrite safety (GitHub issue #7)

- [ ] Unsaved-work indicator (conventional dot on the tab, `⌘S`
      still saves).
- [ ] Warn-on-close with unsaved edits.
- [ ] Detect disk-change-while-editing: if the agent (or another app)
      rewrites the file while the user has an unsaved buffer, show a
      conflict dialog — keep mine / take theirs / merge — and never
      silently clobber either side.
- [ ] Warn-before-overwrite for the agent-write path: if the agent is
      about to write to a file the user is actively editing, surface
      a one-shot confirmation the user can accept/decline from inside
      the editor chrome, not in the terminal.
- [ ] Autosave throttle — don't write so often that external tools
      (git, LLM file-watchers) see a fluttering file.

### 11d — Track changes / suggest mode (GitHub issue #6)

- [ ] Model extension: every text range gets a provenance
      (`user | agent | accepted`). Agent writes land as *suggestions*
      rather than immediate edits when suggest-mode is on.
- [ ] Suggestion cards: each agent suggestion shows as a pending
      block with accept / reject / modify controls. Matches Google
      Docs' suggestion mode in feel.
- [ ] Bulk accept / reject all.
- [ ] Suggestion authorship attribution — "Claude suggested this
      paragraph at 14:32" — visible on hover.
- [ ] Decision: default on or off? Probably per-file or per-session;
      resolve at kickoff.

### 11e — Selection and conversation primitives (VISION collaboration)

*Issue #10 — resolved shape.* `duo selection` returns three
fields: the selected text, the surrounding paragraph, and the
nearest heading path (e.g. `Risks > Market`). Agent gets enough
context to respond to "fix this" without loading the whole doc.

- [ ] Selection-as-context: `duo selection` CLI. Output:
      `{ path, text, paragraph, heading_trail }`.
- [ ] Comments pinned to paragraphs: user can ask the agent a
      question about a specific paragraph; the thread stays anchored
      to that block across edits (like Docs).
- [ ] Anchor agent replies back to paragraphs: when the agent says
      "this section should…", it can include a paragraph handle the
      editor uses to highlight or scroll to.
- [ ] Shared undo history: the user's ⌘Z can undo agent edits; a
      future `duo undo` could undo the user's (deliberately deferred
      until the interaction model is clearer).

**Deliberately deferred / not-in-MVP:**
- Real-time multi-cursor (the agent doesn't "type live" — it
  writes-then-reveals).
- Rich inline media (tables-with-formulas, embedded charts) — plain
  markdown tables are v1.
- Export to docx/pdf — markdown is the canonical format; convert at
  the seams.

**GitHub issues absorbed:**
- #5 → Stage 11b
- #6 → Stage 11d
- #7 → Stage 11c
- #10 → Stage 11e

---

## Stage 12 — Unified skill + connector surface `⬜ Supersedes Stage 4`

**Layout placement:** middle column, below the terminal, collapsible.
Per [DECISIONS.md § Layout model](docs/DECISIONS.md). When collapsed,
the terminal takes the full middle column. Default state (expanded vs
collapsed) is an open decision at Stage 12 kickoff.

**Goal:** one in-app surface for everything a user configures *about*
their agent — skills available now, skills they could install, MCP
connectors configured (Slack, Jira, Notion, Google, GitHub), and the
starter pack. Per [VISION.md § Skill discovery, install, and editing]
and [§ Connector / MCP setup wizard](docs/VISION.md#connector--mcp-setup-wizard).

**Scope (draft, will sharpen at kickoff):**
- [ ] Skill list: merged view of `~/.claude/skills/`, project
      `.claude/skills/`, and repo-bundled `skill/` — with provenance
      per row, toggle on/off, and "what does this do" preview.
      Uses the Stage 4 scanner as its data source.
- [ ] Skill detail pane: preview SKILL.md, list the commands /
      subagents it exposes, show usage examples.
- [ ] Skill editing / creation from template (simple schema-backed
      form + "edit the underlying .md" escape hatch).
- [ ] MCP connector wizard: curated set (Slack, Jira, Google, Notion,
      GitHub). Walks the user through OAuth; writes `mcp.json`
      behind the scenes.
- [ ] Starter pack: opt-in on first launch, installs a curated
      bundle of PM-shaped skills (PRD drafting, competitive scan,
      interview synthesis, etc.).

---

## Stage 13 — Interaction polish `⬜ After Stage 11`

**Goal:** a cluster of small UX wins that matter once the flagship pair
is up. Pulls from the unscheduled backlog the user raised earlier.

- [ ] **Tab numbers in the unified Viewer/Editor tab strip.** Render
      the 1-based `duo tabs` id on each tab chip so the user can
      naturally say "read tab 1, write the summary into tab 2". Works
      across all tab types (browser, editor, preview) since the tab
      strip is unified (see [DECISIONS.md § Layout model](docs/DECISIONS.md)).
      Plumbing already exists for browser tabs; this stage just ensures
      the visible chip renders the id for every type.
- [ ] **Terminal selection / clipboard refinements.** Click to move
      cursor (when the foreground process isn't in mouse-tracking
      mode), `⌘A` copies the current command composer line, `⌘⇧A`
      copies the full scrollback. Respect TUI foreground apps that
      take over mouse events.
- [ ] **`duo reload`** — a pair for `duo navigate` that doesn't
      require a URL, reloads the active tab in place. Low effort,
      high ergonomic payoff for the Stage 8 iteration flow.
- [ ] **`duo wait --timeout` / CLI socket timeout race.** Make the
      CLI's socket timeout `max(explicit + buffer, default)` so
      `duo wait --timeout 15000` stops hitting the 10s socket cap.
- [ ] **TCP fallback alongside the Unix socket.** Claude Code's
      macOS sandbox blocks Unix-domain-socket outbound connections
      by default but permits localhost TCP, so today every `duo`
      command silently fails inside a sandboxed Claude Code
      session. Add a second `server.listen(0, '127.0.0.1')` in
      `electron/socket-server.ts`, publish the port + a per-install
      auth token to `~/Library/Application Support/duo/duo.port`,
      and teach `cli/duo.ts` to fall back to TCP on
      `EPERM`/`ECONNREFUSED`/timeout. Mirrors the
      `dudgeon/chrome-cdp-skill` fix for the same class of problem.
      See `docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant
      transport and install paths for the `duo` CLI*.
- [ ] **`duo doctor` diagnostic.** New CLI verb that reports
      socket-reachable / TCP-fallback-reachable / install path
      writable / `~/.claude/skills/duo/` synced / version match.
      Prints a clear "Claude Code sandbox detected — falling back
      to TCP" line when appropriate. Paired with a skill
      instruction to run `duo doctor` on the first failed command
      so the sandbox failure mode is named, not inferred. See
      `docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant
      transport and install paths for the `duo` CLI*.
- [x] **Window drag region fix (issue #17, shipped).** Before the
      fix the top chrome row's drag surface was shrunk to the
      traffic-light sliver by its children; now the entire 40px top
      strip drags the window.
- [ ] **PTY-side sandbox operations audit (issue #12).** The merged
      ADR in `docs/DECISIONS.md` covers transport + install paths,
      but the question "which operations inside a Claude-Code-
      sandboxed PTY fail that wouldn't fail in a raw Terminal.app
      session?" is still open. Empirically walk the most common
      shell primitives (git clone, npm install, file I/O across
      `$HOME`, network calls, cross-app `open`, symlinks, etc.) and
      log which the sandbox blocks. Report as a `docs/research/`
      note; feed back into the skill so agents can steer away from
      known-blocked operations without trying them first.

---

## Stage 15 — Human↔agent interaction primitives `⬜ After Stage 11`

**Goal:** the little seams between agent and user that VISION needs
but Stage 10 / 11 don't deliver. Grouped as a single stage because
they share a rhythm — small CLI verbs + small UI affordances — and
can ship incrementally.

Cross-references GitHub issues #11, #13, #15, #18, #19.

### 15a — Agent-watchable events (`duo events`)

*Issue #19.* V1 is a pull model (owner: "okay as v1, we'll want
push later").

- [ ] New CLI: `duo events [--since <cursor>] [--follow] [--source
      browser|editor|all] [--kinds click,submit,selection,…]`.
      Returns NDJSON of user-interaction events since the cursor;
      `--follow` streams until killed.
- [ ] Event shape: `{ ts, source, kind, details }`. For browser,
      leverages CDP `Page.*` hooks (click, navigated, form-submit).
      For editor, hooks selection-change + save events from the
      Stage 11 model.
- [ ] Ring buffer per source (size ~200) so a late-arriving agent
      can still catch up.
- [ ] Skill pattern: "agent driving an interactive lesson polls
      `duo events --since <cursor>` between prompts."

**V2 (later):** push model — Duo writes agent-bound markers into
the PTY; Claude Code's input layer agrees on a protocol. Not ruled
out; not needed for v1.

### 15b — Notifications (`duo notify`)

*Issue #15.* Scope resolved: **macOS system notifications only**
(owner pick).

- [ ] New CLI: `duo notify [--tab <n>] [--title <text>] <body>`.
      Fires an Electron `Notification`. Title defaults to the tab
      name if `--tab` is provided; body defaults to the last agent
      question the tab emitted.
- [ ] Click-through focuses Duo + the named tab.
- [ ] Skill pattern: "agent hits a decision point it needs the user
      for → `duo notify --tab <n> \"Reviewing your PRD — need
      direction\"`."
- [ ] Name fallback rules: explicit `duo tab name` → Claude session
      name (if we can extract it) → shell's own `\\033]0;…\\007`
      OSC 0 title → "Terminal".

### 15c — Tab identity (`duo tab name` + subtitle)

*Issue #18.* Scope resolved: **agent-set, user-overridable** (owner
pick).

- [ ] New CLI: `duo tab name <text> [--tab <n>]`. Writes to
      renderer-side tab metadata.
- [ ] Render: small subtitle under the tab's primary title (e.g.
      main title "~/duo", subtitle "reviewing PRD §2"). Subtitle
      truncates aggressively.
- [ ] User override: click the subtitle to edit inline; user edit
      wins over future agent writes until cleared.
- [ ] `duo tab state [--tab <n>]` returns the current metadata so
      the agent can read back what it (or the user) set.

### 15d — Send command to terminal (`duo tab --cmd`)

*Issue #13.* Scope resolved: **new tab + pre-typed command, user
hits Enter** (owner pick).

- [ ] Extend `duo tab` / introduce `duo send-cmd`. Two surfaces:
    - `duo tab --cmd "<cmd>"` → creates new terminal tab, writes
      command onto the composer WITHOUT Enter, focuses the tab.
    - `duo send-cmd <n> "<cmd>"` → writes command into tab `n`'s
      composer, no Enter.
- [ ] Pre-typed, not executed. User reads, optionally edits, then
      presses Enter. Matches "honest consent" — the agent can
      prepare work without running anything on its own.
- [ ] Skill pattern: "agent wants to hand the user a temp script →
      `duo tab --cmd \"node /tmp/duo-script-xyz.js\"`."

### 15e — Browser-element "zap" (`duo zap` + right-click)

*Issue #11.* Scope resolved: **`{selector, text, role}` packet**
(owner pick).

- [ ] Right-click any element in Duo's browser pane → context menu
      item "Zap to terminal composer."
- [ ] On zap: Duo resolves the element to `{selector, text, role}`
      and injects `duo-zap: { "selector": "...", "text": "...",
      "role": "..." }` (pretty-printed JSON) into the active
      terminal composer.
- [ ] `duo zap <selector>` CLI companion for agent-driven zaps
      (agent identifies the element, pipes the same packet into its
      own scratch).
- [ ] Keeps the user in the consent loop — no automatic send; they
      see the packet and hit Enter to pass it to Claude Code.

### 15f — File path → terminal composer

*Issue #9.* Scope resolved: **drag + right-click, both** (owner
pick).

- [ ] Drag a file / folder row from the navigator onto the active
      terminal column → path injected into the composer as `'path' `
      (quoted + trailing space). Works as long as the foreground
      shell process accepts keyboard input.
- [ ] Right-click menu in the navigator gains "Send path to active
      terminal." Uses the same injection path.
- [ ] Both affordances complement Stage 10 § D11 menu items (which
      already has "Open terminal here" for folders).

### 15g — "Send → Duo" cross-modality selection primitive

*Raised by owner 2026-04-25.* Floating button next to any selection
in any WorkingPane tab type (browser, editor, future preview) —
clicking sends the selection into the active terminal's input line
with no Enter pressed, so the user can complete the prompt
("rewrite this paragraph", "summarize this", "find similar issues").

User-facing complement to the agent-facing `duo selection` and
`duo zap` verbs; same payload shape, opposite direction.

- [ ] Editor button via TipTap BubbleMenu + `duo send` CLI +
      `duo selection-format [a|b|c]` CLI (15g.1).
- [ ] Browser selection observer + page-side script + same button
      anchored over `WebContentsView` (15g.2). Unifies `duo selection`
      across editor + browser surfaces (also resolves the P0 gap in
      [docs/CLI-COVERAGE.md § Browser observability](../docs/CLI-COVERAGE.md)).
- [ ] Polish: length cap, image/table flattening, `⌘D` shortcut, skill
      update so agents understand the injected format (15g.3).

**PRD:** [docs/prd/stage-15g-send-to-duo.md](docs/prd/stage-15g-send-to-duo.md).
**No decision gate before kickoff** — G10 payload format locked to
**A** (quote + provenance) on 2026-04-25, with B and C kept on the
books and switchable at runtime via the new `duo selection-format`
verb (G19). Smaller open questions at kickoff: G5 (`⌘D` keyboard
shortcut conflict with browser bookmark muscle memory) and G7
(consent UX for the floating button — match Notion/Docs convention,
no first-run tooltip).

---

## Stage 16 — Multi-window `⬜ Backlog — after Stage 11`

*Issue #16.* Scope resolved: **backlog for later** (owner pick).

Independent windows, each containing the full Duo workspace (Files
+ Terminal + WorkingPane). Windows don't share state in v1 —
simplest model. Deferred until after the flagship editor ships;
touches session-restore, window-level menu routing, and
cross-window focus logic.

- [ ] New-window menu item (`File → New Window`, `⌘N`).
- [ ] Per-window `BrowserWindow` with its own PtyManager,
      BrowserManager, CdpBridge, SocketServer. Most state already
      scopes to a window naturally.
- [ ] Socket path scheme — one socket per window? or one shared
      socket with window ids? Resolve at stage kickoff.
- [ ] `duo` CLI: how does it address windows? Options at kickoff:
      `duo --window <n>` / env var / "most recent active window" as
      default.

---

## Backlog — unscheduled

> Raised but not promoted into a stage. Revisit when the flagship pair
> (Stages 9–11) is shipping.

### File / directory search in the navigator

**Problem:** the file navigator is tree-only today. For large projects,
"find me the PRD" means clicking down through folders. PMs expect
Cmd-P / Spotlight-style quick open.

- [ ] **`⌘P`** opens a search overlay (input + scrollable result list)
      inside the Files column. Typeahead-matches file and folder names
      against the user's current navigator subtree.
- [ ] Ranking: exact filename match first, then prefix, then substring;
      recently-opened files float to the top (hooks into the working-pane
      tab history).
- [ ] **Arrow keys + Enter** to pick; Enter on a file opens it (same
      path as single-click), Enter on a folder navigates the tree there.
- [ ] **Scope** is "anywhere under the navigator's current `cwd`" by
      default; a toggle widens to `$HOME` or all-drive. Respect the
      dotfile rule (except `.claude/`); respect `.gitignore` when
      available (optional v1).
- [ ] **Indexing**: lazy — walk the tree on first Cmd-P open per `cwd`,
      cache in memory, invalidate via the Phase 1 file watcher when
      `.gitignore` says so or when the user changes `cwd`. Target is
      "cheap for a 50k-file repo"; if bigger, page through the results
      instead of building a full index.
- [ ] **`duo search <query>`** CLI command so the agent can use the same
      surface programmatically (returns ranked JSON).
- [ ] **"Open Duo at this file"** — nice-to-have for quick-open: after
      opening the result in the Viewer/Editor, move the navigator to
      reveal it in the tree.

Ties to the Phase 1 file watcher (already in place) and the
`files.list` IPC. Biggest design call: do we ship a full fuzzy-match
algorithm (`fzf`-style) or just substring — pick at stage kickoff.

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
| Distribution / cert | **No cert — personal use** | Ad-hoc or unsigned; get cert before Stage 14b |
| Stage 14 split (2026-04-26) | **14a: first-launch self-install (no cert), 14b: distribution polish (cert-gated)** | Decouples user-facing first-launch UX from cert procurement so 14a can ship to Trailblazers ahead of 14b |

## Open Questions

| Question | Needed Before |
|---|---|
| Apple Developer ID cert | Stage 14b |
| Distribution timeline (personal → Trailblazers) | Stage 14b |
| Socket auth approach for Trailblazers | Stage 14b |
| Sandbox-tolerant transport: TCP fallback + `duo doctor` + install-path fix (see `docs/DECISIONS.md` → Open ADRs: *Sandbox-tolerant transport and install paths for the `duo` CLI*) | Stages 5 (docs), 13 (transport), 14a (install path + settings fragment) |
