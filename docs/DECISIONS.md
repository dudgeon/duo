# Duo — Architecture Decisions

> All decisions in §6 of the brief are LOCKED. This document adds rationale,
> implementation notes, and records any decisions made during build.
>
> **Where this fits:** stage-level sequencing lives in
> [ROADMAP.md](../ROADMAP.md). This file is the *architectural-decision*
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

---

## Open ADRs (pending decision)

### Sandbox-tolerant transport and install paths for the `duo` CLI

**Status:** 🟡 Open / Proposed
**Raised:** 2026-04-23
**Needed before:** Stage 18 (first-launch self-install) for the
install-path + settings fragment work; Stage 21 (distribution polish)
for any cert-gated pieces. Skill-docs portion is cheap and can land
before the flagship pair; transport + install changes land with the
 Stage 18 / Stage 21 sequence (split 2026-04-26 — see ROADMAP.md).

**Problem statement.** Claude Code runs each Bash tool invocation inside
a macOS Seatbelt-based sandbox. Enterprise deployments (e.g. Capital
One) have this enabled by default. The sandbox:

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

**Proposed direction.**

1. **TCP fallback alongside the Unix socket.** In
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

2. **`duo doctor` diagnostic.** A new CLI verb that reports, in
   order: Electron app reachable via Unix socket? via TCP
   fallback? install path writable? `~/.claude/skills/duo/` present
   and current? `duo --version` vs. Electron app version? Prints a
   clear "Claude Code sandbox detected (Unix socket blocked) —
   falling back to TCP" line when the fallback kicks in. The skill
   instructs the agent to run `duo doctor` on the first failed
   command so the sandbox failure mode is named, not inferred.

3. **Sandbox-safe install path.** Change `duo install` to prefer
   `~/.claude/bin/duo` (the `~/.claude/` tree is writable under
   Claude Code's sandbox), fall back to `~/.local/bin/duo`, and
   only touch `/usr/local/bin/duo` on explicit opt-in. Emit a
   one-line `export PATH=…` fragment for the user's rc after a
   successful install.

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
