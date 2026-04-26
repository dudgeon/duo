# Duo — Roadmap

> Status legend: ✅ done · 🔄 in progress · ⬜ not started
>
> **⚠️ This is the synced markdown view. The canonical roadmap is
> [`docs/roadmap.html`](roadmap.html)** (Atelier-styled, with a
> sidebar and per-stage comment boxes). Open it via Claude desktop
> preview at `http://localhost:8765/roadmap.html` (`.claude/launch.json`
> `roadmap` config) or directly in a browser. When the two files
> diverge, the HTML wins. This markdown is maintained alongside —
> useful for `grep`, `git blame`, and agents reading via `cat`,
> but it is not the source of truth.
>
> **Stage numbers reflect the actual build order** (renumbered
> 2026-04-26). The previous ordering — chronological-of-planning —
> obscured dependencies. Per-stage sections below are sequenced by
> the new numbers. See [§ Number history](#number-history-2026-04-26-renumber)
> for the old ↔ new map; commit messages and historical PRDs may
> still reference old numbers.
>
> **Cross-references:**
> [VISION.md](docs/VISION.md) (north star) ·
> [DECISIONS.md](docs/DECISIONS.md) (architecture) ·
> [CLI-COVERAGE.md](docs/CLI-COVERAGE.md) (CLI verb inventory) ·
> [docs/design/atelier/](docs/design/atelier/) (visual design bundle) ·
> [docs/prd/](docs/prd/) (per-stage PRDs).

---

## Owner pre-work (action items — start now to unblock Stage 21)

Stage 21 (distribution polish) is gated on Apple Developer ID cert
procurement, which has multi-day lead times. Geoff can do this work
in parallel with everything else; nothing in the codebase blocks it.

- [ ] **Enroll in the Apple Developer Program** ($99/year individual
      or $299/year organization). Identity verification typically
      takes 1–2 business days; organization enrollment can take a
      week. Start date matters more than completion date — kicking
      this off today shaves real weeks off Stage 21.
      → [developer.apple.com/programs](https://developer.apple.com/programs/)
- [ ] **Register the bundle ID** in App Store Connect (e.g.
      `com.geoffreydudgeon.duo` or org-prefixed). Required before
      cert generation.
- [ ] **Generate "Developer ID Application" certificate** in Keychain
      Access via the Apple Developer portal. Signs the `.app`.
- [ ] **Generate an App Store Connect API key** (preferred over
      app-specific password) for `notarytool`. One key serves
      notarization for all future builds.
- [ ] **Capture the Team ID** (visible in the Developer portal) —
      Stage 21 wires it into `electron-builder.yml`.

When all five are done, hand the agent: cert name as it appears in
Keychain (e.g. `Developer ID Application: Geoffrey Dudgeon (TEAMID)`),
Team ID, API key file path + key ID + issuer ID. Stage 21 picks up
from there.

The existing dev cert (used for local `npm run dist` validation
2026-04-26) is **expired** per Team C's audit — distribution-grade
signing was always going to need a fresh cert chain anyway.

---

## Layered build order (the actual sequence)

The dependency graph is layered, not linear. Each layer can ship in
parallel where work items don't overlap; later layers depend on
earlier ones for tokens, primitives, or surfaces. Backlog items have
no fixed slot — pull them in when convenient.

```
Layer 0 — Visual foundation (single ship moment)
   12  Atelier visual + Stage 9 cozy-visual completion (rides along)

Agent ergonomics (✅ shipped 2026-04-26 late-evening)
   5v2  Duo subagent — broader scope, smaller model (Haiku 4.5);
        subsumes duo-browser. All Class A + C live walks pass.
        Class B perf inverted PRD hypothesis — Claude Code routes
        mechanical work to Haiku regardless, so subagent stacks a
        second Haiku layer. Qualitative wins (bounded context,
        specialized prompt) justify the architecture. New
        `duo external <url>` verb + session guard + web routing
        rule shipped. PRD: docs/prd/stage-5-v2-duo-subagent.md.
        FOLLOWUP-002 (guard hardening) + FOLLOWUP-003 (cumulative-
        context perf re-measurement) low-priority.

Layer 1 — Editor maturation (built against Layer 0 tokens)
   13  Editor: just-added highlight + warn-before-overwrite          ✓ shipped
   15.1 Send → Duo (editor pill + CLI verbs)                          ✓ shipped
   15.2 Send → Duo (browser pane pill + CDP selection observer)       ✓ shipped
   15.3 Send → Duo (length cap, image flatten, ⌘D, polish)
   14  Editor: track changes (Suggesting / Accepted)
   16  Editor: external-write reconciliation (parallel — independent of 12)

Layer 2 — New surfaces (built against Layer 1)
   17a HTML canvas — render + edit primitive                          ← next
   17b–e HTML canvas — IDs/sidecar, agent overlay, comments, polish

Layer 3 — Distribution-readiness (parallel track, runs alongside L0–L2)
   18  First-launch self-install (no cert needed)
   19  Duo detection: priming + default-claude tabs (folds into 18 consent)
   20  Interaction polish: duo doctor + TCP fallback + pane-aware shortcuts

Layer 4 — Distribution finalization (gated on cert + L3 stable)
   21  Distribution polish (cert + notarize + auto-update + session restore)

Backlog (no fixed order — pull in when convenient)
   • 11a tail (frontmatter panel, drag-drop images, slash menu)
   • Editor outline + find (was 11e)
   • Skill + connector surface (was old Stage 12)
   • Multi-window (was old Stage 16)
   • Smaller 15-family primitives (notify, events, tab-name, tab-cmd, zap, file→composer)
```

| # | Stage | Ship state | Layer |
|---|---|---|---|
| 1 | Core shell (terminal, tabs, layout) | ✅ done | foundation |
| 2 | Browser pane + SSO | ✅ done | foundation |
| 3 | `duo` CLI bridge + CDP primitives | ✅ done | foundation |
| 5 | Skill + subagent authoring | ✅ done | foundation |
| **5 v2** | **Duo subagent — broader scope, smaller model** (Haiku 4.5; subsumes `duo-browser`; new `duo external` verb + session guard + web routing) | ✅ **shipped 2026-04-26 late-evening** — Class A + C live walks pass; **Class B inverted PRD hypothesis** (subagent path costs ~2× more on synthetic — Claude Code already routes mechanical work to Haiku; qualitative wins remain real). PRD: [docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md) | **agent infra** |
| 8 | Agent-generated HTML via `duo open` | ✅ done | foundation |
| 9 | Cozy-mode terminal (typography v1) | ✅ shipped 2026-04-22 · visual completion folds into 12 | foundation |
| 10 | File browser / context drawer | 🔄 in progress (spec locked) | foundation |
| 11 | Collaborative markdown editor — core (11a) | ✅ 11a shipped 2026-04-24; tail items in backlog; 11b/c/d/e promoted to top-level Stages 16/13/14/Backlog | foundation |
| **12** | **Visual redesign — Atelier** (system-wide token swap, light-as-hero, layout depth, tab-strip rhyme, files-pane width 208 + collapse-to-rail) | 🟡 Phases 1–3 shipped 2026-04-26; whisper-level agent presence still pending | **L0** |
| **13** | **Editor: just-added highlight + warn-before-overwrite** (yellow `mark` + 6s fade per Atelier mock; cross-refs issues #5, #7) | ✅ shipped 2026-04-26 evening — Phase 0 selection-union refactor + 13a (highlight) + 13b (banner) all in `primitives/`; `--duo-mark` token bumped for contrast against cream paper | **L1** |
| **14** | **Editor: track changes (CriticMarkup / Suggesting / Accepted)** (cross-refs issue #6) | ⬜ ships visual layer as editor-agnostic primitives (`<TrackedRangeMark>` `<AcceptAllBanner>` `<CommentRail>`); MD data binding lives in TipTap extension; HTML canvas binding deferred to 17 v2 | **L1** |
| **15** | **Send → Duo** (floating pill + `duo send` + `duo selection-format` CLI) | 🟡 **15.1 ✓ + 15.2 ✓** shipped 2026-04-26 late-evening. 15.1 = editor pill + CLI verbs. 15.2 = browser pane pill via CDP-backed page-side observer (data plane verified live: binding registered, observer injected, payload captured). 15.3 = polish (length cap, image flatten, ⌘D) — defer until felt. PRD: [docs/prd/stage-15-send-to-duo.md](docs/prd/stage-15-send-to-duo.md). | **L1** |
| **16** | **Editor: external-write reconciliation** (chokidar + 3-pane diff + warn-before-close; was 11b; cross-refs issue #7) | ⬜ independent of 12 — can ship anytime | **L1 parallel** |
| **17** | **HTML canvas** (was Stage 19; new WorkingPane tab type for `.html`) | ⬜ depends on 13 + 15 + 12 | **L2** |
| **18** | **First-launch self-install** (was 14a; double-click → app prompts → copies skill/agent into `~/.claude/`, installs CLI to sandbox-safe PATH; **no cert needed**) | ⬜ `npm run dist` validated 2026-04-26 (commit `20b4701`) | **L3** |
| **19** | **Duo detection & default-to-claude tabs** (was Stage 18; env signals + passive priming + split-button TabBar + `duo new-tab` CLI) | 🔄 Phase 19a (env signals) shipped 2026-04-26 in commit `640ec0e` (originally tagged "18a"); 19b folds into 18 consent; 19c needs 12 | **L3** |
| **20** | **Interaction polish + `duo doctor` + TCP fallback + pane-aware shortcuts** (was Stage 13; cross-refs issues #12, #22, #23) | ⬜ unblocked by 19's `DUO_SESSION` for `duo doctor` | **L3 parallel** |
| **21** | **Distribution polish** (was 14b; code sign + notarize + auto-update + session restore + browser history; cross-refs issues #24, #27) | ⬜ **gated on Apple Developer ID cert** — see § Owner pre-work above | **L4** |

**Backlog** (no fixed order — Stage numbers don't apply; pull in when convenient or tied to a specific feature):

| Item | Notes |
|---|---|
| Stage 11 tail items | Frontmatter properties panel, drag-drop images, slash menu, floating selection bubble (D5/D7/D15/D16 in stage-11 PRD) |
| Editor outline + find | Was 11e — outline / TOC sidebar, find & replace, spellcheck |
| Skill + connector surface | Was old Stage 12 — collapsible right-side panel for skill discovery + connector inventory |
| Multi-window | Was old Stage 16 — independent windows per workspace ([issue #16](https://github.com/dudgeon/duo/issues/16)) |
| 15-family primitives still pending | `duo events --follow` (issue #19), `duo notify` (issue #15), `duo tab name` (issues #15, #18), `duo tab --cmd` (issue #13), `duo zap` (issue #11), file → composer (issue #9) |
| File / directory search in navigator | `⌘P` quick-open against the user's current navigator subtree |
| Line-numbers toggle in markdown editor | Optional gutter showing line numbers, toggleable per-tab; `duo` CLI parity per CLAUDE.md §4. Useful when collaborating with an agent that references source positions. |
| Navigator polish & ergonomics pass | Bundle (filed 2026-04-26): (1) double-click to open / single-click to select — unlocks selection state for context-menu actions; (2) highlight active terminal's CWD in the tree as ambient signal; (3) distinguish open-but-inactive from active in the file row highlight (refines existing Stage 10 follow-up "highlight files open in WorkingPane tabs"); (4) verification spike — does "new terminal" default CWD to current navigator view? (Stage 10 PRD silent on the default); (5) **BUG-007** — deleted files linger until reload (filed in `tasks.md`); (6) right-click delete (`shell.trashItem` for macOS-native trash) / inline rename + CLI parity `duo file rename` / `duo file trash`; (7) hover-action on folder rows: tiny clawd-icon button → opens new terminal tab with CWD = folder AND auto-launches `claude` in fresh PTY (CLI parity overlaps with backlog 15-family `duo tab --cmd` — could reuse as `duo new-tab --cwd <path> --cmd "claude"`). Items 1+6+7 share the row-interaction surface and ship well together. Card lives at [`docs/roadmap.html#backlog-nav-polish`](docs/roadmap.html). |

Stages 4 (skills panel — CWD-scan narrow scope) and 7 (file navigator
viewer — thin read-only version) and 6 (polish — split into 18 + 21)
are **superseded** by this sequence. Their work items are absorbed
into Stages 10, 11, 12, 18, 21 (see § Number history).

---

## Number history (2026-04-26 renumber)

The renumber on 2026-04-26 made stage numbers reflect actual build
order. Old numbers stay valid in commit messages and historical
documentation; this map lets a reader translate.

| Old | New | Stage |
|---|---|---|
| 6 | split → 18 + 21 | Original "Polish & Distribution" — split 2026-04-26 into installer (now 18) + cert-gated polish (now 21) |
| 11b | 16 | External-write reconciliation (chokidar + 3-pane diff) |
| 11c | 13 | Just-added highlight + warn-before-overwrite |
| 11d | 14 | CriticMarkup track-changes + comments |
| 11e | Backlog | Outline + find + polish |
| 11a tail | Backlog | Frontmatter panel, drag-drop, slash menu |
| 12 | Backlog | Skill + connector surface |
| 13 | 20 | Interaction polish + `duo doctor` + TCP fallback |
| 14a | 18 | First-launch self-install (no cert) |
| 14b | 21 | Distribution polish (cert-gated) |
| 15g (or 15g.1) | 15 | Send → Duo (promoted from sub-item to top-level) |
| 15a–f | Backlog | Smaller 15-family primitives (notify, events, etc.) |
| 16 | Backlog | Multi-window |
| 17 | 12 | Atelier visual redesign (moved to front — it's a foundation) |
| 18 (and 18a/b/c) | 19 (and 19a/b/c) | Duo detection & default-claude tabs (Phase 19a env signals shipped 2026-04-26) |
| 19 | 17 | HTML canvas (briefly held Stage 19 between 2026-04-26 morning rename and afternoon renumber — see PRD) |

PRD file renames done in the same commit:
- `docs/prd/stage-15g-send-to-duo.md` → `docs/prd/stage-15-send-to-duo.md`
- `docs/prd/stage-18-duo-detection.md` → `docs/prd/stage-19-duo-detection.md`
- `docs/prd/stage-19-html-canvas.md` → `docs/prd/stage-17-html-canvas.md`

---

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
- **Agent tools** → middle-bottom, collapsible, **Backlog** (was old
  Stage 12, now in Backlog).
- **Viewer/Editor** → right. Tabbed polymorphic surface with **one
  unified tab strip across all modalities**. A tab can be a browser
  page, a markdown editor, an HTML/code source editor, or a file
  preview (image/PDF/CSV). The same file can live in multiple tabs
  under different types (edit the source in tab 3, render it in
  browser tab 4). `duo tabs` returns the mixed list; tab IDs are
  continuous regardless of type. Browser tabs are shipped; editor
  shipped; HTML canvas tab type lands in Stage 17.

Today's layout (terminal-left, browser-right, no Files column) is a
waypoint. The reshape lands with Stage 10.

---

## Open issue → stage mapping (as of 2026-04-26)

> Pulled `gh issue list --state open` 2026-04-26. Most issues map to
> existing roadmap items; some are already shipped and just need
> closing. **Re-scrutinize before kicking off any host stage** — the
> issues are mostly one-line titles and the spec lives in the stage
> PRD, not the issue body.
>
> When a stage ships, close the mapped issues with a one-line
> reference to the commit / PR. The "Status" column reflects the
> issue's *roadmap disposition*, not the issue's GitHub status.

| Issue | Title (paraphrased) | Roadmap disposition (new numbers) |
|---|---|---|
| #5 | Highlight + scroll-to-top when Claude pushes md updates | **Stage 13** — visual covered by Atelier mock; scroll-to-top is a small additional behaviour to spec at kickoff. |
| #6 | Track-changes mode for md editor | **Stage 14** — fully covered (PRD + Atelier Suggesting / Accepted modes). |
| #7 | Save-state deep dive: warnings on unsaved / overwrite | **Stage 16** (external-write reconciliation) + **Stage 13** (warn-before-overwrite for dirty buffers). |
| #9 | Move file path to terminal composer (right-click / drag) | **Backlog** (file → composer; was 15f). |
| #10 | Agent should see selected text + surrounding context | ✅ **Shipped 2026-04-26.** `duo selection` (Stage 11 D29a) extended to browser pane same day. **Closed.** |
| #11 | Zap element from browser to terminal composer | **Backlog** (`duo zap`; was 15e). |
| #12 | Sandbox terminal-operation exploration | **Stage 20** (`duo doctor` + transport polish + ADR work; was Stage 13). |
| #13 | Claude sends temp script to fresh terminal tab for user invocation | **Backlog** (was 15d `duo tab --cmd`); also overlaps with **Stage 19 D27** (`duo new-tab --cmd`) — lock semantics when either kicks off. |
| #15 | Terminal-tab attention notifications (system-level + session name in body) | **Backlog** (`duo notify` + `duo tab name`; was 15b + 15c). |
| #16 | Multi-window support | **Backlog** (was Stage 16). |
| #17 | Click-and-drag target too small | ✅ **Already fixed.** **Closed.** |
| #18 | Goal/task flag in tab header (human ↔ agent reminder) | **Backlog** (folded into `duo tab name`; was 15c). |
| #19 | Mechanism for Claude to "watch" browser / editor (temporary event stream) | **Backlog** (`duo events --follow`; was 15a). |
| #20 | `⌃Tab` should cycle tabs in active pane | ✅ **Shipped 2026-04-26** (commit `3976039`, BUG-001 fix). **Closed.** |
| #21 | `⌘N` opens new file in right pane with focus on filename setter | ✅ **Shipped** in Stage 11a (D33a). **Closed.** |
| #22 | `⌘[` in file-explorer focus moves up one level | **Stage 20** — pane-aware shortcut polish, sibling to BUG-001 territory. |
| #23 | `⌘+` / `⌘-` should change browser content size when right pane has focus | **Stage 20** — pane-aware shortcut polish. Today these only bump terminal font when terminal has focus; needs a 'working' branch that proxies to `webContents.setZoomLevel()`. |
| #24 | Persist app state on reload (browser tabs, files, terminal CWDs, file-browser location) | **Stage 21** (Session restore on relaunch — was 14b). |
| #26 | On `⌘T`, focus browser address bar so user can type URL | ✅ **Shipped** in Stage 11 (D33e). **Closed.** |
| #27 | Persist browser history for URL autocomplete | **Stage 21** (small follow-up bullet — added below). |

**Issues to close on next sweep (5):** #10, #17, #20, #21, #26 — all
already shipped. Suggested closing comment: link to the commit / stage
above and reference this mapping.

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
- [ ] First-launch install dialog (Electron prompt before installing CLI + skill) — currently installs via `./cli/duo install` + `npm run sync:claude`. **Stage 18** (split out of old Stage 6 on 2026-04-26 so it can ship before the cert lands).
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
- [ ] First-launch installer (copies `skill/` + `agents/` into `~/.claude/`) — currently manual. **Stage 18** (no cert required; split from old Stage 6 on 2026-04-26).
- [x] **Skill scoping** — locked 2026-04-25: global `~/.claude/skills/duo/`. See [docs/DECISIONS.md § Skill scoping](docs/DECISIONS.md). The per-session alternatives (shell-init `--plugin-dir`, `--add-dir`, project-level symlink) remain documented for future reference if the skill ever needs Duo-specific guardrails that shouldn't leak to other Claude sessions.
- [x] **Skill docs: Claude Code sandbox troubleshooting section** — `skill/SKILL.md` now carries a "Troubleshooting: Claude Code sandbox" block (failure signatures, `duo doctor` as first move, the recommended `allowUnixSockets: true` + socket-read allowlist, `dangerouslyDisableSandbox` called out as last resort). `agents/duo-browser.md` mirrors the short version in its "Diagnosing failures" section. See `docs/DECISIONS.md` → Open ADRs → *Sandbox-tolerant transport and install paths for the `duo` CLI*.

---

## Stage 5 v2 — Duo subagent (broader scope, smaller model) `✅ shipped 2026-04-26 late-evening`

> **PRD:** [docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md).
> **Shipped 2026-04-26 late-evening.** Code-side complete + all Class A
> + C live walks pass (~$0.40 in API spend). **Class B perf surprise:
> the synthetic measurement inverted the PRD's hypothesis** — see "Class B
> finding" below.
>
> **Treated as a v2 of Stage 5**, not a new integer, because the
> 2026-04-26 renumber was explicit about build-order semantics.

**What it was meant to do.** Move mechanical CLI orchestration from the
top-level Sonnet/Opus orchestrator down to a Haiku 4.5 subagent so the
orchestrator stays in planning mode and the agent does the drive.

**Class B finding (post-ship — inverts the PRD hypothesis).** Synthetic
F1 on a fresh `claude -p --model sonnet`, comparing inline (`Sonnet →
Bash(duo *)`) vs subagent (`Sonnet → Task(duo)`):

| | inline (A) | subagent (B) |
|---|---|---|
| Total cost | $0.08 | $0.17 |
| Wall-clock | 36s | 65s |
| Sonnet tokens | 6 in / 398 out | 6 in / 348 out |
| Haiku tokens | 1593 out | 2285 out |

Cause: **Claude Code already routes mechanical tool execution to Haiku
regardless of `--model`**. The subagent path stacks a SECOND Haiku
context on top of the existing fast-tier Haiku, doubling the Haiku-side
cost. The PRD's "~85% orchestrator-token reduction" was framed against a
mental model where the top-level Sonnet processes CLI dumps directly;
that isn't how Claude Code distributes tokens across model tiers.

**The agent's value is real but qualitative.** Bounded per-task context
(no main-conversation prefix-cache pollution), specialized prompt
(verbs/routing/failure modes baked in), predictable orchestrator/agent
contract. These scale with session length, not per-task dollar cost on
a cold-cache synthetic. Proper re-measurement with cumulative-context
methodology is filed as **FOLLOWUP-003** in `tasks.md`.

### Shipped (all done 2026-04-26 late-evening)

- [x] **Identity + model** — `agents/duo.md` (254 LOC) with
      `name: duo`, `model: claude-haiku-4-5`, `tools: Bash`.
      Subsumes and replaces `agents/duo-browser.md`. Verified live
      that the model alias resolves to `claude-haiku-4-5-20251001`.
- [x] **Session guard (A20)** — agent's first action checks
      `$DUO_SESSION`. **C5 walked live:** fresh `claude -p` with
      `DUO_SESSION` unset → agent ran the guard, saw `not_in_duo`,
      refused with the EXACT one-line message from the prompt. 2
      turns, zero verb invocations, $0.006. **Caveat in
      FOLLOWUP-002:** when a user has a tight Bash allowlist that
      denies the compound `[ … ] && echo … || echo …` command, the
      guard silently fails. Permissive Bash (the realistic default)
      works correctly.
- [x] **Verb cheat-sheet** — full duo CLI surface, compacted from
      `skill/SKILL.md`. Includes the new `duo external` verb.
- [x] **Patterns** — 5 examples covering read-rewrite-write,
      browser extract, multi-tab orchestration, file-tree
      exploration, Send → Duo round-trip. F2/F4/F5 walked live.
- [x] **Failure protocol** — hard-fail-and-surface. C6 walked
      live: malformed `external-domains.json` → graceful fallback
      to "no exceptions", no crash, agent navigated via Duo.
- [x] **Skill update** — `skill/SKILL.md` § "Prefer delegating
      to the `duo` subagent" + § "Web routing" added. README,
      FIRST-RUN, BUILD-PROCEDURES, CLAUDE.md all updated to point
      at `agents/duo.md`.
- [x] **Web-routing pattern (A23–A25)** — agent's stream-json
      call log on C7 shows the routing decision is correct:
      seeded `example.com` → agent ran `duo external` (NOT `duo
      open`); Duo's tab list unchanged before/after.
- [x] **`duo external <url>` CLI verb (A24)** — wrapping
      `shell.openExternal()`. Wired through `shared/types.ts`,
      `electron/main.ts` (`openExternalUrl`),
      `electron/socket-server.ts`, `cli/duo.ts`. Validates URL
      parses; refuses `file://`, `javascript:`, anything outside
      {http, https, mailto}. Binary rebuilt; `docs/CLI-COVERAGE.md`
      updated.
- [x] **External-domains list bootstrap (A26)** —
      `npm run sync:claude` creates
      `~/.claude/duo/external-domains.json` with `{"domains":[]}`
      if missing; never overwrites populated. Stage 18 PRD will
      inherit this step when drafted.
- [x] **Sync script** — `npm run sync:claude` extended to copy
      `agents/duo.md` AND remove legacy `~/.claude/agents/duo-browser.md`
      from dev installs.
- [x] **Bundle** — `electron-builder.yml` already covers `agents/`
      (commit `20b4701`). The new file ships with the next `npm run dist`.
- [x] **Validation: Class A fixtures** — F1, F2, F4, F5, F8, F9
      all PASS. F3, F6, F7, F10 skipped (covered by adjacent
      walks).
- [x] **Validation: Class C recovery** — C5, C6, C7 (the load-
      bearing guards) all PASS.
- [-] **Validation: Class B perf** — measured; finding inverts
      the PRD pass criteria. See callout above + FOLLOWUP-003.
- [x] **Smoke checklist update** — new § 7a in
      `docs/dev/smoke-checklist.md` with pre-flight + 5
      functional walks + 3 recovery walks + post-walk cleanup.

### Installation lifecycle

End-to-end picture (full detail in PRD § 5):

- **Dev** — edit `agents/duo.md`, `npm run sync:claude` to make it
  visible in dev sessions, commit + ship.
- **End-user, first launch** — Stage 18's installer copies the
  bundled `agents/duo.md` into `~/.claude/agents/duo.md` after the
  consent sheet. No new installer machinery required; it's one
  more file in the existing flow.
- **End-user, app update** — installer hashes the bundled vs
  installed file. If unchanged from previous bundled, silent
  overwrite; if user-modified, prompt with diff + accept/keep
  options. Same shape Stage 18 needs for the skill itself.

### Validation plan (full detail in PRD § 6)

Three classes of validation, all manual for v1:

| Class | What | Pass criteria |
|---|---|---|
| **A — Functional** | 10 fixtures in `agents/duo-tests.md` (F1–F7 core; F8–F10 web routing) | All return correct effects; just-added highlight + banner fire; web routing follows A23 (Duo by default, listed hostnames external) |
| **B — Performance** | Orchestrator turn / token / wall-clock deltas on F1 + F5 | ≥60% token reduction, ≥30% wall-clock reduction vs inline baseline |
| **C — Recovery** | Inject 7 failure modes: missing socket / malformed JSON / new-file modal / mid-navigation race / **outside-Duo invocation (no `$DUO_SESSION`)** / **malformed external-domains.json** / **listed domain accidentally routed via `duo open`** | Agent surfaces clean error, doesn't improvise. C5 specifically: agent refuses immediately via the session guard (A20), runs zero `duo` verbs. C6: graceful fallback to "everything via Duo" when the list parses badly. C7: agent's pattern enforces external routing before calling the verb (the CLI itself doesn't enforce it). |

Class D is a regression check — replace the `duo-browser` test cases
with equivalents through the new agent and verify identical
behaviour.

V2 (deferred): automated eval harness in `tests/duo-agent/` driving
Claude Code via SDK + asserting outputs.

### Risks

- **Haiku error recovery.** Mitigation: hard-fail-to-surface protocol
  (A10 in PRD); orchestrator can fall back to inline CLI.
- **Prompt drift.** Adding a CLI verb means updating one more place.
  Mitigation: extend the existing "new verb checklist" in CLAUDE.md
  to include `agents/duo.md`.
- **Hidden intermediate reasoning.** Some debugging benefits from
  seeing the agent's per-verb log. Mitigation: opt-in `trace: true`
  in the goal returns the call log (deferred to V2; A11 in PRD).

### Open questions

See PRD § 8 — four small Qs to verify before drafting the agent file:
the exact Anthropic model alias, Claude Code's subagent
`model:`-frontmatter support, whether subagent turns surface to the
user in the Claude Code UI, and prompt size budget (full verb table
vs compact-with-skill-link).

---

## Stage 18 — First-launch self-install & Stage 21 — Distribution polish (split from old Stage 14)

> **Originally Stage 6**, re-sequenced per VISION.md to land **after**
> Stages 9 + 10 + 11 (the flagship reading/writing pair). On
> 2026-04-26, split into two halves so the user-facing first-launch UX
> doesn't stay blocked on the Apple Developer ID cert it doesn't
> actually need:
>
> - **Stage 18 — First-launch self-install (no cert).** The
>   double-click-and-go behaviour. Can ship against an ad-hoc-signed
>   local build today.
> - **Stage 21 — Distribution polish (cert-gated).** Code signing,
>   notarization, electron-updater, icon, DMG background, install
>   guide. Held on the cert.
>
> Both halves were a single `⬜ Held` Stage 6/14 prior to the split.
> The bullet list below is partitioned but otherwise unchanged.

### Stage 18 — First-launch self-install (was Stage 14a) `⬜ Not started — no cert needed`

**Why pulled forward:** the gap between "developer runs `npm run dev`"
and "Trailblazer double-clicks an `.app`" is doing too much work in
the user's hands. None of these items require code signing — they
just need an Electron entry point that detects first launch and
performs side-effect installs into `~/.claude/` and PATH.

**Exit criteria:** Geoff hands a Trailblazer the unsigned/ad-hoc-signed
`.app`, they double-click it (using the macOS "right-click → Open"
gatekeeper bypass once), and from that point on every `duo` command
in their Claude Code session works without any terminal setup.

- [x] **Validate `npm run dist` end-to-end** (Team C, 2026-04-26 — commit `20b4701`). Confirmed the arm64 `.app` launches when moved out of the build dir; bundled `cli/duo`, `skill/SKILL.md`, and `agents/duo-browser.md` all present at `Contents/Resources/<dir>/`. One gap fixed inline: `agents/` was missing from `extraResources` in `electron-builder.yml`. Notes: existing dev cert is expired (handled by Stage 21 cert work); `cli/duo` ships as a `#!/usr/bin/env node` script rather than a self-contained binary — verify Node-on-PATH is acceptable when designing the install-time path resolution.
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

### Stage 21 — Distribution polish (was Stage 14b — gated on cert) `⬜ Held — gated on Apple Developer ID cert`

**Exit criteria:** A PM in the Trailblazers cohort installs from a
download link, with no gatekeeper warnings, and gets auto-updates.

- [ ] App icon (`build/icon.icns`) + branded DMG background
- [ ] Code signing — Apple Developer ID (**needs cert from Geoff**)
- [ ] Notarization — `notarytool` via electron-builder
- [ ] `electron-updater` — auto-update from GitHub Releases or private S3
- [ ] Session restore on relaunch (terminal CWDs, browser URL, split position) — **subsumes [issue #24](https://github.com/dudgeon/duo/issues/24)** (persist app state on reload). Expand the scope beyond what's listed: also persist file-browser cwd + expanded folders, open editor tabs (with dirty state warning on relaunch), pinned/follow-mode, and per-tab cozy state.
- [ ] **Browser history persistence for URL autocomplete ([issue #27](https://github.com/dudgeon/duo/issues/27)).** The `persist:duo-browser` partition retains cookies + localStorage; history is in-memory only. Wire Electron's `WebContents.session` history APIs (or a small chokidar-flavored sidecar) so `⌘L` typeahead suggests previously-visited URLs across sessions. Sibling concern to session restore — same partition, similar lifecycle.
- [ ] Security: launch-time auth token on the Unix socket (before Trailblazers)
- [ ] **Light/dark theme refinements** — after Stage 12 (Atelier visual) ships, walk both themes against the Trailblazer-distribution checklist (every stage card visited, every modal opened, every cozy toggle exercised). Remaining work here is "polish what 12 left rough", not "design the theme".
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

**Follow-up — cozy mode visual completion (raised 2026-04-26):**
Geoff confirmed in the [Atelier design chat](design/atelier/chats/chat1.md)
that the current cozy-mode toggle works mechanically but doesn't yet
*feel* cozy — the typography pass landed, but the surface, color, and
voice didn't change visibly. Atelier (Stage 12) supplies the missing
visual layer:

- [ ] Swap cozy-mode terminal background to `--duo-termCozyBg` (cream
      paper in light, warm dark-paper in dark) and foreground to
      `--duo-termCozyFg`, using the [Atelier tokens](design/atelier/project/tokens.jsx).
- [ ] Cap reader-mode column at **92ch** with paper-tone surrounding
      gutter (the prototype shows the full treatment).
- [ ] Optional: "serif-flavored mono" pass — the prototype demonstrates
      a typeface that reads warmer for prose without breaking TUI
      glyph alignment. Confirm with a TUI regression sweep before
      enabling by default.

These follow-ups can ride along with **Stage 12** (one visual ship) or
land independently if cozy-mode polish becomes urgent before the
flagship pair ships. They do **not** change cozy-mode's behaviour —
only its appearance.

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
      See Stage 14 for the pending-suggestion path.

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
- #5 → Stage 16
- #6 → Stage 14
- #7 → Stage 13
- #10 → Backlog (was 11e)

---

## Backlog — Unified skill + connector surface (was Stage 12)

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

## Stage 20 — Interaction polish + `duo doctor` + TCP + pane-aware shortcuts `⬜ After Stage 11`

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

**Pane-aware shortcut polish — added 2026-04-26 from triage:**
sibling concerns to the BUG-001 fix (commit `3976039`). All three
need a pane focus signal in `useKeyboardShortcuts.ts`; the plumbing
already exists from BUG-001's `activePaneFocus` and `paneOverride`
work, so each branch is small.

- [ ] **Issue #22 — `⌘[` in file-explorer focus moves up one level.**
      `cd ..` for the navigator. Branch on `activePaneFocus === 'files'`
      in `useKeyboardShortcuts.ts`; navigator already exposes a
      `cdParent()` action via context.
- [ ] **Issue #23 — `⌘+` / `⌘-` pane-aware zoom.** Today these only
      bump terminal font when terminal has focus. When `focusedColumn
      === 'working'` and the active tab is `'browser'`, proxy to the
      WebContentsView's `webContents.setZoomLevel(level + delta)` so
      the browser content scales (Chrome parity). Editor / file-
      preview tabs: defer (probably no-op for v1; revisit if real
      friction).

---

## Stage 13 — Editor: just-added highlight + warn-before-overwrite `🔄 Next — Phase 0 refactor + 13a + 13b`

> **Was 11c.** Promoted to top-level Stage 13 in the 2026-04-26
> renumber. Cross-refs GitHub issues
> [#5](https://github.com/dudgeon/duo/issues/5),
> [#7](https://github.com/dudgeon/duo/issues/7). Visual spec lives
> in [docs/design/atelier/](design/atelier/) — yellow `mark` token
> + 6s fade overrides the original PRD's "blue fade" placeholder.
>
> **Editor-agnostic primitive contract** (locked
> [2026-04-26](docs/DECISIONS.md#editor-agnostic-primitives-shared-visual-chrome-surface-bound-data-bindings)):
> Stage 13 is the warm-up that proves out the visual-layer / data-layer
> split before Stage 14 + Stage 15 + Stage 17 lean on it harder. The
> two pieces produced here — `duo-just-added` keyframe and
> `<WriteWarningBanner>` — both ship under
> `renderer/components/editor/primitives/` with zero TipTap or
> ProseMirror imports. Stage 17 H20 + H36 reuse them verbatim.

When the agent writes to the editor (`duo doc write`), the affected
range pulses yellow for ~6 seconds so the human can see what just
changed. When the agent tries to write while the human has unsaved
edits, a banner appears in the chrome and the human accepts /
declines from the editor instead of from the terminal.

### Phase 0 — Editor-agnostic refactor (~half day, lands first)

- [ ] Extend `DuoSelection` union in `shared/types.ts` with
      `HtmlCanvasSelectionSnapshot` placeholder (Stage 17 H25 shape:
      `{kind:"html-canvas", path, text, html, anchorId, anchorPath,
      range, surrounding}`). Locks the union shape NOW so Stage 15
      ships canvas-ready.
- [ ] Rename `EditorSelectionTagged` → `MarkdownSelectionSnapshot`
      for symmetry with the canvas snapshot type (cosmetic, but
      removes "editor = MD" implicit assumption).
- [ ] Document the "active doc surface" pattern in `electron/main.ts`
      so the selection cache is kind-discriminated rather than
      MD-specific.
- [ ] Create `renderer/components/editor/primitives/` directory + a
      one-paragraph `README.md` that names the contract: "no
      TipTap / ProseMirror imports here; if you reach for them,
      it's a binding, not a primitive."

### Phase 13a — Just-added highlight (~half day)

- [ ] **Visual layer.** `duo-just-added` keyframe in `globals.css`
      using the Atelier `mark` token; 6s linear fade. Single source
      of truth.
- [ ] **MD binding.** `extensions/JustAdded.ts` — TipTap decoration
      plugin that adds the class to a range, removes after 6s. Wired
      into the `duo doc write` reply path so agent edits land marked.
- [ ] Skill update — agents understand the highlight is automatic;
      no special opt-in.
- **Exit:** PM watches a Claude write; the rewritten paragraph
  pulses yellow then fades.

### Phase 13b — Warn-before-overwrite (~half day)

- [ ] **Visual layer.** `<WriteWarningBanner>` in `primitives/`.
      Props: `pending: { text: string; mode: 'replace-selection' |
      'replace-all' }`, `onAccept`, `onDecline`. Atelier-styled.
      No editor imports.
- [ ] **MD binding.** Editor catches incoming `duo doc write` while
      the buffer is dirty + caret active; renders the banner from
      `MarkdownEditor.tsx`; passes user's accept/decline back through
      the IPC reply.
- [ ] Test: agent writes while human is mid-edit → banner appears,
      agent's IPC call doesn't resolve until the human chooses.
- **Exit:** human controls when contested writes land, from the
  surface they're already on.

### Stage 17 reuse story

- **H20** — canvas writes paint with the same `duo-just-added` class.
  Only the binding is different (DOM `classList.add` instead of PM
  decoration). Single CSS keyframe serves both.
- **H36** — canvas reuses `<WriteWarningBanner>` verbatim from
  `primitives/` with a canvas-side `mode: 'set' | 'replace' |
  'append'` discriminator added in Stage 17 Phase 17c.

---

## Stage 14 — Editor: track changes (Suggesting / Accepted) `⬜ Visual layer ships canvas-ready; MD data binding ships now; canvas binding deferred to Stage 17 v2`

> **Was 11d.** Promoted to top-level Stage 14 in the 2026-04-26
> renumber. Cross-refs GitHub issue
> [#6](https://github.com/dudgeon/duo/issues/6). Visual spec lives
> in [docs/design/atelier/](design/atelier/) — green-underlined
> insertions, red-strikethrough deletions, accept-all banner.
> Realizes D18 track-changes toggle + D20 comment rail end-to-end.
>
> **Editor-agnostic primitive contract** (locked
> [2026-04-26](docs/DECISIONS.md#editor-agnostic-primitives-shared-visual-chrome-surface-bound-data-bindings)):
> ships four reusable visuals under `primitives/`:
> `<TrackChangesProvider>`, `<TrackedRangeMark>`,
> `<AcceptAllBanner>`, `<CommentRail>`. MD-specific code (CriticMarkup
> parsing, PM marks for the tracked ranges) lives in
> `extensions/TrackChanges.ts`. Stage 17 H39 explicitly defers HTML
> diff to v2 — but the visual chrome is canvas-ready from this stage,
> so Stage 17 v2 is "wire a different binding into existing
> components" rather than "rebuild the comment rail."

Three modes for the editor: **Live** (default — direct edits land
immediately), **Suggesting** (agent edits land as proposed insertions
+ deletions), **Accepted** (apply all pending suggestions in one
sweep). The agent's CLI controls the mode (`duo doc mode <live|
suggesting>`); the human accepts/rejects from the editor.

### Visual layer (lands now, canvas-ready)

- [ ] `<TrackedRangeMark>` — Atelier-styled green/red decoration
      with author badge, accept/reject buttons in a margin chip.
      Pure React.
- [ ] `<AcceptAllBanner>` — top-of-editor banner: "Claude has 3
      pending suggestions. [Accept all] [Review one by one]
      [Reject all]." Pure React.
- [ ] `<CommentRail>` — right-side rail with threaded entries,
      anchor icon, accept/resolve/reply, "✨ Claude" badge for
      agent comments. Per Stage 17 H23, this is the same component
      the canvas will use.
- [ ] `<TrackChangesProvider>` — context provider that holds the
      tracked-changes state and exposes accept/reject handlers. The
      data shape is editor-agnostic (`{ id, kind: 'insert' | 'delete',
      author, ts, range }` where `range` is opaque from the visual
      layer's perspective).

### MD data binding (lands now)

- [ ] `extensions/TrackChanges.ts` — TipTap extension. Parses
      CriticMarkup on doc load, renders tracked ranges as PM marks
      with the visual-layer's attribute schema. On accept, removes
      the mark and the rejection text. On reject, removes the mark
      and any inserted text.
- [ ] `duo doc mode <live|suggesting>` CLI — runtime switch.
- [ ] `duo doc comment` CLI — adds a comment anchored to a range.
      MD storage: CriticMarkup `{>> comment <<}` syntax, parsed
      into `<CommentRail>` entries.
- **Exit:** Claude in suggesting mode writes "I'd change X to Y";
  the human sees green/red diffs in the prose + rail entry, accepts
  or rejects.

### Stage 17 reuse story (Stage 17 v2, after H39 lifts the deferral)

- HTML's natural data binding is `<ins>`/`<del>` tags (HTML-native!)
  or `data-duo-track-*` attributes for finer-grained control. Stage
  17 v2 writes a canvas-side `bindings/TrackChanges.ts` that emits
  the same record shape `<TrackChangesProvider>` already accepts.
  Visual components don't change.
- Comment rail (H23) uses the same `<CommentRail>` component shipping
  here. Stage 17 H21 + H22 spec the canvas-side anchor model
  (`data-duo-id` + range) which feeds the same component schema.

---

## Stage 15 — Send → Duo (cross-modality selection primitive) `🟡 15.1 ✓ + 15.2 ✓ shipped 2026-04-26 late-evening · 15.3 polish (defer) · canvas surface lands inside Stage 17c`

### What shipped in 15.1 (2026-04-26 late-evening)

CLI half (smoke-tested live):
- `duo selection-format [a|b|c]` (G19) — agent-tunable runtime knob,
  persisted in renderer localStorage. Default `a` (quote + provenance);
  `b` literal; `c` opaque token.
- `duo send [--text "…"]` (G17) — writes payload into active terminal's
  PTY. No Enter (G11). Returns `{ok, written, terminalId}`.

UI half (typecheck clean, HMR clean, visual walk deferred to FOLLOWUP-004):
- `<SendToDuoPill>` editor-agnostic primitive (no TipTap imports).
  Portals to `document.body`, anchors 6px above selection (falls back
  below), right-aligns and viewport-clamps.
- `formatSendPayload` pure helper for modes a/b/c. `~/` shortening on
  paths inside `$HOME`; per-line `> ` prefix on multi-line selections.
- `useSelectionFormat` hook — localStorage source of truth + main-cache
  pushState + CLI-driven `onSet` listener.
- MarkdownEditor binding: tracks `pillRect` in the selection-update
  effect; hides on blur/collapse; repositions on scroll/resize.
- WorkingPane + App.tsx: `onSendToDuo` callback writes to the active
  terminal's PTY and moves focus to the terminal column.

### What shipped in 15.2 (2026-04-26 late-evening)

Same `<SendToDuoPill>` primitive, second surface (browser pane).
Data plane verified live; visual verification deferred to
FOLLOWUP-004.

- **`SELECTION_OBSERVER_IIFE`** in `electron/cdp-bridge.ts` —
  module-scope JS payload (~80 LOC) injected via `Runtime.evaluate`
  on every CDP attach + on every `Page.frameNavigated` for the top
  frame. Listens for `selectionchange`/`scroll`/`resize`, debounces
  (60 ms), serializes the selection to `BrowserSelectionSnapshot` +
  page-relative rect, posts via `window.duoSelectionPush(json)`.
  Re-injection guarded by `__duoSelectionObserver`.
- **`Runtime.addBinding('duoSelectionPush')`** registered in CDP
  attach. `Runtime.bindingCalled` events parsed in `handleCdpEvent`
  → cached as `latestBrowserSelection` → emitted to a single
  `browserSelectionListener` callback.
- **Cache reset on tab switch + frame nav.** `attach()` and the
  top-frame branch of `Page.frameNavigated` both emit `null` so the
  renderer's pill goes away while the new tab/page's observer
  reports.
- **`BrowserManager.constructor` wires the listener** to forward
  pushes via `mainWindow.webContents.send(IPC.BROWSER_SELECTION,
  push)`. New IPC channel `BROWSER_SELECTION` (main → renderer).
  New types: `BrowserSelectionRect`, `BrowserSelectionPush`. New
  preload bridge `browser.onSelection`.
- **`renderer/hooks/useBrowserSelection.ts`** subscribes to the
  IPC and surfaces the live state.
- **`BrowserRenderer` pill mount.** Reads
  `useBrowserSelection`, reads page title from `BrowserState`,
  reads format from `useSelectionFormat`, translates page rect →
  screen rect by adding the contentRef's `getBoundingClientRect()`
  to the page-relative coordinates. Click handler calls a new
  `formatBrowserSendPayload` variant in `sendFormat.ts` (provenance
  line is `URL — "page title"` per PRD G10).
- **`<SendToDuoPill>` rect type loosened** from `DOMRect` to a
  minimal `PillAnchorRect = { top, bottom, right }` — DOMRect isn't
  constructable in renderer code that hasn't run inside a real
  page, so the browser surface synthesizes the structural shape.
  Editor side passes a real DOMRect (structurally compatible).
- **`onSendToDuo` threaded** through `WorkingPane` to
  `BrowserRenderer`, so the same `pty.write(activeTabId, payload)`
  callback serves both surfaces.

**Live verification (data plane):** `duo eval "({ hasBinding: typeof
window.duoSelectionPush === 'function', hasObserverGuard:
!!window.__duoSelectionObserver })"` returns `{true, true}` on a
fresh example.com tab. Programmatically selecting the H1 fires the
observer; a wrapper around `duoSelectionPush` confirmed the binding
receives the payload (snapshot + rect both populated).

**Visual verification deferred** (FOLLOWUP-004): seeing the actual
purple chip floating over a real selection in the browser pane
requires computer-use access. The data plane proves the pipeline
is correct.

**Out of scope (deferred to 15.3 polish):**
- Length cap + truncation marker (G9 — 16 KB).
- Image / table flattening (G8).
- `⌘D` keyboard shortcut (G5).
- Canvas-app fast-paths (Google Docs / Sheets / Slides / Figma) —
  v1 uses generic `window.getSelection()` everywhere; canvas apps
  return null which is fine. Add app-specific accessors when a
  user task hits the gap.

---

### Stage 15 — original framing (kept for context)

> **PRD:** [docs/prd/stage-15-send-to-duo.md](prd/stage-15-send-to-duo.md).
> Originally drafted as Stage 15g (sub-item under the "Stage 15
> Human↔agent primitives" grab-bag). Promoted to top-level Stage 15
> in the 2026-04-26 layered-build renumber because it's the L1
> priority unlock; the rest of the original 15a–f primitives moved
> to Backlog (see below).
>
> **Editor-agnostic primitive contract** (locked
> [2026-04-26](docs/DECISIONS.md#editor-agnostic-primitives-shared-visual-chrome-surface-bound-data-bindings)):
> ships `<SendToDuoPill>` under `renderer/components/editor/primitives/`
> with no editor-specific imports. Takes a `DuoSelection` and a
> position-computer prop. Editor surface (15.1), browser surface
> (15.2), and canvas surface (Stage 17 H27) all wire the same
> component. Phase 0 of Stage 13 already extends `DuoSelection` with
> the canvas placeholder so Stage 15 ships canvas-ready.

Floating button next to any selection in any WorkingPane tab type
(browser, editor, future preview). One click sends the selection
into the active terminal's input line with no Enter pressed, so the
user can complete the prompt ("rewrite this paragraph", "summarize
this", "find similar issues").

User-facing complement to the agent-facing `duo selection` and
`duo zap` verbs; same payload shape, opposite direction. Visual
chrome from Atelier mock (Stage 12).

### Phase 15.1 — Editor button + `duo send` + `duo selection-format`
- [ ] **Visual layer** — `<SendToDuoPill>` in `primitives/`. No
      TipTap imports. Props: `selection: DuoSelection`, anchor rect
      computer, `onClick`. Position absolutely; Atelier-styled.
- [ ] **MD binding** — TipTap BubbleMenu wires the pill's anchor
      computer to PM selection geometry; lives in editor extensions.
- [ ] `duo send [--text|stdin]` CLI verb — writes formatted payload
      into active terminal as if button fired (for agents).
- [ ] `duo selection-format [a|b|c]` CLI — runtime-tunable injection
      format (default `a` = quote + provenance per G10).
- [ ] No new IPC surface beyond `pty.write` + a tiny selection-format
      push/set channel pair.
- **Exit:** PM selects in a `.md`, clicks the pill, terminal gets the
  formatted payload.

### Phase 15.2 — Browser surface + unified selection
- [ ] Browser selection observer + page-side script.
- [ ] Same `<SendToDuoPill>` component anchored over `WebContentsView`
      via a host-side overlay layer.
- [ ] Unifies `duo selection` across editor + browser surfaces (the
      Phase 0 union shape from Stage 13 already covers this).

### Phase 15.3 — Polish
- [ ] Length cap, image/table flattening, `⌘D` shortcut.
- [ ] Skill update so agents understand the injected format.

**Stage 17 reuse story.** The canvas surface gets the pill for free
in Stage 17 Phase 17c — H27 spells out "natively works once H25
supplies the payload." Concretely: H25 returns the canvas's
`HtmlCanvasSelectionSnapshot` shape (already in the union), and the
canvas's iframe-DOM observer wires into the same dispatcher.

Full spec including all 19 G-decisions in the PRD.

---

## Backlog — 15-family primitives (was Stages 15a–15f)

> Promoted out of "Stage 15 (interaction primitives)" during the
> 2026-04-26 renumber because each is small enough to ship
> independently when convenient, and the original "everything ships
> together" framing was wrong. Cross-references GitHub issues #9,
> #11, #13, #15, #18, #19.

### 15-family — Agent-watchable events (`duo events`)

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

### Backlog 15b — Notifications (`duo notify`)

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

### Backlog 15c — Tab identity (`duo tab name` + subtitle)

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

### Backlog 15d — Send command to terminal (`duo tab --cmd`)

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

### Backlog 15e — Browser-element "zap" (`duo zap` + right-click)

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

### Backlog 15f — File path → terminal composer

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

<!-- old "### 15g" sub-section removed 2026-04-26: promoted to top-level
     Stage 15 above. See § Stage 15 — Send → Duo for current spec. -->

---

## Backlog — Multi-window support (was Stage 16, issue #16)

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

## Stage 12 — Visual redesign (Atelier) `🟡 Phases 1–3 shipped · whisper-level agent presence pending`

> **Design source:** [docs/design/atelier/](design/atelier/).
> [README](design/atelier/README.md) is the index; [chats/chat1.md](design/atelier/chats/chat1.md)
> is the source of intent; the prototype HTML and JSX live in
> [project/](design/atelier/project/).
>
> **Raised 2026-04-26.** Geoff's brief: "warmer and more approachable
> without dumbing it down" for the PM persona. The current dark
> Warp×Linear aesthetic is the wrong voice for that audience. The
> design pass produced three directions (Stationery / Atelier / Field
> Notebook); **Atelier is the chosen hero** — confident redesign,
> cream paper + ochre accent, serif chrome accents, serif editor body,
> light-as-hero with dark as a warm follower.

**Held until the flagship pair (15g.1 + 11b) ships in functional form.**
Same logic that put Stage 21 after Stages 9/10/11: don't polish a
half-product. The mock has already done the design work for the
in-flight stages, so per-feature visuals fold into their host stages
and ship as part of those features (see "Per-feature visuals fold in"
below). What remains for Stage 12 itself is the **system-wide visual
pass** — token swap, layout depth, tab-strip rhyme, file-pane shape.

**Exit criteria:** A returning user opens Duo and immediately reads
"writing desk" rather than "professional terminal tool" — without
losing any feature parity. Light is the default theme; dark is
preserved and equally polished. The three "must-lose" items from the
brief are gone:

- bland → cream + ochre + serif voice
- terminal pane vs working pane too subtle → paper-depth differentiation + accent rule
- terminal tabs vs working-pane tabs visually dissimilar → unified tab-strip vocabulary

### Scope — system-wide visual pass

- [x] **Token swap.** Atelier tokens from
      [tokens.jsx](design/atelier/project/tokens.jsx) wired through
      `globals.css` + `tailwind.config.mjs`. Light + dark variants
      ship. *Phase 1 — commit `585d4ee`.*
- [x] **Light is the new default.** Theme defaults to `system`,
      which resolves to the macOS appearance. The Atelier light
      palette is the hero; dark variant is a warm follower. *Phase 1.*
- [x] **Type voice.** `DUO_VOICE.atelier` wired — sans for chrome
      labels, serif (`"New York"` / `ui-serif`) for chrome accents
      and editor body. Mono unchanged for terminal. Per-feature
      finishes (italic-serif active tab label) shipped in Phase 3.
- [x] **Layout depth — terminal vs working pane.** Terminal column
      sits on `--duo-paper-deep`; working pane on `--duo-paper`
      (Phase 3 flipped the WorkingPane root from surface-1 to
      surface-0 so the active tab merges with content below).
      *Phase 2 — commit `5cbaa36`; refined in Phase 3.*
- [x] **Tab-strip rhyme.** Both strips share rounded-top chip
      language with an accent top-stripe on the active tab and an
      italic serif label. Differentiator: strip bg
      (terminal=paper-edge, working=paper-deep). Type icon next to
      label. *Phase 3 — 2026-04-26.*
- [x] **Files pane — width 208 + collapse-to-rail.** Narrowed from
      240→208; explicit chevron-collapse button next to the pin
      button. *Phase 2 — commit `5cbaa36`.*
- [x] **Cozy-mode visual completion.** xterm theme variant added
      for cozy + light (paper canvas, ink fg) and cozy + dark
      (warm dark). Theme swap effect now keys on both
      `themeEffective` and `cozy`. *Phase 3 — 2026-04-26. (Folded
      in from Stage 9 follow-up.)*
- [ ] **Whisper-level agent presence.** Wire the subtle pulses the
      mock demonstrates: titlebar dot when Claude is active; soft
      glow on a selection when Claude reads it (the same `mark`
      token + a `box-shadow` keyframe). The just-added highlight
      and Send → Duo pill are owned by their host stages (see
      below) so they don't repeat here. **Still pending.**

### Per-feature visuals — fold into host stages (don't wait for Stage 12)

These are visual specs the mock supplies for in-flight features.
Implementing each one is the host stage's responsibility; Stage 12
just inherits them when the system-wide pass lands.

| Visual | Host stage | Where in the mock |
|---|---|---|
| Cozy mode terminal — paper canvas, serif mono, 92ch column | [Stage 9 follow-up](#stage-9--cozy-mode-terminal-typography-v1--shipped-2026-04-22-graduated-2026-04-25) | `tokens.jsx` `termCozyBg` / `termCozyFg`; `duo-components.jsx` cozy branch |
| Just-added highlight (yellow flash, 6s fade) on agent-written text | [Stage 13](docs/prd/stage-11-markdown-editor.md) § 6 | `Duo Prototype.html` `@keyframes duo-just-added`; `duo-components.jsx` `justAdded` mark. (PRD 11c said "blue fade" — overwritten by Atelier's yellow `mark` token + 6s curve.) |
| Track changes (Suggesting / Accepted / Live) — green insertions, red strikethrough, accept-all banner | [Stage 14](docs/prd/stage-11-markdown-editor.md) § 6 | `duo-components.jsx` `insertion` / `deletion` marks + Suggesting banner. The mock realizes D18's track-changes toggle end-to-end. |
| Send → Duo floating pill — purple chip with `⌘D` chord, click-to-fire animation | [Stage 15.1](docs/prd/stage-15g-send-to-duo.md) | `duo-components.jsx` `SendToDuoPill`; `Duo Prototype.html` `@keyframes duo-pill-in` |

When picking up one of these host stages, the implementer reads the
relevant mock file as the visual spec rather than re-deriving from
Geoff. The chats/chat1.md transcript captures the rationale behind
each choice and is worth a skim before starting any of them.

### Sequencing notes

- **Token swap is mostly mechanical** if `useTheme.ts` is the
  single source. Audit that first; any hard-coded `#080808` /
  `#7c6af7` outside that file gets fixed before the swap to avoid
  surprise dark patches.
- **Light theme regressions** — today the dark theme is the daily
  driver. Flipping the default to light may surface contrast bugs in
  components that were only ever used in dark. Walk
  [docs/dev/smoke-checklist.md](docs/dev/smoke-checklist.md) twice:
  once in light, once in dark.
- **Stationery and Field Notebook directions are documented but not
  built.** They live in `tokens.jsx` so a later A/B (or a per-user
  preference) is cheap to add. Don't ship them in v1 — Atelier is
  the hero.
- **Don't pull this forward of the flagship pair.** The mock proves
  the design works for both shipped and planned features. A visual
  pass after the features land is one round-trip; a visual pass
  before them means re-doing the visual when the features ship in
  different shapes than the mock predicted.

---

## Stage 19 — Duo detection (was Stage 18) & default-to-claude tabs `⬜ Spec drafted 2026-04-26`

> **PRD:** [docs/prd/stage-19-duo-detection.md](prd/stage-19-duo-detection.md).
> Three layers (env signals → passive priming → default-to-claude tabs)
> in three independently shippable phases. Touches `~/.claude/settings.json`,
> so the install path lines up with **Stage 18's first-launch installer**
> — when Stage 18 lands, fold the hook + shim install into its consent sheet.
> Layer 1 (env signals) is a tiny standalone PR that unblocks `duo doctor`
> for **Stage 20** independently. **Phase 19a (env signals) shipped
> 2026-04-26 in commit `640ec0e`** (the commit message uses the old
> "Stage 18 Phase 18a" labels — see § Number history).

**Why it matters:** today there's no signal to Claude Code that it's
running inside Duo, and `⌘T` from terminal focus opens a browser tab
(per Stage 11 D33e — superseded for terminal focus only by D18 here).
A primed agent + a one-click "new claude session" makes Duo's
agent-native premise immediate from the first keystroke instead of
something the user has to remember.

**Exit criteria:** PM hits `⌘T` in a fresh Duo session, is talking
to a primed Claude in under three seconds, and the agent's first
response on a "summarize this doc" prompt uses `duo ax` or `duo doc
read` without being told to. `⌘⇧T` and the `>` half of the split
button still produce a bare shell.

### Phase 19a — Env signals (S, ~½ day)
- [ ] PtyManager exports `DUO_SESSION=1`, `DUO_SOCKET`, `DUO_VERSION`,
      `TERM_PROGRAM=Duo` (PRD D1–D3).
- [ ] `cli/duo.ts` skips socket discovery when `DUO_SOCKET` is set (D4).
- [ ] `duo doctor` reports `DUO_SESSION` (D5; cross-link to Stage 20).
- **Exit:** any process spawned inside Duo can detect "I'm in Duo"
  without heuristics.

### Phase 19b — Passive priming (M, ~2 days)
- [ ] Bundle `skill/priming.md` (D8) and copy to
      `~/Library/Application Support/duo/priming.md` on `duo install`.
- [ ] PATH shim at `~/Library/Application Support/duo/bin/claude`
      (D12, D13) — resolved real-claude inlined at install (D14).
- [ ] SessionStart hook merge into `~/.claude/settings.json` with the
      duo-tagged marker (D9, D10), gated on consent (D16).
- [ ] `duo install --uninstall-hook` (D15).
- **Exit:** a fresh Claude Code session inside Duo autonomously
  prefers `duo` verbs without the user mentioning anything. Verified
  via `/status` (or equivalent) showing the priming paragraph in
  the system prompt.

> **Cross-PR note:** Phase 19b's install paths overlap with **Stage
> Stage 18's first-launch installer**. When both PRs land, the hook + shim
> install should fold into the Stage 18 consent sheet (PRD D16). Until
> then, 18b's install runs through `duo install` with its own
> one-time prompt.

### Phase 19c — Default-to-claude tabs (M, ~2–3 days)
- [ ] Split-button affordance in `TabBar.tsx` — `+` = new claude
      session (primary), `>` = vanilla shell (D17).
- [ ] `⌘T` from terminal focus = new claude tab (D18 — supersedes
      Stage 11 D33e for terminal focus only).
- [ ] Spawn flow per D21–D23 (PtyManager spawns the user shell, then
      writes `claude\n`; fallback banner when claude not on PATH).
- [ ] `TabSession.kind: 'shell' | 'claude'` plumbed through shared
      types + preload + main + socket bridge.
- [ ] `duo new-tab [--shell|--claude] [--cwd] [--cmd]` CLI verb
      (D27). Replaces the listed `duo term new` in CLI-COVERAGE.
- [ ] Persisted last-kind for agent-driven calls (D28).
- [ ] [docs/dev/smoke-checklist.md § 5 keyboard matrix](docs/dev/smoke-checklist.md)
      updated — `⌘T` from terminal focus = claude tab; verify across
      all four focus surfaces.
- **Exit:** PM clicks `+` and is talking to a primed Claude in under
  two seconds; the `>` half still gives them a vanilla shell.

**Cross-stage interactions** (also documented in PRD § 6):
- **Stage 20** — `duo doctor` reads `DUO_SESSION` to distinguish
  "outside Duo" from "transport failing inside Duo".
- **Stage 18** — install consent absorbs the hook + shim work.
- **Backlog (was 15d)** — `duo new-tab --cmd` and `duo tab --cmd` overlap
  intentionally; lock semantics at 15d kickoff.
- **Stage 12** — split-button visual not in the Atelier mock yet;
  recommendation: ship 18c first, let 17 polish.

---

## Stage 17 — HTML canvas (was Stage 19, briefly Stage 13) `⬜ Spec drafted 2026-04-25; renumbered 2026-04-26 (twice)`

> **PRD:** [docs/prd/stage-17-html-canvas.md](prd/stage-17-html-canvas.md).
> Renumbered twice on 2026-04-26: from draft Stage 13 → Stage 19
> (avoiding collision with the existing transport-polish stage),
> then to **Stage 17** in the layered build-order rationalization.
> See § Number history. Five phases (~12–14 PRs) sequenced so 17a
> unlocks real usage and every later phase adds capability cleanly.
>
> **Sibling tab type to Stage 11** (markdown editor). Reuses the
> Atelier just-added highlight (Stage 13), the comment rail (Stage
> 14 — though HTML diff itself is deferred), the persistent-selection
> pattern, and the discriminated-union selection shape from Stage 15.
> Held until Layer 1 (Stages 13 + 14 + 15) ships in functional form
> so the reuse stories are concrete.
>
> **Editor-agnostic primitive contract** (locked
> [2026-04-26](docs/DECISIONS.md#editor-agnostic-primitives-shared-visual-chrome-surface-bound-data-bindings)):
> Stage 17 imports the visual primitives from
> `renderer/components/editor/primitives/` and writes a canvas-side
> binding under `renderer/components/canvas/bindings/`. Stage 13's
> Phase 0 already extended `DuoSelection` with the
> `HtmlCanvasSelectionSnapshot` placeholder, so Phase 17c (selection
> + Send → Duo) is "wire the iframe-DOM observer into the existing
> dispatcher" rather than "redesign the selection union."

**Why it matters:** Markdown is fine for prose; HTML is what an
agent reaches for when it wants tables that fit, side-by-side layouts,
callouts with iconography, embedded forms, or interactive checklists.
Today Duo can `duo open` agent-generated HTML in a browser tab, but
the human can't *edit* it — and the round-trip "Claude writes HTML →
PM tweaks two sentences and a typo" loop falls apart at the first
edit. This stage closes that loop.

**Exit criteria:** PM opens an `.html` file Claude generated, edits
two paragraphs and a table cell, leaves a comment on a third element,
and saves — and the file opens cleanly in any browser. Send → Duo on
the canvas surface lands the same payload shape as it does from the
markdown editor or a browser tab — one primitive, three modalities.

### Phase 17a — Render + edit primitive (~3–4 PRs)
- [ ] WorkingPane registers `html-canvas` tab type; `.html` click
      opens it (replaces today's "open with default app" for `.html`).
- [ ] `duo html new` + `duo edit <path.html>` alias.
- [ ] Iframe-srcdoc host with contentEditable on body; render-on-write.
- [ ] Top toolbar (PRD H28: inline marks + link picker).
- [ ] Save: autosave + `⌘S` + dirty dot (H33).
- [ ] Skill stub (H16) — README only, no snippets yet.
- **Exit:** PM opens an `.html`, edits prose, saves; the file is
  clean HTML another tool can read.

### Phase 17b — Stable IDs + sidecar foundation (~2 PRs)
- [ ] ULID minting + auto-injection of `data-duo-id` (H12, H13).
- [ ] First-open prompt for ID injection (H14).
- [ ] `<file>.duo.json` sidecar reader / writer; `version: 1`
      schema (H22).
- [ ] `duo html query / get / set / replace / append / remove / attr`
      end-to-end.
- [ ] `data-duo-component` recognition (no UI yet).
- **Exit:** Claude edits a specific element by `data-duo-id`; the
  change persists; the sidecar tracks the edit.

### Phase 17c — Agent overlay + selection (~2 PRs)
- [ ] **Atelier just-added highlight** for agent edits (H20). Reuses
      the Stage 13 spec — same yellow `mark` token + 6s fade.
- [ ] `recentEdits` log + repaint-at-open within freshness window.
- [ ] `duo selection` for canvas (H25 — extends the Stage 15
      discriminated union with `kind: 'html-canvas'`).
- [ ] Persistent blurred selection (H26).
- [ ] Send → Duo pill on canvas surface (H27 — natively works once
      H25 supplies the payload).
- [ ] Warn-before-overwrite banner (H36).
- **Exit:** PM selects on the canvas, hits the pill, terminal gets
  the quoted block; agent writes back, the change paints yellow.

### Phase 17d — Comments + lock convention (~3 PRs)
- [ ] `duo html comment`; comment rail re-used from Stage 14 (H23).
- [ ] Range resolution against `data-duo-id` + textPath (H21).
- [ ] Resolve / reply / accept UX (re-use Stage 14 D19).
- [ ] `data-duo-lock="structure"` rendering + ⌥-click override (H19).
- [ ] Skill snippet bundle (H17 boilerplate, H18 ten core components).
- **Exit:** PM leaves a comment on a callout; Claude reads it via
  `duo html changes` and acts.

### Phase 17e — Polish + scripts + source view (~2 PRs)
- [ ] Script opt-in dialog (H8) + sidecar persistence (H22).
- [ ] Source view toggle with CodeMirror 6 (H32).
- [ ] Find & replace (`⌘F` / `⌘⌥F`) — re-use Stage 11 component.
- [ ] External-write reconciliation (H35) — re-use Stage 16's
      three-pane diff.
- [ ] Slash menu (H29). Floating selection bubble (H30).
- **Exit:** the canvas feels native enough that an HTML report from
  Claude is the natural artifact, not the markdown.

**Cross-stage interactions** (also documented in PRD § 8):
- **Stage 13** — supplies the just-added highlight visual; 19c
  reuses identically.
- **Stage 14** — comment rail (D20), accept-all banner. 17d reuses
  the components.
- **Stage 15** — supplies the discriminated-union selection shape
  + Send → Duo pill machinery. 17c is mostly wiring the canvas
  surface into the existing dispatcher.
- **Stage 12** — Atelier tokens supply the visual language. The
  canvas inherits the same paper-tone surface + ochre accent +
  yellow `mark` highlight as the markdown editor.

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
| Distribution / cert | **No cert — personal use** | Ad-hoc or unsigned; cert procurement (see § Owner pre-work) is the longest lead time before Stage 21 can start |
| Stage 14 split (2026-04-26) | **Old Stage 14 → new Stages 18 + 21** | Decouples user-facing first-launch UX (Stage 18 — no cert) from cert procurement (Stage 21 — gated). Stage 18 ships to Trailblazers ahead of 21 |
| 2026-04-26 layered renumber | **Stage numbers reflect actual build order, not chronology of planning** | See § Number history. Stage 12 (Atelier) is now first because every L1+ stage inherits its tokens. Old commit refs may use old numbers — the map translates them. |
| 2026-04-26 pane focus indicator | **Tint the focused column's chrome strip (`accent-soft`), don't try to ring the column wrapper** | xterm canvas + WebContentsView occlude inset shadows on the wrapper. The strip is renderer DOM and never occluded. See [DECISIONS.md](docs/DECISIONS.md#pane-focus-indicator-chrome-strip-tint-not-column-wrapper-ring) for the v1→v2 history and rejected alternatives. |

## Open Questions

| Question | Needed Before |
|---|---|
| Apple Developer ID cert | Stage 21 |
| Distribution timeline (personal → Trailblazers) | Stage 21 |
| Socket auth approach for Trailblazers | Stage 21 |
| Sandbox-tolerant transport: TCP fallback + `duo doctor` + install-path fix (see `docs/DECISIONS.md` → Open ADRs: *Sandbox-tolerant transport and install paths for the `duo` CLI*) | Stages 5 (docs), 20 (transport), 18 (install path + settings fragment) |
