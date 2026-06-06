# Duo — Architecture Decisions

> All decisions in §6 of the brief are LOCKED. This document adds rationale,
> implementation notes, and records any decisions made during build.
>
> **Where this fits:** stage-level sequencing lives in
> [the roadmap](roadmap.html). This file is the *architectural-decision*
> truth — choices that bind across stages. Each stage's PRD in
> [docs/prd/](prd/) cross-references the relevant ADRs.

---

## LOCKED decisions (from brief §6)

### App framework: Electron

**Choice:** Electron 32+ (targets Chromium 128+)

**Why locked:** The two hard constraints are (1) Google SSO must work and
(2) the agent must read the DOM. Only Electron provides real Chromium with
Node.js IPC access in the same process. All alternatives fail on one constraint:

| Alternative | Failure mode |
|---|---|
| Tauri | Uses WebKit (no Google SSO) |
| CEF (standalone) | No Node.js IPC; C++ bridge needed |
| Swift + WKWebView | WebKit, not Chromium |
| Electron + remote CDP | External Chrome instance; auth state not shared |

**Implementation note:** Pin Electron version in `package.json`. Electron minor
updates are safe; major updates (Chromium bump) require testing Google SSO.

---

### Terminal renderer: xterm.js + node-pty

**Choice:** `@xterm/xterm` ^5.5 + `node-pty` ^1.0

**Why locked:** VS Code's stack. Battle-tested, full ANSI/mouse, multi-instance
trivial (one `Terminal` object per tab), `FitAddon` handles resize.

**Implementation notes:**
- `node-pty` is a native module; must be in `asarUnpack` in `electron-builder.yml`
- Requires `electron-rebuild` after `npm install` (in `postinstall` script)
- Use `@xterm/xterm` (new scoped package, v5.5+), not the old `xterm` package

---

### Browser embedding: WebContentsView

**Choice:** `WebContentsView` (Electron 28+)

**Why locked:** Direct replacement for the deprecated `BrowserView`. Full
Chromium, same session for SSO persistence across navigation. The view is
owned by the main process and positioned behind the renderer window.

**Implementation notes:**
- The renderer has no direct access to the WebContentsView — it's a main-process
  construct. The renderer sends bounds via IPC; the main process repositions the view.
- Session partition: `persist:duo-browser` → survives app restart
- The view should be created once and repositioned, not recreated on tab switch

---

### Agent ↔ browser bridge: Unix socket + CLI

**Choice:** `duo` CLI over `~/Library/Application Support/duo/duo.sock`

**Why locked:** User explicitly rejected MCP. CLI tool on PATH is the most
Claude-Code-native pattern — the agent calls it like any shell command. No
protocol overhead, no schema negotiation, no extra install step.

**Implementation notes:**
- Protocol: JSON line-delimited (request/response matched by UUID)
- Socket path: in `~/Library/Application Support/duo/` (sandbox-safe vs `/tmp`)
- Security: for MVP, any local process can send commands. Before wider distribution,
  add a launch-time auth token written to `~/.duo/token` and validated on each connection.
- Error contract: non-zero exit on failure, human-readable stderr, JSON result on stdout

---

### UI framework: React + Tailwind

**Choice:** React 18 + Tailwind 3 + electron-vite

**Why locked:** Standard Electron renderer stack. Fast iteration, Tailwind's
utility classes avoid CSS-in-JS overhead, electron-vite gives HMR in dev.

**Implementation notes:**
- Tailwind config: custom color palette (`surface.*`, `border.*`, `accent.*`) in
  `tailwind.config.js` for consistent dark theme
- Font: system-ui for UI chrome; JetBrains Mono (with fallbacks) for terminals
- No CSS-in-JS; all styling via Tailwind utilities + `globals.css` for xterm overrides

---

### Build tooling: electron-vite + electron-builder

**Choice:** `electron-vite` ^2.3 + `electron-builder` ^24.13

**Why locked:** electron-vite provides HMR for all three Electron contexts
(main, preload, renderer) in a single `npm run dev`. electron-builder handles
universal macOS DMG + code signing in one config file.

**Implementation notes:**
- Custom source directories (`electron/`, `renderer/`) configured via
  `rollupOptions.input` in `electron.vite.config.ts`
- Output: `out/` (development + production builds), `dist/` (DMG artifacts)
- `asar: true` with `asarUnpack: ["**/node_modules/node-pty/**"]` — node-pty's
  native `.node` file cannot be asar-packed

---

### Target OS: macOS only

**Choice:** macOS (arm64 + x64 universal binary)

**Why locked:** Linux/Windows deferred. Universal binary covers Apple Silicon
and Intel; no separate downloads.

---

## Decisions made during build

### Socket path: `~/Library/Application Support/duo/` not `/tmp`

**Decision date:** Stage 1 scaffold  
**Rationale:** `/tmp` is cleaned on reboot and is not sandbox-safe on macOS.
`~/Library/Application Support/duo/` is the conventional macOS app data location
and persists across reboots. Consistent with `BROWSER_SESSION_PATH`.

---

### PTY sessions keyed by tab ID (UUID)

**Decision date:** Stage 1 scaffold  
**Rationale:** Tab IDs are `crypto.randomUUID()`. Using them as PTY session keys
makes IPC channel names deterministic (`pty:data:<uuid>`) and avoids a separate
session registry.

---

### Terminal instances always mounted, hidden by CSS

**Decision date:** Stage 1 scaffold  
**Rationale:** Unmounting a terminal on tab switch would kill the PTY session and
lose scroll buffer. Instead, `TerminalInstance` components remain mounted but
set `display: none` when inactive. `FitAddon.fit()` is called via `requestAnimationFrame`
when a tab becomes visible to handle deferred layout.

---

### App name: "Duo" — confirmed by owner

**Status:** Confirmed  
**Decision:** The app is named "Duo". The CLI is `duo`. The skill installs to
`~/.claude/skills/duo/`. No further confirmation needed.

---

### Layout model + working-pane model — resolved by owner

**Status:** Confirmed 2026-04-23  
**Supersedes:** the "Layout model" and "Working pane model" rows in
`duo-brief.md §7` (both previously marked OPEN — OWNER ACTION), and the
ten-option mockup at `docs/ux/layout-options.html`, which is now
historical.

**Decision — three-column layout:**

```
┌────┐┌─────────────────┐┌─────────────────┐
│    ││                 ││ Viewer/Editor   │
│Files││    Terminal    ││ (polymorphic:   │
│    ││                 ││  browser / .md  │
│    ││                 ││  editor / file  │
│    ││                 ││  preview)       │
│    ││                 ││                 │
│    │└─────────────────┘│                 │
│    │┌─────────────────┐│                 │
│    ││  Agent tools    ││                 │
│    ││  (collapsible,  ││                 │
│    ││   Backlog)      ││                 │
└────┘└─────────────────┘└─────────────────┘
```

- **Files** (left, full-height, narrow) — file browser / context
  drawer. Stage 10.
- **Middle column** — stacked vertically:
  - **Terminal** (top, primary) — PTY session(s) where the agent lives.
  - **Agent tools** (bottom, collapsible, optional) — unified skill +
    connector surface. Backlog (was old Stage 12, deprioritized in 2026-04-26 renumber). Collapsed state gives the terminal
    the full middle column.
- **Viewer/Editor** (right, full-height, wide) — tabbed polymorphic
  surface with **one unified tab strip** across every modality. Each
  tab carries a type:
    - Browser (a web page loaded via `WebContentsView`).
    - Markdown editor for `.md` files (Stage 11).
    - File preview / source-editor for non-`.md` types — images, PDF,
      CSV, HTML source, code (Stage 10 per-type registry).
  Clicking a tab swaps what's rendered. The same file may appear in
  multiple tabs under different types — e.g. tab 3 editing
  `prototype.html` as source and tab 4 rendering the same file in
  browser mode.

**Working-pane model — resolved sub-decisions:**

- **Tabbed from the start, unified across modalities.** Not "single
  slot with a later tabbed wrapper." Tab IDs are continuous (1..N)
  regardless of type, so `duo tabs` / `duo tab <n>` / `duo close <n>`
  (already shipped for browser tabs in Stage 8) extend naturally to
  cover editor and preview tabs without a breaking change to the
  semantic.
- **Shared across terminal tabs**, not per-terminal-tab. The right
  column is one working surface the user looks at; switching which
  terminal is active on the left does not change what's on the right.
- **Markdown editor scope: local `.md` files only.** Google Docs
  stays in a browser-type tab (via the verified `/export?format=md`
  read and the `duo` write primitives). The Stage 11 editor does not
  edit live Docs.
- **Terminal tabs are a separate strip.** The middle column's
  terminal has its own tab bar (current behavior unchanged). Terminal
  tabs and working-pane tabs don't share numbering; `duo tabs`
  continues to mean working-pane tabs.

**Implementation implications:**

- Today's layout — terminal-left, browser-right, no Files column — is
  a waypoint. The reshape happens as part of Stage 10 (which adds the
  Files column) and Stage 11 (which adds the `.md` editor as a tab
  type).
- The current `BrowserPane` + `BrowserTabStrip` become one renderer
  inside a larger `WorkingPane` shell. The tab strip is hoisted up to
  the shell (so it can show non-browser tabs too); each tab
  dispatches to a type-specific renderer (browser / editor /
  preview) at render time.
- Each tab carries `{ id, type, title, ...typeSpecific }`. Browser
  tabs keep `url`; editor tabs add `path` + dirty-state; preview
  tabs add `mime`. The CLI surface extends without breaking: `duo
  tabs` returns the full mixed list; agents can filter by `type` if
  they want. `duo open` stays the creation command; `--as <type>`
  (or inference from extension) chooses the renderer.
- The terminal moves from the left column to the middle column at
  reshape time. The xterm.js / node-pty plumbing is unaffected.
- Agent tools panel (middle-bottom) is deferred to Backlog (was old Stage 12) but the
  layout shell must reserve space for it (or cleanly collapse when
  absent).

---

### Reserved frontmatter namespace: `duo.*`

**Status:** 🟢 Locked (2026-04-24, owner)
**Context:** Stage 11 markdown editor persists document-level editor
state inside the `.md` file's YAML frontmatter rather than in a sidecar.
First concrete use: `duo.trackChanges: true|false` (PRD D18).

**Decision:** The `duo.*` key namespace inside frontmatter is reserved
for Duo. Third-party tools must not write into it; Duo must not touch
any other key. Current reservations:

- `duo.trackChanges: boolean` — per-document track-changes toggle
  (Stage 11 PRD D18). When `true`, edits become CriticMarkup
  (`{++ins++}` / `{--del--}` / `{~~old~>new~~}`) until accepted.

Future reservations land in this list with a PRD reference and a
short rationale. Keep the namespace shallow (`duo.foo`, not
`duo.editor.foo`) unless there's a real grouping need.

**Why frontmatter, not a sidecar:** single-file portability — `mv
foo.md elsewhere/` keeps the doc state intact; GitHub diffs show the
toggle change inline with the content; no `.duo.json` orphans to
garbage-collect.

---

### Skill scoping: global install at `~/.claude/skills/duo/`

**Status:** 🟢 Locked (2026-04-25, owner)
**Raised:** 2026-04-23 (originally as an Open ADR)
**Resolves:** Stage 5 skill install step.

**Decision:** The `duo` skill is installed **globally** at
`~/.claude/skills/duo/` — the status quo. The skill is visible in
every Claude Code session on the machine, not just sessions Duo
itself spawned.

**Why this option won:**

- **Simplest mental model.** `duo --version` failing is the implicit
  "not in Duo" signal; the skill itself describes the abort path
  (the "When NOT to use `duo`" section). Claude already short-circuits
  cleanly when the bridge is unreachable.
- **Zero extra plumbing.** Per-session scoping required a Duo-owned
  `ZDOTDIR` / `--plugin-dir` shell-init hop, which adds fragility for
  a problem that hasn't materialized in practice — the skill's
  guidance is read-only and well-isolated from non-Duo workflows.
- **Reversible.** If the skill grows aggressive anti-improvisation
  guardrails that *do* leak into non-Duo sessions, we can revisit and
  ship one of the per-session options (which remain documented below
  for future reference).

**Alternatives kept on the books for future reference:**

1. *Per-session via shell init + `claude --plugin-dir` wrapper.*
   PtyManager spawns zsh with a Duo-owned `ZDOTDIR` that defines a
   `claude()` function forwarding `--plugin-dir <duo-bundled-skill-dir>`.
   Cleanest scoping, but adds shell-init fragility and namespaces the
   skill as `/duo:<name>`.
2. *Per-session via `claude --add-dir <duo-bundled-skill-parent>`.*
   Same shell-init wrapper, no plugin prefix.
3. *Project-level `.claude/skills/duo/` only.* Symlink into the PTY's
   launch CWD. Evaporates on `cd`, so unreliable as a sole mechanism.

**Operational impact:**

- Stage 5's first-launch installer (`npm run sync:claude` for dev;
  bundled `fs.copyFile` for end users) continues to copy
  `skill/SKILL.md` + `agents/duo-browser.md` into `~/.claude/`.
- No change to `cli/duo install` — the CLI continues to symlink to
  `~/.local/bin/duo` or `/usr/local/bin/duo`.

---

### Editor-agnostic primitives: shared visual chrome, surface-bound data bindings

**Status:** 🟢 Locked (2026-04-26)
**Raised:** 2026-04-26 (Stage 13/14/15 kickoff vs. Stage 17 reuse audit)
**Resolves:** the question "where does shared editor functionality
live so we don't refactor it twice when Stage 17 (HTML canvas) lands?"

**Decision.** Editor features that ship with Stage 13 (just-added
highlight + warn-before-overwrite), Stage 14 (track changes), and
Stage 15 (Send → Duo) decompose into a **visual layer** and a **data
layer**:

- **Visual layer** — pure React components + CSS keyframes/tokens.
  Examples: the `duo-just-added` keyframe, `<WriteWarningBanner>`,
  `<CommentRail>`, `<AcceptAllBanner>`, `<TrackedRangeMark>`,
  `<SendToDuoPill>`. These take typed change records / selection
  shapes / handlers as props and know nothing about TipTap or
  contentEditable iframes. They live under
  `renderer/components/editor/primitives/` (new directory) and import
  no editor-specific code. Both the markdown editor (Stage 11) and
  the HTML canvas (Stage 17) consume them.

- **Data layer** — surface-specific bindings that translate the
  editor's native model into the records the visual layer expects.
  For the markdown editor, this is TipTap extensions / ProseMirror
  decorations (`renderer/components/editor/extensions/`). For the
  HTML canvas (Stage 17), this is iframe-DOM observers + `<ins>`/
  `<del>` tags and/or `data-duo-track-*` attributes
  (`renderer/components/canvas/bindings/`, future).

The split is the contract: a primitive belongs in `primitives/` only
if it has zero editor-specific imports. If a "shared" component
reaches into TipTap APIs, it's a binding masquerading as a primitive
— refactor before shipping.

**Why this option won.**

- **Stage 17 is in scope, not hypothetical.** Its PRD already names
  the Stage 11/13/14 primitives it expects to reuse (H20 just-added
  highlight, H23 comment rail, H25 selection union, H27 Send → Duo
  pill, H36 warn-before-overwrite). Building Stage 13/14/15 against
  a "MD only" assumption guarantees a refactor pass when 17 lands.
- **The data layers are intrinsically different.** TipTap operates on
  a strict ProseMirror schema; the canvas operates on arbitrary HTML
  via `MutationObserver` (Stage 17 H3). Trying to share the data
  layer would force one of the surfaces into the wrong model. The
  visual layer is what's genuinely common.
- **Track-changes is the test case.** Stage 17 H39 defers HTML
  track-changes to v2, so Stage 14 doesn't have to ship the canvas
  binding immediately. But if the visual chrome is canvas-agnostic
  from day one, Stage 17 v2 is "wire a binding into existing
  components" rather than "rebuild the comment rail."

**Implications for Stage 13 (the warm-up).**

- Phase 0 (refactor first):
  - Extend `DuoSelection` union in `shared/types.ts` with
    `HtmlCanvasSelectionSnapshot` placeholder (Stage 17 H25 shape).
    Locks the union shape NOW so Stage 15 ships canvas-ready instead
    of forcing a shape change later.
  - Rename `EditorSelectionTagged` → `MarkdownSelectionSnapshot` for
    symmetry with the canvas snapshot type. IPC channel names
    (`EDITOR_SELECTION_PUSH`) keep their names but the cache holds an
    active `DuoSelection` (kind-discriminated).
  - Document the active-doc-surface pattern in `main.ts` so future
    stages don't bury MD assumptions in shared components again.

- Phase 1 — `duo-just-added` keyframe in `globals.css` (single
  source of truth) + TipTap decoration extension that adds the
  class. Visual lives in CSS; binding lives in
  `extensions/JustAdded.ts`.

- Phase 2 — `<WriteWarningBanner>` standalone in
  `primitives/`. Hooks into the renderer's external-write signal.

**Implications for Stage 14 (track changes).**

Ship four reusable visuals:
`<TrackedRangeMark>`, `<AcceptAllBanner>`, `<CommentRail>`,
`<TrackChangesProvider>` (state container). Markdown-specific code
lives in `extensions/TrackChanges.ts`. HTML canvas v2 (Stage 17
follow-up) writes its own binding using the same components.

**Implications for Stage 15 (Send → Duo).**

`<SendToDuoPill>` takes a `DuoSelection` (the locked union from
Phase 0) and a position-computer function from the host surface.
Editor surface, browser surface, and canvas surface (Stage 17 H27)
all wire the same component.

**Implications for Stage 17 (HTML canvas).**

The H20/H23/H25/H27/H36 reuse stories are now concrete. Stage 17a
(render + edit primitive) just imports the primitives directory;
nothing under `extensions/` follows because TipTap isn't involved.

**Operational impact.**

- Code review: any PR that lands a "shared" editor component checks
  for editor-specific imports. If it imports `@tiptap/*` or
  `prosemirror-*`, it's a binding, not a primitive.
- Future surface additions (e.g., a future spreadsheet canvas) follow
  the same pattern: build a binding, reuse the primitives.

---

### Pane focus indicator: chrome-strip tint, not column-wrapper ring

**Status:** 🟢 Locked (2026-04-26)
**Raised:** 2026-04-26 (BUG-003 v1 ship)
**Resolves:** [BUG-003](../tasks.md) and the general question "where
in the column hierarchy do we paint pane-focus indicators?"

**Decision.** When a column has keyboard focus, paint the indicator on
its **chrome strip** — the tab bar (Terminal, Working) or the
breadcrumb header (Files). The strip's background tints to
`var(--duo-accent-soft)` and its bottom border flips to
`var(--duo-accent)`. The column wrapper's seam border also flips to
full-opacity accent as a secondary cue, but the strip tint is the
authoritative signal.

**Why this option won.** v1 of the BUG-003 fix tried a 2px inset
shadow ring on the column wrapper. It looked right for Files (no
opaque overlay child) and immediately failed for Terminal and Working:

- **Terminal column.** xterm.js paints to a `<canvas>` with an opaque
  background. Box-shadow `inset` is part of the wrapper's painting
  pass, drawn before children — the canvas covers it on three sides.
- **Working pane.** The browser pane uses a `WebContentsView` — a
  separate `WebContents` layered above the BrowserWindow's renderer.
  In Electron's compositor model, anything inside the WebContentsView's
  bounds paints **above** any renderer DOM at any z-index. A
  renderer-side `pointer-events: none` overlay div literally cannot
  reach above it.

What was left in v1 for those two columns was just the 1px wrapper
border, which abuts the neighbour's wrapper border at the
split-divider. Visually one ambiguous accent line that says "the
seam between these two panes is highlighted" — it doesn't say which
side owns the focus.

The chrome strip avoids both occlusion modes: it's renderer DOM (no
WebContentsView issue), it's above the xterm canvas vertically (no
canvas occlusion), and each strip "belongs" unambiguously to one
column with no shared edge.

**Implementation.** A `focused?: boolean` prop on `TabBar`,
`WorkingTabStrip`, and `WorkingPane`. `FilesPane` already received
`focused`; its breadcrumb header gets the same tint. Driven from
`focusedColumn` in `App.tsx`.

**Alternatives considered and rejected.**

1. *Shrink the WebContentsView bounds by 2px when focused, exposing
   a paper-rule strip that the wrapper's inset shadow paints into.*
   Causes the page to reflow on every focus change — visible flash on
   pages that respond to viewport size (responsive layouts, video
   players, IME composition windows). Not worth it for a focus cue.
2. *Bump the wrapper's border from 1px to 2px on focus.* Causes a
   1px layout shift in neighbouring columns on every focus change.
3. *Outline (`outline: 2px solid` with `outline-offset: -2px`).*
   Outlines paint outside the box and clip at the window edge in
   ways that break visually for the rightmost column.
4. *Pointer-events-none overlay div with `position: absolute` +
   `inset: 0`.* Same WebContentsView occlusion problem as inset
   shadow — overlay paints on the renderer compositor layer, below
   the WebContentsView.

**Operational impact.**

- Future pane-aware UI: when adding new chrome strips (e.g. the
  Stage 12 split-button visual for Stage 19c), pass `focused` through
  and apply the same `accent-soft` tint to keep the indicator pattern
  consistent.
- Don't reach for inset-shadow / overlay rings on column wrappers
  again — the WebContentsView occlusion isn't going away unless the
  whole browser-rendering architecture changes.

### Editor chrome inside ProseMirror: decorations, not DOM mutations

**Status:** 🟢 Locked (v0.5.1, ENH-005 follow-up)
**Raised:** 2026-04-28 — copy buttons on markdown-editor code blocks
**Resolves:** "what's the right way to add non-doc chrome (buttons,
badges, overlays) inside the markdown editor's contentEditable
surface so the chrome survives transactions?"

**Decision.** Use ProseMirror decorations, never direct DOM
mutations to the editor's `view.dom`:

- **`Decoration.node(pos, pos + node.nodeSize, { class: ... })`** for
  attribute/class additions to existing nodes. PM tracks node
  decorations separately from doc state; classes survive
  transactions.
- **`Decoration.widget(pos, renderFn, { side, key })`** for inserted
  DOM that isn't part of the doc. The widget is a PM-managed sibling
  of the rendered node DOM; it doesn't show up in the doc model and
  doesn't trigger the dirty buffer / autosave path.
- For widgets that need text-content extraction from the host node
  (e.g. a Copy button reading the codeBlock's text), clone the host
  + strip the widget's own DOM before reading textContent.

**Why this option won.**

- **PM aggressively reverts unsanctioned DOM mutations.** Direct
  `pre.appendChild(button)` and `pre.classList.add(...)` both get
  undone on the next transaction (ENH-005 went through three
  abandoned approaches before landing here). The reconciliation runs
  on every edit, every selection change, and every node-view refresh
  — there's no event you can hook to "re-inject after PM reverts"
  that doesn't fight the renderer.
- **Decorations don't trigger doc-mutation cycles.** A widget is
  invisible to the dirty-detection path; the autosave timer doesn't
  fire when widgets render. DOM mutations on contentEditable do
  trigger dirty detection and would falsely mark every codeBlock as
  edited on first paint.
- **Composes cleanly with CodeBlockLowlight + future NodeViews.**
  CodeBlockLowlight has its own NodeView for syntax highlighting;
  decorations layer on top without conflict. A widget at `pos+1`
  renders inside the codeBlock's content area but isn't part of its
  text — no schema violations.

**Why not the alternatives.**

- *Direct DOM mutation*: reverted on transactions. Fails immediately.
- *MutationObserver-based re-injection*: fights PM's reconciliation
  loop; pathological CPU usage on large docs.
- *External overlay positioned via getBoundingClientRect*: works but
  fragile under scroll, resize, and HMR. Adds a sync loop the editor
  primitives don't otherwise need. Reach for this only when widget
  decorations genuinely can't express what's needed (e.g. chrome
  spanning multiple disjoint nodes).
- *NodeView replacement for codeBlock*: would conflict with
  CodeBlockLowlight's own NodeView. Possible but invasive.

**Generalization.** Future "add chrome to the editor without
touching the doc" patterns (Stage 14's CommentRail markers, Stage 16
external-write banner inline anchors, BUG-024's selection-pill
unification) should reach for decorations first. Implementation
reference: `renderer/components/editor/extensions/CodeBlockCopyButton.ts`.

### Claude-presence gating: process-tree probing, not tab-kind heuristics

**Status:** 🟢 Locked (v0.5.1, ENH-013)
**Raised:** 2026-04-28 — Send → Duo pill misfiring into shells where
Claude was `/exit`'d.
**Resolves:** "how do we tell whether the user's active terminal is
running Claude RIGHT NOW (vs. spawned-as-Claude-but-now-shell)?"

**Decision.** Walk the active PTY's child-process tree every 500ms
via one `ps -ax -o pid,ppid,comm` call; flip the gate state when a
descendant whose basename is `claude` enters or leaves the tree. Add
a 1.5s grace window after a `kind:'claude'` tab spawn so the gate
stays "live" during the launch gap before `claude` exec's.

Reference implementation: `electron/claude-presence.ts`. State
machine: `'no-pty' | 'shell' | 'claude' | 'starting'`. Renderer hook:
`useFrontTerminalClaudeLive` (true iff state is `claude` or
`starting`).

**Why this option won.**

- **`tab.kind === 'claude'` records intent at spawn, not current
  state.** A user typing `/exit` to back out of Claude into a shell
  prompt would still see the pill light up — actively destructive
  (selected text pipes into a shell, runs as a command).
- **Process-tree probe is cheap.** `ps -ax` walks the system's
  process table once per call (~1ms on macOS even with 500+ procs);
  BFS over the tree is microseconds. Polling at 500ms is invisible
  on top of normal Electron CPU use.
- **Generalizable.** Same plumbing will eventually back FOLLOWUP-002
  (agent guards on `agents/duo.md` against Bash-allowlist denial)
  and any future "is the agent live in this terminal?" gate. The
  prober's `setTarget({ pid, kind })` API is small and reusable.

**Why not the alternatives.**

- *Watch PTY output for claude prompt regex*: brittle to UI changes
  in Claude Code (and would lag a turn behind on user keystrokes).
- *Hook into Stage 19c's `+ button → claude\n` write*: only catches
  the auto-spawned case; misses `claude` typed manually.
- *Push state via the renderer*: requires the renderer to know about
  child processes, which violates the renderer/main split. Main owns
  PTYs already; the prober belongs there.
- *Tab-kind only (status quo)*: described above — wrong on `/exit`,
  wrong on crashed-claude.

**Trade-offs accepted.**

- 500ms poll cadence introduces up-to-500ms latency between Claude
  exiting and the pill disappearing. Acceptable — the pill being
  briefly stale is much less harmful than firing into a shell.
- The prober assumes macOS `ps` flags. Cross-platform support would
  need `pgrep -P <pid>` recursion or `/proc` parsing. Out of scope
  pre-1.0 (Duo is macOS-only per the framework decision above).

### Editor / canvas convergence: parallel codebases with explicit parity rule, not unification

**Status:** 🟢 Locked 2026-05-02 (Sprint 3 Phase 2 — closes the convergence question raised by BUG-061's "have we failed to merge the components between md vs html canvases?").
**Raised:** 2026-05-02 — three consecutive editor features shipped to one surface but not the other (ENH-018 bullet markers shipped only for the markdown editor; ENH-025 ⌘[ / ⌘] indent shipped only for the markdown editor; BUG-061 then surfaced the asymmetric bullet trigger gap on the canvas surface). The accumulating "this exists in editor but not canvas" backlog made the question explicit: **do we keep the two surfaces separate and accept that drift, or unify them?**
**Resolves:** "Should the markdown editor (TipTap-backed, Stage 11) and the HTML canvas (raw `contentEditable` iframe, Stage 17) converge into a single editing primitive, or stay as parallel codebases that mirror features explicitly?"

**Decision.** Keep them parallel. Mirror features explicitly. Add a parity-tracking rule to the plumbing checklist so drift becomes deliberate, not accidental.

The two surfaces have fundamentally different contracts that justify the duplication:

- **Markdown editor (TipTap):** the document is *what TipTap renders.* The on-disk file is the markdown serialization of TipTap's ProseMirror tree. Schema-strict; rich input rules; structured paste; tracked-changes-ready (Stage 14). The user is editing **a document** through an editor.
- **HTML canvas (contentEditable iframe):** the document IS the page (Stage 17 PRD H1). The on-disk HTML is exactly what the user authored — no virtual DOM, no schema rewrite, no serializer. Hand-authored CSS survives untouched; arbitrary HTML structures are honored verbatim. The user is editing **a page** that happens to be live.

Unifying them requires picking which contract wins. Either we wrap canvas in TipTap (loses the "the canvas IS the page" guarantee — TipTap's schema doesn't preserve arbitrary HTML), or we extract a shared text-editing primitive that's neither TipTap nor raw contentEditable (a multi-month rewrite of two mature surfaces). Neither pays back the cost of the parallel-features tax we accept by mirroring.

**Why this option won.**

- **PRD-H1 is load-bearing.** "The canvas IS the page" is what makes the canvas attractive for HTML-first authoring (lessons, dashboards, agent-emitted artifacts). Wrapping it in TipTap would force authored HTML through a schema-roundtrip; the canvas would no longer be a valid place to author arbitrary HTML.
- **Drift is bounded, not unbounded.** The two surfaces have ~6 features in common today (block formatting, inline marks, list operations, indent/outdent, headings, code blocks). Each new feature is one mirror-port of work, not a doubling of the codebase. The parity-checklist rule (added below) catches drift at PR review time rather than at smoke-walk time.
- **Different surfaces, different contracts.** When the user opens a markdown file, they expect markdown semantics (input rules, paste rewrite, schema enforcement). When they open an HTML canvas, they expect HTML semantics (whatever you wrote stays). A unified primitive would have to negotiate those differing expectations every keystroke.
- **Reversibility.** If a future use case demands unification, the parity-tracking rule means we know exactly which features to preserve. The split-codebase state is a strict superset of any unified state — we can collapse later, we can't easily un-collapse.

**Why not the alternatives.**

- **Path B1 — embed TipTap inside the canvas iframe.** Solves drift; breaks PRD-H1 (TipTap's schema rewrites arbitrary HTML on parse, so hand-authored layouts would round-trip incorrectly). Also loses the "agents author canvases by writing HTML, not by learning TipTap's schema" promise that Stage 27 codified.
- **Path B2 — extract a shared `<TextEditingPrimitive>` that both surfaces compose.** Multi-month refactor of two stable surfaces. The shared primitive would have to handle two different contracts (schema-strict vs HTML-pass-through), making it the most complex thing in the codebase. The bug surface would grow, not shrink. Doesn't pay for itself.
- **Path B3 — replace canvas with TipTap-with-raw-HTML mode.** TipTap doesn't have a "preserve arbitrary HTML" mode in any robust form. Hacks exist (HTML-as-codeblock, schema escape hatches), but they re-introduce schema-roundtrip surprises that break PRD-H1.

**Trade-offs accepted.**

- **Each new editor feature = two implementations.** ENH-076 (⌘[ / ⌘] in canvas, parity with ENH-025 in editor) is the canonical example: ~10 lines mirroring ENH-025's handler. Across the v0.6.x → v1.0 horizon, ~5–10 such mirror-ports expected. Cost is bounded.
- **Drift between surfaces is deliberate where it occurs.** Bullet markers (`*` vs `-` round-trip per source character) are an editor-only feature; the canvas is HTML-first and doesn't have a markdown-marker concept to round-trip. Documented in the relevant ENH. The parity rule below requires explicit "skip — surface-specific" annotation in PR descriptions for non-mirrored features.
- **Bug-fix work is per-surface.** BUG-061 (canvas bullet trigger) and the prior BUG-018 (editor bullet markers) had different fixes. Each surface gets its own bug tracker entry; cross-references encouraged.

**The parity rule (now part of CLAUDE.md plumbing checklist).** Whenever a new editor feature ships to ONE of the two surfaces, the PR description must explicitly state one of:
- (a) **Mirrored:** the same feature also ships in the other surface in the same PR (or a paired PR landing within the same sprint).
- (b) **Skipped — surface-specific:** the feature has no analog on the other surface, with a one-line reason (e.g. "bullet-marker round-trip is a markdown-source concept; canvas authors hand-write CSS list-style, no equivalent").
- (c) **Deferred — parity gap accepted:** the feature ships to one surface for v1; mirror-port queued as a tracked ENH/BUG with cross-reference back to this PR.

**Implementation order.**

1. **No code change required to lock the decision.** Two surfaces continue as today.
2. **CLAUDE.md plumbing checklist gets a new "Editor-canvas parity rule" section** — codifies the (a)/(b)/(c) annotation requirement above.
3. **Existing parity gaps tracked.** ENH-076 (canvas ⌘[ / ⌘] indent) is in Sprint 3 Phase 3; will close one of the open gaps. MISSING-001 (markdown editor add-comment affordance) is the inverse direction — comments live in canvas via Stage 17d's CommentRail; the markdown editor needs equivalent surfacing. Tracked under Phase 3 of this sprint.
4. **No active rewrite work** — the decision is to keep the parallel codebases, so there's nothing to refactor proactively. Future feature work follows the parity rule.

Cross-references: BUG-061 (the bug that raised the convergence question), ENH-018 (markdown editor bullet markers — an example of a deliberate non-mirror), ENH-025 (markdown editor ⌘[/⌘] indent — paired with canvas-side ENH-076), MISSING-001 (markdown editor needs comment-add affordance — inverse-direction parity gap), Stage 11 PRD (markdown editor), Stage 17 PRD H1 ("the canvas IS the page" — the load-bearing principle that drove this decision), `.claude/rules/renderer-surfaces.md` (where the editor/canvas parity rule now lives).

**Amendment (2026-06-04, ENH-195 D5) — extract the shared *reconciliation* layer, keep the editing surfaces separate.** ENH-195 introduces three CLI edit verbs (`duo doc edit`, `duo json set`, `duo json merge`) that must land changes into a live surface when the file is open, without spurious "file changed on disk" conflict banners. D5 extracts a single shared `useDiskReconciliation` hook — the disk-watch → echo-detect → clean-reload-or-conflict-banner pipeline — now consumed by the markdown editor, the canvas, AND the JSON/YAML viewer-editor (`kind: 'json'`). The EDITING surfaces stay separate exactly as this decision locks them: TipTap (markdown) vs `contentEditable` (canvas) vs the JSON tree/source view. PRD-H1 ("the canvas IS the page") is intact; the hook touches zero editing contract — each surface injects its own `serialize` / `applyReload` / `normalize` callbacks. **This is explicitly NOT the rejected Path B2** (a shared `<TextEditingPrimitive>` both surfaces compose) — Path B2 unifies *editing*; D5 unifies only *reconciliation* (file-watch + echo-detect + reload-or-banner), which was already duplicated three ways. Two guard-rails preserved: (1) the markdown comparator `normalizeForEchoCompare` is NOT widened to absorb the new verbs' echoes — widening it is the retired one-ref/two-purposes anti-pattern (BUG-166); the byte-exact `lastSeenDiskBodyRef` path stays authoritative. (2) The canvas `data-duo-id`-strip difference still banners on reload (BUG-125-v2 Q2) — that's a real content delta, not an echo. **Reconciliation is shared; the D3 change-highlight is NOT** — markdown ships the on-reload change-highlight, the canvas defers it (tracked as ENH-196). Cross-references: ENH-195 (`tasks.md`; decision playground `docs/research/enh-195-cli-edits-disk-sync.html`), BUG-166 (the one-ref/two-purposes lesson), BUG-125-v2 (the canvas `data-duo-id`-strip banner), BUG-085 (the autosave-clobber the CLI verbs route around), ENH-196 (deferred canvas change-highlight), `.claude/rules/renderer-surfaces.md` (parity disposition for the shared hook).

---

### WCV-occlusion remediation: native NSMenu + system sheets, not WCV-mute

**Status:** 🟢 Locked 2026-05-02 (v0.6.3 walk-1 follow-up; supersedes ENH-050's prior capturePage-overlay direction).
**Raised:** 2026-04-26 — BUG-058 originally surfaced WorkingTabStrip context-menu occlusion when a browser tab was the active working pane; walk-3 reported the WCV-mute fix as "jarring" (the entire browser pane visibly disappears for the menu's lifetime). Walk-1 of v0.6.3 doubled down: BUG-064 reported the same family of issue on the trash-confirm modal (modal clipped at the WCV boundary, dimming inconsistent across the viewport).
**Resolves:** "how do we render renderer-DOM elements ABOVE a `WebContentsView` without flicker, given WCV is a macOS native subview that paints above renderer DOM regardless of z-index?"

**Decision.** Two surfaces, two native primitives, one-to-one with the WCV-occlusion problem class:

1. **Right-click context menus → `Menu.popup()` from the main process.** macOS draws the menu at the window-server level, which composites correctly above the WebContentsView without any mute. Renderer fires an IPC verb (e.g. `menu:popup-tab`) with item template + click coordinates; main builds `Menu.buildFromTemplate([...])` and pops it; click handlers IPC back to the renderer to fire the existing actions. Covers WorkingTabStrip's tab menu, navigator's right-click menu, any future right-click surface.

2. **Destructive confirmation modals → `dialog.showMessageBox` (window-modal sheet).** Sheets drop from below the titlebar, dim the window body uniformly, and composite natively above the WCV. Covers the Trash confirm modal (BUG-064), pinned-close confirm, ⌘W close-unsaved confirm, the first-launch self-install consent, and any future "are you sure?" tier interaction.

**Atelier styling stays for everything else** — canvas-action verbs, comment threads, info popovers, the Send → Duo pill, banners, the working tab strip itself. The dichotomy is "OS-tier surfaces use OS chrome; in-pane surfaces use Atelier chrome." Aligns with macOS HIG conventions: users already expect right-click menus and destructive-action confirms to look like the rest of the OS, not like the app.

**Why this option won.**

- **Eliminates the WCV-mute pattern entirely.** No `setOverlayMuted` calls, no flicker, no race between menu close → modal open → mute lifecycle handoff (the BUG-064 sequence).
- **Native composition is correct by construction.** The WCV's macOS subview compositing rule that makes z-index futile in renderer-DOM is what makes native menus / sheets paint cleanly above. We're using the same OS mechanism that breaks us in the other direction.
- **Free affordances.** Native menus get keyboard-shortcut display, arrow-key navigation, Esc-to-dismiss, dark-mode adaptation, and submenu support without any code. Native dialogs get default-button focus, Enter-to-confirm, Esc-to-cancel, sheet-drop animation.
- **Lower maintenance surface.** The in-renderer `<ContextMenu>`, `<PinnedCloseConfirm>`, and any future destructive-confirm components retire. WCV-occlusion bugs (BUG-006, BUG-045, BUG-047, BUG-058, BUG-064 family) stop multiplying.
- **Mockups validated 2026-05-02** — both surfaces rendered as static HTML (`/tmp/wcv-mute-option-b-mockup.html`, `/tmp/wcv-mute-option-d-mockup.html`) and reviewed by owner; the "Atelier loss" was bounded enough to ship.

**Why not the alternatives.**

- **`capturePage()` snapshot overlay (the prior ENH-050 direction).** Take a PNG of the WCV, render as `<img>` in the menu's slot, mute the WCV behind it. Owner read this as architecturally weird ("we take a picture and then hold it up?"). It's a known pattern (VS Code uses it), but adds ~50ms latency to menu open and conceptually fights the platform: we're working around macOS compositing instead of using it. Also doesn't help with modal-occlusion (would need a separate mechanism for sheets).
- **Position-aware avoidance.** Clamp the menu's bounds to the strip-row area only, never extending into the WCV. Doesn't work for menus with > 2 items (strip is ~28px tall). Hostile to layout.
- **Replace `WebContentsView` with `<webview>` tags.** Renderer-DOM `<webview>` doesn't have the same compositing rules — z-index would just work. But this is a heavyweight rewrite touching every BrowserManager method, the CDP attach plumbing, find-in-page, focus tracking. Loses isolation guarantees that WebContentsView gives the renderer process. Filed as a v1.0+ architectural exploration, not blocking.
- **Custom-styled NSMenu / sheet.** Not really possible — both are OS-rendered and accept label / shortcut / enabled state plus minimal system icons. The "danger button red" you'd want for the Move-to-Trash confirm requires accepting system styling and setting `defaultId` + the destructive action's confirmed state from `response`. Acceptable trade-off for the bounded surface.

**Trade-offs accepted.**

- **Atelier styling lost on these specific surfaces.** Translucent system gray instead of paper-cream, system blue hover instead of accent orange, system font instead of italic serif for danger-confirm titles. Bounded to right-click menus + destructive confirms only.
- **Light/dark mode follows OS, not Duo's theme toggle.** A user with macOS in light mode and Duo themed dark would see a light menu / sheet. Existing inconsistency we're accepting; mitigations would require a custom-rendered menu primitive (which puts us back at the WCV-occlusion problem).
- **Custom decorations on menu items aren't possible.** Can't bold the active tab's row, can't put colored dots before destructive items, can't style separators with paper-rule color. NSMenu items are label + accelerator + enabled state. If we ever need rich item rendering, we revisit.
- **Custom keybinding display strings constrained.** Electron's accelerator format renders via macOS's standard glyphs (`⌘⌥←` etc.). Our keyboard-shortcuts hint surfaces (FAQ, what-duo-does, and any future cheat-sheet) need to match Electron's strings to stay aligned with what the menu shows.

**Implementation order.**

1. **Renderer-side IPC plumbing** — add `menu:popup-tab` (working-pane) and `menu:popup-tree-row` (navigator) verbs; preload exposes a single `window.electron.menu.popup({ x, y, items })` returning the chosen `id`.
2. **Migrate WorkingTabStrip's right-click first** — single highest-frequency case, BUG-058 trigger. Validate the IPC pattern + click-to-action flow.
3. **Migrate the trash + pinned-close + ⌘W-unsaved confirms to `dialog.showMessageBox`** — three calls, mostly mechanical.
4. **Migrate the navigator's right-click menu** — same `menu.popup()` plumbing, different item list.
5. **Retire `<ContextMenu>` and `<PinnedCloseConfirm>`** — components delete, BUG-058's `setOverlayMuted` mute pattern reverts in `WorkingTabStrip.tsx § handleContextMenu`. The `BrowserManager.setOverlayMuted` API stays (BUG-006's pill suppression still uses it) but no longer fires for menus / modals.

Cross-references: BUG-058 (parent menu-occlusion bug, originally fixed via WCV-mute — now re-fixed via this decision), BUG-064 (modal-occlusion sibling — fixed by item 3 of the implementation order), ENH-050 (originally filed as snapshot-overlay direction; this decision supersedes), `core/socket-server.ts` (where the IPC verbs are wired), `electron/main.ts` § `dialog.showMessageBox` (the API), `electron/menu.ts` (new file — menu builder).

---

### Pack canvas / pinned tab idempotency contract

**Status:** 🟢 Locked 2026-05-10 (Sprint 15 ENH-138 upgrade-path fix; ships in v0.6.13).
**Raised:** 2026-05-10 — during Sprint 15 smoke walk close-out. Owner asked: *"any stale installs will not get the new WDD — should we change the name of the WDD file in the pack version, such that stale duos on update will see that the new one was never opened, and open it?"* Surfaced a real upgrade-path gap.
**Resolves:** how two independent first-launch mechanisms (pin-restore at `main.ts § BUG-057` vs. pack-defaults hook at `main.ts § Stage 18b first-launch defaults`) compose when both target the same canvas — without double-opening on fresh install OR missing new content on upgrade.

**Decision.** The pack first-launch hook checks `pins.json` before firing `NAV_EDIT` for each pack default. If the canvas's `file://` URL is already in pins.json (as `kind: 'browser'`), the pin-restore mechanism (BUG-057) owns the open — skip. Otherwise, fire NAV_EDIT.

**Cooperation across the two mechanisms:**

| Boot scenario | pins.json state | Pin-restore behavior | First-launch hook behavior | Net result |
|---|---|---|---|---|
| **Fresh install** | Created by op #8 with pack canvas URL pre-pinned | Opens pack canvas (pinned) | Sees URL in pins.json → skips NAV_EDIT | 1 WDD tab, pinned ✓ |
| **v0.6.12 → v0.6.13 upgrade** | Inherited from v0.6.12 with old `~/.claude/duo/help/...` URL (file still on disk; op #8 doesn't reseed) | Opens stale-content URL (or session restore handles it) | Pack URL NOT in pins.json → fires NAV_EDIT | 2 WDD tabs (stale pinned + fresh new) ✓ |
| **2nd boot after fresh install** | pack URL pinned | Opens pack canvas (pinned) | `installed-packs.json` has the per-pack-version flag → whole pack skipped | 1 WDD tab, pinned ✓ |
| **Pack-version bump (`duo-default@1.0.0` → `1.1.0`)** | Pack URL pinned | Opens pack canvas (pinned) | New pack version → flag re-fires → URL in pins.json → skips NAV_EDIT | 1 WDD tab (already pinned) ✓ |
| **Pack-version bump + user closed the pin** | Pin previously toggled off; URL not in pins.json | Nothing to restore | URL not in pins.json → fires NAV_EDIT for the new pack version | Fresh content opens as new tab (unpinned). User can re-pin via UI. ✓ |

**Why this option won.**

- **No file renaming required per version.** The owner's first proposal was to rename WDD per pack version so stale Duos would discover "an unopened file" on upgrade. That works but encodes versioning in filenames, which gets ugly fast (`what-duo-does-v3.html`, `what-duo-does-v4.html`...). The idempotency check + `installed-packs.json` per-pack-version flag give the same semantic with one-line install-tracker state.
- **Two-way cooperation, not winner-takes-all.** Pin-restore handles the pinned cases (fresh + already-pinned); pack-defaults handles the unpinned/new-pack-version cases. Each mechanism's failure mode is independent — pins.json corruption doesn't break pack-defaults; missing `installed-packs.json` doesn't break pin-restore.
- **Existing-user upgrade path works without state migration.** v0.6.12 users keep their pins.json as-is (no install-service migration). Their stale-content WDD pin still resolves (the old `~/.claude/duo/help/...` file isn't deleted on upgrade by `safeOverwriteDirContents`). The first-launch hook fires the NEW canvas alongside. User chooses what to keep.
- **Forward-looking: ENH-137 Beginner's Guide drops in trivially.** Adding `canvases/beginners-guide.html` + bumping `duo-default@1.0.0 → 1.1.0` re-fires for everyone. Existing users see the new content as a fresh tab on next launch.

**Why not the alternatives.**

- **Rename file per version (owner's first proposal).** Encodes versioning in filenames; doesn't compose with the existing `installed-packs.json` per-pack-version flag (which was built precisely for this); breaks deep-links if anything references the filename directly (README.md, future docs).
- **Install-service migrates pins.json URLs on upgrade.** Detect v0.6.12-shaped URLs in pins.json + rewrite to pack location. Works but invasive — modifies user state without explicit consent, and the heuristic ("URL starts with `~/.claude/duo/help/`") is fragile. The current decision is non-invasive: user's pins.json is never touched, just the pack-defaults hook fires alongside.
- **Delete old `help/what-duo-does.html` on upgrade.** Forces the issue (stale pin 404s; user has to re-pin). Worse UX than letting the stale pin coexist with the new tab.
- **Set `openOnFirstLaunch: false` and rely on pin-restore only.** What Sprint 15's first iteration did. Avoids the double-open on fresh install, but misses content delivery on upgrade entirely (the gap the owner raised). The idempotency check is what lets `openOnFirstLaunch: true` be safe.

**Trade-offs accepted.**

- **Upgrade users see TWO WDD tabs on first launch.** One pinned (stale v0.6.12 content), one fresh (new pack location). They have to manually close the stale one + optionally re-pin the new one. The friction is bounded — one-time, per-major-content-update.
- **The new tab opens UNPINNED for upgrade users.** First-launch hook only does NAV_EDIT, not pin. So the new WDD is a regular tab; if the user doesn't pin it, next session restore might not bring it back (depending on whether it's in their persisted session). Pinning-on-first-launch would require modifying pins.json (invasive — explicitly rejected above). Future enhancement: wire the pack's `pin: true` to seed pins.json IF the URL is not already pinned. Filed in active-sprint.md § "Sprint 15 carry-over" as a follow-up.
- **Two-mechanism cognitive load.** Pack authors writing manifests need to understand that `openOnFirstLaunch: true` + the user's pin state interact. The PACK.json `pin: true` field is still informational-only today (no install-service hook reads it to seed pins.json automatically); the explicit op #8 in install-service is the seeding path. The two pathways need a brief intro paragraph in `skill/pack-builder/SKILL.md` (filed in `docs/dev/active-sprint.md § "Sprint 15 carry-over"` as a follow-up doc edit).

**Implementation.**

1. **`electron/main.ts § Stage 18b first-launch defaults`** — read `pins.json` via `pinsService.list()` before the iteration; compute the `file://` URL for each pack default; skip if URL is in the pin set. Inline comment cross-references this ADR section.
2. **`packs/duo-default/PACK.json`** — set `openOnFirstLaunch: true` for the WDD default (the idempotency check makes this safe; without it, fresh installs would double-open).
3. **No changes to `pins.json` schema or `pinsService` API.** The contract is one-way: hook reads pins, never writes.
4. **No changes to `installed-packs.json` schema.** The per-pack-version flag continues to gate "fire once per pack version per user."

Cross-references: ENH-138 (Sprint 15 — established the FTUX-content / pack boundary that produced this idempotency need), BUG-057 (pin-restore mechanism the hook cooperates with), `core/pins-service.ts` (pin storage), `core/installed-packs-service.ts` (per-pack-version flag), `electron/install-service.ts § op #8` (the pins.json seed that makes fresh-install idempotency necessary).

---

### Boot-time self-healing CLI shim — SHIM_DIR/duo as the sole canonical CLI location

**Status:** 🟢 Locked 2026-05-16 (ENH-156; ships in v0.6.16).
**Raised:** 2026-05-16 — Sprint 17 in-flight. An enterprise user on v0.6.15 reported `duo: command not found` from inside a Claude Code sandbox. Diagnostic surfaced four overlapping install vestiges on their machine: `~/.claude/duo/bin/` contained only the `claude` shim (no `duo` entry); `~/.local/bin/duo` was a stale symlink into a versioned dev-checkout path from April; `~/.zshrc` had an obsolete `# Duo CLI` fence (different marker than the current `# >>> duo PATH >>>` style) pointing at `Documents/duo-main-0_6_13/cli`; the FirstLaunchBanner had shown a *"Couldn't update your shell config"* error on a recent upgrade. The diagnosing Claude session compounded the problem by misreading `command not found` as a sandbox block and escalating to a subagent — the exact hallucination pattern ENH-141 was supposed to close.

**Resolves:** the architectural fragility that lets a working install rot across versions without surfacing — and that leaves the most load-bearing piece of the install (the SHIM_DIR/duo symlink) silently failing on `console.warn` while the user-facing banner advertises success.

**Decision.** SHIM_DIR/duo (`~/.claude/duo/bin/duo`) becomes the sole canonical, **boot-time-self-healing** location for the `duo` CLI:

1. **Single canonical location.** SHIM_DIR/duo is what `PtyManager` prepends to every PTY's `$PATH` (already, since ENH-141) AND what the skill/agent docs name as the universal recovery path for `command not found`. The Stage-20-era `~/.claude/bin/duo` target is fully retired from docs (was already retired from install).
2. **Boot-time self-heal.** Every `app.whenReady()` calls `installService.ensureCliShim()` — checks SHIM_DIR/duo's state, recreates if missing/stale, no-ops if current. Independent of FirstLaunchBanner: upgrades that don't re-fire the install routine still get a working `duo`. Cost: one `lstat` per boot in the no-op case.
3. **Symlink directly into the in-app CLI binary.** SHIM_DIR/duo → `<app.getAppPath()>/cli/duo` (dev) or `<resourcesPath>/cli/duo` (prod). NOT into `~/.local/bin/duo`. Two benefits: (a) auto-updates work because the in-app path moves with the app on every Squirrel update; (b) the failure mode "user deletes Duo.app" produces a correctly-broken symlink that `duo doctor` can name, rather than a stale symlink into a vanished dev checkout (this user's exact April-stale-link pattern).
4. **Loud-on-failure logging.** Failed shim creation appends to `~/.claude/duo/logs/install-shim.log` with timestamp + error (in addition to the existing `console.warn`). Persistent, user-readable, agent-readable. Closes the silent-fail surface that hid this user's situation across three Duo versions.
5. **Existing `~/.local/bin/duo` copy stays** — for external-terminal users who want bare-name `duo` outside Duo PTYs. Best-effort, secondary, not load-bearing. Failure here is a UX inconvenience (user uses `~/.claude/duo/bin/duo` explicitly), not a broken install.
6. **`addToShellPath` is deprioritized but not removed.** Same rationale — for external-terminal users only; failure surfaces a banner with the manual fallback, but bare `duo` inside Duo PTYs is unaffected by whether the shell-rc dance succeeds.

**Why this option won.**

- **Sandbox-tolerant by construction.** SHIM_DIR lives inside `~/.claude/`, which Claude Code's Seatbelt sandbox includes in its writable namespace. The shim creation succeeds even from a sandboxed Bash subshell (though boot-time self-heal runs in the unsandboxed Electron main process, this property matters for `duo install` re-runs from inside Claude Code).
- **Self-healing replaces "install ran once correctly forever."** The old model assumed FirstLaunchBanner's `install.run()` would fire successfully on first launch and the result would persist. Reality: users upgrade across Duo versions that bump install logic (ENH-141 reshaped the targets; old fence markers become unrecognizable; old symlinks point into renamed dev checkouts). Boot-time self-heal makes the invariant — *SHIM_DIR/duo points at the current Duo.app's CLI* — true on every launch, regardless of upgrade path or prior install state.
- **No new shell-rc edits.** The whole `addToShellPath` failure surface (different shell rc files, missing parent dirs, .zshrc owned by root, etc.) is bypassed for the load-bearing path. Inside Duo PTYs, `PtyManager` already prepends SHIM_DIR — no shell-rc cooperation required.
- **Symlink-to-in-app survives app updates.** The previous symlink target was `~/.local/bin/duo`, which is itself a copy of the binary. Auto-update would replace `Duo.app/Contents/Resources/cli/duo` but NOT `~/.local/bin/duo` until the install routine re-ran. Direct symlink into the app resources means the CLI is the current version on next launch automatically.

**Why not the alternatives.**

- **Bundle a `postinstall` script that runs on every app update (no boot-time check).** Squirrel auto-update on macOS doesn't reliably run postinstall hooks across all update mechanisms (DMG drop-in, Squirrel-delta, in-place rebuild). Boot-time check covers every update path uniformly.
- **Add a UI-surfaced "Reinstall" button.** Adds a click. The user shouldn't have to think about it.
- **Strip `~/.local/bin/duo` entirely (single-target install).** Would break external-terminal users (Terminal.app, iTerm outside Duo) who rely on bare `duo`. Keeping it as secondary is cheap and preserves that affordance.
- **Persistent banner on shim-creation failure.** Considered for v1; deferred. The current `console.warn` + log file gives operators / agents enough to diagnose; a persistent banner introduces dismiss-state complexity. Revisit if reports surface where users miss the log file.

**Trade-offs accepted.**

- **One `lstat` per app boot.** Negligible (< 1 ms on warm cache, runs after `createWindow()`).
- **Symlink target is an absolute path inside `Duo.app`** — if the user runs Duo from a non-`/Applications` path (e.g. `~/Downloads/Duo.app`), the shim will reflect that. Acceptable: the shim is recreated every boot from `app.getAppPath()`, so moving Duo.app → relaunching → new shim points at the new location.
- **Old stale install artifacts (e.g. this user's `~/.local/bin/duo` April symlink, obsolete `~/.zshrc` fences) are NOT auto-cleaned.** Migration-and-strip was scoped out for v1 to keep the change blast radius minimal. Documented as a follow-up (FOLLOWUP-021): an opt-in `duo install --clean` that strips fences with known-old markers + retires `~/.claude/bin/duo` (the dead Stage-20 path).
- **The skill/agent docs' recovery-path advice points at one location now** (`~/.claude/duo/bin/duo`). Previously they listed three (`~/.claude/bin/duo`, `~/.local/bin/duo`, `/usr/local/bin/duo`) and asked the agent to pick the one that resolves. The new advice is shorter and harder to misroute, at the cost of being less of a "find any of these" recovery path — but the new path is **guaranteed** to exist post-boot-self-heal, so the recovery doesn't need fan-out.

**Implementation.**

1. **`electron/install-service.ts`** — new `ensureCliShim()` method + `planCliShim()` pure helper + `readShimState()` helper. Refactors the silent `console.warn`-only symlink block out of `installCli` so the boot path and the FirstLaunchBanner-triggered path go through the same logic. Persistent log at `~/.claude/duo/logs/install-shim.log`.
2. **`electron/main.ts`** — call `installService.ensureCliShim()` from `app.whenReady()`, after `createWindow()`. Fire-and-forget with logging.
3. **`skill/SKILL.md` + `agents/duo.md`** — collapse the three-target recovery list down to `~/.claude/duo/bin/duo` (with a note that this is auto-created on every Duo launch).
4. **`electron/install-service.test.ts`** — unit tests for `planCliShim` covering the four state transitions (missing → create, current symlink → no-op, stale symlink → replace, non-symlink file → refuse).

Cross-references: ENH-141 (the predecessor; established SHIM_DIR-on-PATH but left the symlink creation silent + first-launch-gated), `core/pty-manager.ts:42` (the `SHIM_DIR:$PATH` prepend that makes this design work), open ADR *Sandbox-tolerant transport and install paths for the `duo` CLI* item 3 (this decision closes that item's "ENH-141 next-step" thread).

---

## Open ADRs (pending decision)

### Sandbox-tolerant transport and install paths for the `duo` CLI

**Status:** 🟢 Partially decided & shipped 2026-04-27 — items 1–3
landed in Stage 20 (TCP fallback + `duo doctor` + sandbox-safe
install path). Item 4 (recommended Claude Code settings fragment)
is documented in `skill/references/sandbox-troubleshooting.md`.
Item 5 (last-resort `dangerouslyDisableSandbox` escape hatch)
remains documentation-only.
**Raised:** 2026-04-23
**Needed before:** Stage 18 (first-launch self-install) for the
install-path + settings fragment work; Stage 21 (distribution polish)
for any cert-gated pieces. Skill-docs portion is cheap and can land
before the flagship pair; transport + install changes land with the
 Stage 18 / Stage 21 sequence (split 2026-04-26 — see the roadmap).

**Problem statement.** Claude Code runs each Bash tool invocation inside
a macOS Seatbelt-based sandbox. Enterprise deployments (e.g. Acme) have this enabled by default. The sandbox:

- **Blocks filesystem writes outside the current working directory.**
  Reads outside cwd are generally allowed.
- **Gates Unix-domain-socket outbound connections behind explicit
  `allowUnixSockets: true`.** The default disallows them; the Claude
  Code docs warn that `allowUnixSockets` "can inadvertently grant
  access to powerful system services" (e.g. the Docker socket), so
  enterprise admins tend to leave it off.
- **Permits localhost TCP by default.** The network filter is
  domain/proxy-based, not a blanket loopback block. `127.0.0.1` and
  `::1` are reachable.
- **Is inherited by all child processes** spawned from a sandboxed
  Bash call. Detaching / unref'ing doesn't escape it.

Duo's entire agent-side bridge runs on a single Unix domain socket at
`~/Library/Application Support/duo/duo.sock`. Every `duo` CLI command
opens a fresh `net.createConnection(SOCKET_PATH)`. In a sandboxed
Claude Code session this means **every** `duo` call fails — and it
fails silently enough that Claude sees one failed Bash call, keeps
following the skill's instructions, and the user is left debugging
without any signal pointing at the sandbox as the culprit.

This is the same shape of problem that hit `pasky/chrome-cdp-skill`:
page-level CDP operations broke under Claude Code's sandbox while
list/window operations (which happen to be plain HTTP GETs against
`localhost:9222/json/list`) still worked. The
`dudgeon/chrome-cdp-skill` fork's fix is a per-tab detached daemon
listening on `127.0.0.1:<random-port>` with an NDJSON + auth-token
protocol — localhost TCP passes the sandbox's network filter. See
that repo's `skills/chrome-cdp/scripts/cdp.mjs` lines 555–679 for the
reference implementation (TCP listener, token file, CLI reconnect).

**Impact inventory** (2026-04-23 audit of current tree):

| Operation | File:line | Sandbox verdict |
|---|---|---|
| Every `duo` command (navigate, url, title, dom, text, ax, click, fill, focus, type, key, eval, screenshot, console, tabs, tab, close, wait, open) | `cli/duo.ts:29` — `net.createConnection(SOCKET_PATH)` | ❌ **All fail** — Unix socket blocked without explicit opt-in |
| `fs.existsSync(SOCKET_PATH)` pre-connect check | `cli/duo.ts:24` | ✅ Reads outside cwd allowed |
| `duo install` symlink creation | `cli/duo.ts:266–272` — `/usr/local/bin/duo`, falls back to `~/.local/bin/duo` | ❌ Both paths write outside cwd |
| `duo screenshot --out <path>` | `cli/duo.ts:195` | ⚠️ Only if `<path>` resolves outside cwd |
| `duo open <relative/path>` resolution | `cli/duo.ts:237–257` | ✅ Pure reads; only the socket hop matters |
| First-launch installer → `~/.claude/skills/duo/` | `scripts/postinstall.ts` | ✅ `~/.claude/` is writable per docs |
| Skill discovery scanning `~/.claude/skills/` | `electron/skills-scanner.ts` | ✅ Runs in unsandboxed Electron main process |

The Electron side (socket creation, chmod, bind, listen in
`electron/socket-server.ts`) is unaffected: the user's Electron app
runs outside the Claude Code sandbox. The failure surface is entirely
on the CLI side — what `claude` shells out to from inside a Duo
terminal.

A note on the existing "Decisions made during build → Socket path:
`~/Library/Application Support/duo/` not `/tmp`" entry above: that
choice is still correct (persistence across reboots, macOS convention)
but the "sandbox-safe" framing overstated the case. The path is
*read-reachable* from inside the Claude Code sandbox, but the **Unix
socket connection itself is not** on default policy. This ADR
clarifies and supersedes that framing.

**Proposed direction.** (Items 1–3 ✅ shipped 2026-04-27 in Stage 20.)

1. **TCP fallback alongside the Unix socket.** ✅ shipped. In
   `electron/socket-server.ts`, additionally
   `server.listen(0, '127.0.0.1')` (ephemeral port; Electron owns
   both listeners). Write the chosen port and a per-install auth
   token to `~/Library/Application Support/duo/duo.port` — a small
   JSON file the sandboxed CLI can *read* (reads outside cwd are
   allowed). In `cli/duo.ts`, try the Unix socket first; on `EPERM`
   / `ECONNREFUSED` / connect timeout, read the port file and
   reconnect over TCP, sending the token as the first NDJSON line
   of the handshake. Keeps the fast path, heals sandboxed runs
   transparently. ~100 LoC change; mirrors the chrome-cdp-skill
   pattern.

2. **`duo doctor` diagnostic.** ✅ shipped. A new CLI verb that reports, in
   order: Electron app reachable via Unix socket? via TCP
   fallback? install path writable? `~/.claude/skills/duo/` present
   and current? `duo --version` vs. Electron app version? Prints a
   clear "Claude Code sandbox detected (Unix socket blocked) —
   falling back to TCP" line when the fallback kicks in. The skill
   instructs the agent to run `duo doctor` on the first failed
   command so the sandbox failure mode is named, not inferred.

3. **Sandbox-safe install path.** ✅ shipped Stage 20; **revised
   ENH-141 (2026-05-10)** after an enterprise user report found the
   original tier-1 target was dead. The Stage-20 default
   `~/.claude/bin/duo` was sandbox-writable but **never on $PATH**
   for Duo PTYs or external shells, so the symlink existed and
   `duo` was still "command not found" inside the Claude Code
   sandbox. ENH-141 changes the default tier-1 target to
   `~/.claude/duo/bin/duo` (SHIM_DIR), which `core/pty-manager.ts`
   prepends to PATH at every PTY spawn — the binary is therefore
   immediately reachable by name inside any Duo terminal without
   any shell-rc edit. Tier-2 (`~/.local/bin/duo`) and tier-3
   (`/usr/local/bin/duo`) are unchanged. The Electron-side
   FirstLaunchBanner [Install] action ALSO now drops the SHIM_DIR
   symlink during the install, alongside its primary `~/.local/bin/`
   copy. PATH-hint copy from `duo install` was updated to clarify
   that the SHIM_DIR target is auto-on-PATH inside Duo PTYs and the
   shell-rc append is only needed for external Terminal/iTerm use.

4. **Ship a recommended Claude Code settings fragment.** In
   `skill/SKILL.md`, add a "Troubleshooting → Claude Code sandbox"
   section with a copy-pasteable `.claude/settings.json` allowlist
   (socket path read-allowed + `allowUnixSockets: true`) for teams
   who prefer the Unix-socket fast path. The CLI's TCP fallback
   means nobody *needs* this, but it documents the minimum
   allowlist for sandbox-conscious reviewers.

5. **Last-resort escape hatch.** `dangerouslyDisableSandbox` is
   surfaced as a Bash tool parameter in some Claude Code builds but
   disabled outright in managed enterprise settings
   (`allowUnsandboxedCommands: false`). We mention it in the skill's
   troubleshooting section as a manual option, do not rely on it.

**Rejected alternatives.**

- **File-based IPC (request/response files in cwd).** Would work
  under the sandbox's cwd-scoped writes, but the Electron app does
  not know which PTY CWDs to watch, and each Duo tab has an
  independent launch CWD. Adds state explosion for no win over TCP.
- **Named pipes / FIFOs.** Same sandbox class as Unix sockets; no
  advantage.
- **Daemon-per-tab like chrome-cdp-skill.** Duo already owns one
  long-lived Electron process; per-tab daemons solve a problem
  (Chrome "Allow debugging" modal) that doesn't exist here.
- **Ship the CLI as a native-compiled binary with a different
  sandbox surface.** Doesn't change Seatbelt's behavior — the
  sandbox wraps the process, not the binary.

**Cross-references into the roadmap:**
- **Stage 5 (skill + subagent authoring, ✅ shipped)** picks up a
  new doc item: "Troubleshooting → Claude Code sandbox" section in
  `skill/SKILL.md` + `agents/duo-browser.md`. Cheap, can land
  immediately.
- **Stage 20 (interaction polish, ⬜)** picks up the TCP fallback
  and `duo doctor` work items.
- **Stage 18 (first-launch self-install, ⬜)** picks up the
  install-path cleanup and the bundled settings fragment. Split
  out of the old combined Stage 14 on 2026-04-26 because both items
  are cert-independent.
- **Stage 21 (distribution polish, ⬜)** picks up the cert-gated
  pieces (code sign, notarize, electron-updater) downstream of Stage 18.

**Decision owner:** Geoff.
