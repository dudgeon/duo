// ── Tab / terminal session ───────────────────────────────────────────────────

// Stage 19c — `kind` distinguishes a vanilla shell from a tab that
// auto-launches `claude` after the shell starts. See PRD D17, D21, D26.
// 'shell' is today's behavior; 'claude' types `claude\n` into the PTY
// after spawn (or prints a fallback banner if `claude` is not on PATH).
export type TerminalTabKind = 'shell' | 'claude'

export interface TabSession {
  id: string
  title: string
  cwd: string
  kind: TerminalTabKind
  /** ENH-177 — populated when the tab was restored from a workspace
   *  whose serialized terminal entry had a `lastClaudeSession`. The
   *  renderer's TerminalPane surfaces a non-modal "Resume" banner
   *  while claudePresence is NOT 'claude' and this field is set; the
   *  banner writes `claude --resume <id>` into the PTY on click. */
  lastClaudeSession?: { id: string; capturedAt: number } | null
}

// ── Duo socket protocol ──────────────────────────────────────────────────────

export interface DuoRequest {
  id: string
  cmd: DuoCommandName
  args: Record<string, unknown>
}

export interface DuoResponse {
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export type DuoCommandName =
  | 'navigate'
  | 'open'
  // Stage 20 — `duo reload` reloads the active browser tab in place.
  // Pair for `navigate` that doesn't require a URL.
  | 'reload'
  | 'url'
  | 'title'
  | 'dom'
  | 'text'
  | 'ax'
  | 'click'
  | 'fill'
  | 'focus'
  | 'type'
  | 'key'
  | 'eval'
  | 'screenshot'
  | 'console'
  // Browser observability — Runtime.exceptionThrown + Network.* ring buffers
  | 'errors'
  | 'network'
  | 'tabs'
  | 'tab'
  | 'close'
  | 'wait'
  // Stage 10 Phase 6 — navigator + file-surface commands
  | 'view'
  | 'reveal'
  | 'ls'
  | 'nav-state'
  // Stage 11 Phase A — markdown editor
  | 'edit'
  | 'selection'
  | 'doc-write'
  | 'doc-read'
  // ENH-022 / ENH-023 (v0.5.4) — agent-driven editor navigation +
  // read-only buffer search.
  | 'doc-goto'
  | 'doc-find'
  // Stage 11 § D33d — theme
  | 'theme'
  // Sprint 16 / v0.6.15 — Claude-tab Enter key preferences. Both
  // accept optional `mode` to set, no arg to read. See
  // ClaudeKeyPrefsSnapshot for semantics.
  | 'claude-return'
  | 'shift-return'
  // Stage 5 v2 (Duo subagent) A24 — open a URL in the system default
  // browser via Electron's shell.openExternal. Used by the agent's web-
  // routing rule for hostnames in ~/.claude/duo/external-domains.json.
  | 'external'
  // Stage 15 G19 — runtime-configurable Send → Duo payload format.
  // 'a' = quote + provenance (default), 'b' = literal text only,
  // 'c' = opaque token. Persisted in renderer localStorage.
  | 'selection-format'
  // Stage 15 G17 — write a payload into the active terminal's PTY (no
  // Enter appended). The button's logical inverse: lets agents plant
  // context in the user's terminal (e.g. "you might want to ask me
  // about this"). Renderer caches the active terminal id; main does
  // the ptyManager.write.
  | 'send'
  // Stage 17a (HTML canvas) — `duo html new <path>` creates a fresh
  // .html file from boilerplate (PRD H17, minimal v1) and opens it in
  // the canvas tab. Other `duo html *` verbs land in 17b/17c.
  | 'html-new'
  // Stage 21d-iii — distro pack management.
  | 'pack-list'
  | 'pack-uninstall'
  // ENH-151 / ENH-152a — GitHub integration. `git-status` powers the
  // Navigator root chip; `clone` wraps `gh repo clone` / `git clone`;
  // `gh-auth` probes `gh auth status` so the renderer Clone modal can
  // pre-flight the auth UX.
  | 'git-status'
  | 'clone'
  | 'gh-auth'
  // FOLLOWUP-020 — `duo close-tab` closes the focused working-pane
  // tab; `duo close-terminal-tab [<n>]` closes the focused terminal
  // tab (or the Nth terminal tab when an index is supplied). Closes
  // the CLI parity gap surfaced during ENH-143 discoverability work.
  | 'close-tab'
  | 'close-terminal-tab'
  // Stage 17b Phase C — agent read/write verbs against the active
  // canvas: `duo html query/get/set/replace/append/remove/attr`. All
  // routed through a single `html-op` socket command with a
  // discriminated request shape (HtmlOpRequest below). Renderer
  // dispatches via htmlOps.ts and replies; main.ts manages the
  // request/reply pairing the same way as `EDITOR_DOC_WRITE`.
  | 'html-op'
  // Stage 17d — `duo html comment` writes a sidecar comment anchored
  // to a `data-duo-id` (resolved from --id / --selector / --text);
  // `duo html comments` reads the thread list. Mutates the sidecar
  // JSON, not the .html. Renderer is the only authoritative source.
  | 'html-comment'
  | 'html-comments'
  // Stage 19c D27 — open a new terminal tab from the agent.
  // `--shell` = vanilla shell; `--claude` = auto-launches claude.
  // No flag = persisted last-kind (D28; defaults to 'claude').
  // Optional --cwd / --cmd; returns {id, kind, cwd, title}.
  | 'new-tab'
  // Stage 20 — `duo doctor` and the bare-bones liveness probe used
  // inside it. Both return the running app's version so the CLI can
  // surface a mismatch when the user has stale binary symlinks
  // pointing at an older app bundle. See docs/DECISIONS.md → Open
  // ADRs → *Sandbox-tolerant transport and install paths*.
  | 'ping'
  // Stage 26 item 6 — `duo file rename <old> <new>` and
  // `duo file trash <path>` mirror the navigator's right-click
  // Delete / Rename actions. Single 'file' command with a
  // discriminated `op` arg keeps the verb table small.
  | 'file'
  // Stage 26 PR 2 (ENH-010) — `duo nav pin <path>`,
  // `duo nav unpin <path>`, `duo nav pins [--json]` mirror the
  // navigator's right-click Pin / Unpin actions. Same single-verb
  // discriminated-op shape as 'file'.
  | 'nav-pin'
  // ENH-108 (Sprint 12) — `duo image insert <path>` inserts an
  // image into the active markdown editor. Reads source bytes,
  // calls `files.saveImageBeside` to copy alongside the active doc
  // with a generated filename, then inserts at caret. v1 supports
  // markdown editor target only; canvas (PageTab) parity in a
  // follow-up. Optional `--alt` to set alt text.
  | 'image-insert'
  // ENH-014 (v0.5.2 sprint) — set split-pane percentage. Mirrors
  // the View → Pane size menu and ⌘⌥1/2/3 keyboard accelerators.
  // Clamps to the 20–80 range the divider drag uses.
  | 'split'
  // ENH-099 — `duo split 3way` / `⌘⌥4` chord. Snaps to outer 33/67 +
  // inner aux 50/50 (when aux is open). On-demand sibling of ENH-126.
  | 'layout-3way-even'
  // ENH-123 — `duo devtools [--browser-pane] [--close]` opens the
  // renderer's DevTools (default) or the active browser pane's DevTools.
  // Backstop for the 5% of cases where ENH-122's targeted `duo dom`
  // query isn't enough and you need the full Elements / Network /
  // Console UI. Sister verb to `duo dom` and `duo layout`.
  | 'devtools'
  // ENH-124 — `duo layout` returns a JSON snapshot of the working pane
  // state (active tab kind/path, split state, focused subpane,
  // terminal/navigator collapsed?). Pairs with `duo nav-state` (file
  // tree) and `duo dom` (renderer DOM) to give agents three independent
  // visibility verbs. Removes ambiguity about WHAT the user is looking at.
  | 'layout'
  // ENH-041 / Sprint 3 — Split View (one-aux companion pane in the
  // canvas). User-facing label is "Split View"; CLI verb is
  // `duo split-view open <path>` / `duo split-view close` /
  // `duo split-view` (state). Sub-verb in args.op. See
  // docs/prd/canvas-split-view-research.html for the locked spec.
  | 'split-view'
  // Stage 27 — `duo events [--follow] [--since <cursor>] [--limit N]`
  // streams structured events emitted via the canvas-action `duo:event`
  // verb (and any future renderer / main subsystem that calls
  // EventBus.emit). Snapshot mode prints the requested ring slice as
  // JSON lines and exits; --follow keeps the socket open and pushes
  // each fresh event as a JSON line until interrupted. Subscribers
  // resume across reconnects via --since <cursor>. Pulls in issue #19.
  | 'events'
  // Stage 18b — `duo packs` lists every distro pack discovered at
  // `~/.claude/duo/packs/<name>/PACK.json`. Returns the loaded
  // registry as JSON; errors per pack surface in the response so an
  // agent can diagnose a malformed manifest without crawling the
  // filesystem.
  | 'packs'
  // ENH-098 (Sprint 9) — `duo focus-pane <terminal|main|aux>` mirrors
  // the ⌘⌥L/;/' chord set. Distinct from the existing 'focus' verb
  // (which calls CDP focus on a CSS selector inside the active
  // browser pane). The pane-jump verb routes through the bridge's
  // focusPane() back to the renderer via PANE_FOCUS_JUMP IPC.
  | 'focus-pane'
  // ENH-159b — `duo inspect [--off]` toggles browser-pane element
  // inspect mode: hover renders an outline, click captures the
  // element's snapshot (tag + selector_path + heading trail +
  // innerText + key attrs) and sends it to the active terminal so
  // Claude can act on the element without text selection. Mirrors
  // Chrome devtools' Inspect Element (⌘⇧C) but routes the result to
  // the agent loop instead of devtools UI. While active, the
  // selection observer's Send → Duo pill is suppressed (mode lock).
  | 'inspect'
  // BUG-138 Phase 2 — `duo author [<name>]` reads or sets the human
  // author identity used when stamping CriticMarkup marks. Renderer
  // owns localStorage('duo:author'); main caches for CLI reads. No
  // arg → JSON `{ author: string }`. Empty / missing name on first
  // read defaults to `$USER` env var so untouched setups still get
  // attribution. CLI agent invocations set their own author via the
  // `DUO_AUTHOR` env var, not this verb.
  | 'author'
  // BUG-138 Phase 3 — agent CriticMarkup verbs. Single command with
  // a discriminated `op` arg: insert / delete / substitute /
  // comment / accept / reject. Each verb reads the .md file on disk,
  // applies the CriticMarkup mutation via pure helpers in
  // core/markdown/docEdit.ts, then writes atomically. When the file
  // is open in the editor, the autosave reconciliation flow surfaces
  // the change. Author resolution: `args.author` ?? `$DUO_AUTHOR` ??
  // 'agent'. v1: anchor / target resolution is by literal text match
  // on the stripped-CM view of the body; `--occurrence N` disambiguates.
  | 'doc-edit'
  // ENH-167 — workspace-as-file. Save / open / list-recent /
  // current / new verbs round-trip the running tabs + terminals +
  // browser tabs to a `.duo-workspace` file. Single 'workspace'
  // command with a discriminated `op` arg (mirrors 'file',
  // 'nav-pin'). See WorkspaceFileOp below for the op union.
  // Naming: "workspace" (not "session") to avoid collision with
  // Claude session terminology (the agent loop inside a terminal).
  | 'workspace'
  // ENH-172 (Sprint 20 / v0.7.7) — surface the existing showDotfiles
  // navigator-local state as a first-class CLI verb. Bare reads the
  // current value; `show` / `hide` / `toggle` writes. View-menu
  // checkbox + ⌘⇧. chord are the GUI counterparts.
  | 'hidden-files'
  // ENH-178 (Sprint 20 / v0.7.7) — control the browser-pane URL
  // filter mode. `unfiltered` lets ANY URL render in the embedded
  // browser (debug-only — CLI requires IT-warning confirmation),
  // `filtered` is the legacy behavior (consult external-domains.json
  // for off-host redirects), `local-only` is the new default and
  // pops the system browser for anything outside file:// + localhost
  // + 127.0.0.1 + [::1]. Bare `duo browser-mode` reads current value.
  | 'browser-mode'
  // ENH-183 C12 (Sprint 21 / v0.7.9) — Claude session lifecycle CLI
  // parity. Single 'session' command with a discriminated `op` arg:
  //   list [--cwd <path>]      → list prior sessions in a CWD
  //   resume <tabId> <uuid>    → claude --resume <uuid> in tab's PTY
  //   rename <tabId> "<title>" → /rename <title> in tab's PTY
  //   hydrate <tabId>          → force-attempt Duo-driven hydration
  // Power-user opt-out + UI verbs (collapse/expand/dismiss-pills/
  // auto-hydrate) are deferred follow-ups.
  | 'session'
  // ENH-182 Phase 4 (Sprint 23 / v0.8.0) — project rail CLI parity.
  //   list                 → JSON of derived projects + focused + counts
  //   focus <name|root>    → set focus
  //   focus --all          → release focus
  //   pin <name|root>      → toggle persistent rail tile
  //   unpin <name|root>    → opposite of pin
  //   close <name|root>    → bulk close member terminals + tabs
  // Routes through socket-server → NavBridge.getProjectsState /
  // setProjectFocus / requestProjectClose / projectsTogglePin.
  | 'project'
  // ENH-184 (Sprint 23 / v0.8.0) — CLI parity for the workspace-pill
  // click-to-open-menu feature flag. `duo workspace-pill-menu` reads
  // current state; `duo workspace-pill-menu [on|off|toggle]` writes.
  // Persisted in renderer localStorage `duo.workspacePillMenu`.
  | 'workspace-pill-menu'
  // ENH-195 — `duo status` returns a high-level JSON snapshot of the
  // running app: open file/browser tabs (with per-tab dirty / active /
  // pinned), the active working tab, focused column, theme,
  // terminal-tab count. Read live from the renderer's
  // `window.__duoGetStatus()` (no main-side cache — same always-fresh
  // pattern as `duo layout`). The keystone agent-orientation verb.
  | 'status'
  // ENH-195 — `duo doc edit <file> --find X --replace Y` is a surgical
  // PLAIN-text markdown replace (no CriticMarkup — direct accepted
  // edit; the suggestion-wrapping siblings live under `doc-edit`).
  // Buffer-routed (echo-safe through the editor's save) when the file
  // is open; disk-direct via core/markdown/plainEdit.ts when closed.
  | 'doc-edit-plain'
  // ENH-195 — `duo json set <file> <dotpath> <value>` /
  // `duo json merge <file> <patch.json>`. Structured edits to a
  // JSON / YAML file. Buffer-routed (echo-safe) when the file is open
  // in the JSON viewer; disk-direct (JSON.parse / js-yaml) when closed.
  // YAML round-trips lose comments — flagged in the reply reason.
  | 'json-op'

// ── Stage 18b — Distro skill packs ───────────────────────────────────────────
// A pack is a directory under `~/.claude/duo/packs/<name>/` carrying a
// PACK.json manifest, optional canvases, and (Stage 18c) extra skills.
// v1 minimum: defaults[] declares tabs to open on first launch after
// the pack lands. Stage 27's primitives are the language packs are
// authored in; Stage 28 is the first content built on this format.
//
// Why this lives in shared/types: both the renderer (future pack-
// browser UI) and the main process (loader + first-launch hook +
// `duo packs` CLI) consume the manifest shape. Shared types keep both
// sides honest.

export interface PackManifest {
  /** Always 1 in v1. Future schema changes bump this; older pack
   *  loaders see the version mismatch and surface an error rather
   *  than mis-parsing. */
  schemaVersion: 1
  /** Stable identifier. Lowercase + kebab-case. The loader rejects
   *  packs whose `name` field doesn't match the directory name on
   *  disk — keeps the registry single-sourced from the filesystem. */
  name: string
  /** Semver-style. Bumping a pack's version re-fires its
   *  first-launch defaults (per-pack-version flag in
   *  installed-packs.json). */
  version: string
  /** Human-readable title. Surfaced by `duo packs` and the future
   *  pack-browser UI. */
  title: string
  /** Optional one-line description. */
  description?: string
  /** Built-in pack — declares the pack ships with Duo's default
   *  install (vs. a third-party pack the user added to
   *  ~/.claude/duo/packs/). Used by the `duo-default` pack today
   *  (ships `what-duo-does.html`, future Beginner's Guide). Future
   *  Stage 28 uninstall tooling honors this flag — refuses
   *  uninstall without `--force`. v1 has no Stage 28 uninstall
   *  surface; the existing `duo pack uninstall` operates on Stage
   *  21d distro packs at extra-packs/, not on these lesson packs.
   *  External pack authors can set this if they want the same
   *  protection. ENH-138 introduced the field. */
  builtIn?: boolean
  /** Tabs to auto-open on first launch after the pack lands.
   *  Empty / missing = "skill pack only" (no default tabs). */
  defaults?: PackDefault[]
  /** Pre-pinned navigator entries. v1 stub: read but not enforced.
   *  Stage 18c wires this into the existing nav-pins service. */
  navPins?: PackNavPin[]
}

export interface PackDefault {
  /** v1 ships only `canvas`; `editor` / `browser` reserved for v2. */
  kind: 'canvas'
  /** Path relative to the pack root. */
  path: string
  /** When false, the default is informational only — the loader
   *  catalogs it but doesn't auto-open. Useful for "manually
   *  installable" defaults the user opts into via a pack browser. */
  openOnFirstLaunch: boolean
  /** When true, after auto-open the tab gets pinned via the
   *  existing pins service. v1 honors this on a best-effort basis;
   *  if the pin fails (path resolution issue, etc.) the open still
   *  succeeds. */
  pin?: boolean
}

export interface PackNavPin {
  /** Path relative to the pack root. */
  path: string
  /** Hint for the navigator. */
  kind?: 'file' | 'folder'
}

/** Result of parsing one pack directory. `manifest` is null when the
 *  manifest is missing, malformed, or schema-mismatched. `errors`
 *  carries human-readable diagnostics so `duo packs` can surface
 *  what went wrong without crashing the loader. */
export interface LoadedPack {
  /** Directory basename (the canonical name). May differ from
   *  `manifest.name` when the manifest is malformed. */
  dirName: string
  /** Absolute path to the pack directory. */
  rootDir: string
  /** Parsed manifest, or null when parse failed. */
  manifest: PackManifest | null
  /** Non-fatal errors encountered. A pack with errors still appears
   *  in the registry; defaults won't fire when manifest is null. */
  errors: string[]
}

export interface PackRegistry {
  /** All packs found under `~/.claude/duo/packs/` at the last scan,
   *  in directory-name sort order for stable iteration. */
  packs: LoadedPack[]
}

/** Per-pack first-launch state stored at
 *  `~/.claude/duo/installed-packs.json`. Keyed by `<name>@<version>`
 *  so a version bump re-fires defaults. Schema-versioned for future
 *  format evolution. */
export interface InstalledPacksState {
  schemaVersion: 1
  packs: Record<string, InstalledPackEntry>
}

export interface InstalledPackEntry {
  /** ISO 8601 timestamp of first launch with this pack@version. */
  firstLaunchedAt: string
}

// ── Console capture ──────────────────────────────────────────────────────────

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'verbose'

export interface ConsoleEntry {
  ts: number            // Date.now() at capture
  level: ConsoleLevel
  source: 'console' | 'log-entry'
  text: string          // human-readable rendering of args
  url?: string
  lineNumber?: number
}

// ── Browser exception capture (Runtime.exceptionThrown) ─────────────────────
// Uncaught JS exceptions never reach `Runtime.consoleAPICalled` or
// `Log.entryAdded`, so the console ring buffer misses them. `duo errors`
// returns this dedicated ring instead.

export interface BrowserErrorEntry {
  ts: number            // Date.now() at capture
  text: string          // exceptionDetails.text or exception.description
  url?: string          // script URL the exception originated from
  lineNumber?: number   // 0-based per CDP
  columnNumber?: number // 0-based per CDP
  stack?: string        // formatted multi-line stack trace
}

// ── Network capture (Network.*) ─────────────────────────────────────────────
// One entry per request, stitched from requestWillBeSent → responseReceived
// → loadingFinished/loadingFailed.

export interface NetworkEntry {
  requestId: string
  url: string
  method: string
  resourceType?: string         // 'XHR' | 'Fetch' | 'Document' | 'Stylesheet' | …
  startTs: number               // Date.now() at requestWillBeSent
  endTs?: number                // Date.now() at finished/failed
  status?: number
  statusText?: string
  mimeType?: string
  encodedDataLength?: number    // bytes over the wire (response)
  failed?: boolean
  errorText?: string            // populated when failed === true
}

// ── Browser tab state ────────────────────────────────────────────────────────

export interface BrowserTab {
  id: number
  url: string
  title: string
  isActive: boolean
  /** Sprint 7 Phase 3c — when true, this browser tab is currently
   *  living in the Split View aux slot and should NOT render in the
   *  main tab strip. The aux pane finds the inAux tab and routes
   *  bounds for it through `BROWSER_AUX_BOUNDS`. Mutually exclusive
   *  with `isActive` for main-strip rotation purposes (an aux-pinned
   *  tab is never the main-strip "active"). */
  inAux?: boolean
}

// ── Working-pane tabs (Stage 10 § D25/D26) ───────────────────────────────────
// The right column is a polymorphic tabbed surface that holds mixed types.
// Browser tabs are real WebContentsView-backed; editor / preview tabs are
// rendered in-renderer. Tab IDs are continuous 1..N across types so `duo tab
// <n>` / `duo close <n>` stay simple.

export type WorkingTabType =
  | 'browser'
  | 'editor'             // Stage 11 — rich-text markdown editor
  | 'page'               // Stage 17a — rendered + editable .html (basic = page; interactive = playground; same kind)
  | 'markdown-preview'   // Stage 10 v1 read-only .md (kept as a fallback)
  | 'image'
  | 'pdf'
  | 'json'               // ENH-110 — JSON / YAML viewer-editor (Tier 3 tree + raw-text toggle). Format (json|yaml) is implicit from the path extension.
  | 'unknown'

export interface WorkingTab {
  // Renderer-side id. For browser tabs this is `"b:<numericId>"`; for file
  // tabs it's `"f:<uuid>"`. The strip uses the string verbatim as the React
  // key and the event-dispatch id. The CLI / main-process surface still uses
  // numeric BrowserTab ids — mapping happens inside WorkingPane.
  id: string
  type: WorkingTabType
  title: string
  isActive: boolean
  // Type-specific. Populated when relevant for the tab's type.
  url?: string           // 'browser'
  path?: string          // non-browser file tabs
  mime?: string          // non-browser file tabs
  dirty?: boolean        // 'editor' — unsaved changes in buffer
  // Stage 24 — pinned tabs render with a pin icon, sort to leftmost,
  // and gate ⌘W behind a confirm modal. Pin identity is stable across
  // sessions (browser tabs by URL, file tabs by absolute path); the
  // pinned flag is computed by WorkingPane against the persisted
  // pins.json each render.
  pinned?: boolean
}

// ENH-041 / Sprint 3 — Split View ("aux") state. Locked spec at
// docs/prd/canvas-split-view-research.html § 7.
//
// B-ready shape: `tabs[]` is multi-tab capable from day one even
// though v1 UI is strictly single-slot (tabs.length is 0 or 1).
// v2 (Option B per the research) just turns a tab strip on; the
// state shape doesn't migrate.
//
// Identity-bearing IDs (tab UUIDs, BrowserTab numeric ids) match
// the regular `WorkingTab.id` convention — `f:<uuid>` for file tabs,
// `b:<numericId>` for browser tabs.
//
// Persistence: aux state survives launch via session-state-service
// (Phase 3c work); v1 first launch starts with `null`.
export interface WorkingAuxState {
  /** v1: length is 0 or 1. v2 (multi-tab Option B) lifts the cap. */
  tabs: WorkingTab[]
  /** Index into `tabs`. -1 when tabs is empty (split is "open" but
   *  has no content yet — transient state during open/close). */
  activeIndex: number
  /** Main-pane width as fraction of total working area. 0.5 default;
   *  drag-divider persists per-session via session-state-service. */
  splitPct: number
}

/** Snapshot the renderer pushes to main on every aux state change.
 *  Mirrors the SessionStateActiveWorking pattern — durable refs only,
 *  no session-local IDs (the CLI consumer uses paths/URLs). */
export interface WorkingAuxSnapshot {
  /** When null, split is closed (no aux pane visible). */
  aux: {
    /** Active tab's path (file tabs) or url (browser tabs); empty
     *  string when tabs is empty. */
    activePath: string
    activeKind: WorkingTabType
    splitPct: number
  } | null
}

/** Sub-verb shape for `duo split-view <op>`. */
export type WorkingAuxOp =
  | { op: 'open'; path: string }
  /** Phase 3c — pin an existing browser tab (by 1-based id from the
   *  main strip) into the aux slot. CLI parity for the right-click
   *  "Move to Split View" gesture on a browser tab. */
  | { op: 'open-browser'; browserTabId: number }
  | { op: 'close' }
  | { op: 'promote' }
  | { op: 'resize'; pct: number }
  | { op: 'state' }

// Stage 24 — persisted pin entry. Browser tabs identify by URL; file
// tabs by absolute path. Title is captured for the distro pre-pin
// case (Stage 18b's PACK.json § pins) so a freshly-installed Duo can
// show the right label even before the file is opened.
export interface PinEntry {
  kind: 'browser' | 'file'
  /** URL for `kind: 'browser'`, absolute path for `kind: 'file'`. */
  ref: string
  title?: string
}

// Stage 26 PR 2 (ENH-010) — navigator pin entry. Persisted at
// ~/.claude/duo/nav-pins.json. Separate from Stage 24's tab pins:
// nav pins are shortcuts in the navigator's left pane (bottom
// section), not WorkingPane tabs. Identity is the absolute path;
// `kind` lets the renderer pick the right icon without statting.
export interface NavPinEntry {
  /** Absolute path to a file or folder. */
  path: string
  kind: 'file' | 'folder'
  /** Cached basename so the section can render without a stat. The
   *  navigator can refresh this lazily; the persisted copy is the
   *  basename at pin time. */
  title?: string
}

// ENH-182 (Sprint 22) — project model. Decisions D1–D12 + R1–R3 locked
// 2026-05-25; PRD at docs/prd/enh-182-project-centric-ux.md. A Project
// is a derived view over the open tabs/terminals + a thin persisted
// slice for pins + color overrides — not a tab or workspace.
//
// Qualification (D2): a folder is a project iff
//   (isGitRepoRoot(folder) || hasMarker(folder))   // marker = CLAUDE.md or .claude/
//   && workingIn(folder)                           // ≥1 terminal cwd or non-pinned tab path under it
// Plus any pinned project root (D12) persists in the rail even with
// zero open items.
//
// Membership (D5): a tab/terminal belongs to the *deepest* qualifying
// root that encloses its path/cwd. A tab under no qualifying root
// belongs to no project (shown in All, hidden by every focus).
export interface Project {
  /** Absolute path of the project root. Identity. */
  root: string
  /** Display name. Defaults to basename(root); manual override deferred
   *  (R3 v1 = minimal). */
  name: string
  /** Whether `root` is a git repo's work-tree root. */
  isGitRoot: boolean
  /** Whether `root` contains `CLAUDE.md` or `.claude/`. */
  hasMarker: boolean
  /** 0..5 index into the six --project-* hues. Hash-stable per root (R2). */
  colorIndex: number
  /** D12 — true when this root is in the persisted pin set, so the
   *  tile stays in the rail even when no tabs are open. */
  pinned: boolean
}

// ENH-182 — persisted slice at ~/.claude/duo/projects.json. Pins keep
// a project tile in the rail when no tabs reference it. (Manual color
// overrides were cut in ENH-191 P0 — project colors are hash-stable only.)
export interface ProjectsFile {
  version: number
  /** Absolute paths of pinned project roots. Order = insertion order. */
  pins: string[]
}

// ENH-182 Phase 4 — renderer-authoritative snapshot of the live
// project rail. Pushed to main on every change via
// PROJECTS_STATE_PUSH; main caches it so `duo project list` returns
// instantly without a renderer round-trip. Mirrors the NAV_STATE_PUSH
// pattern. The CLI uses this to resolve `name|root` arguments before
// firing pin/unpin/focus/close requests.
export interface ProjectsStateSnapshot {
  /** Derived projects in rail order (sorted by name). */
  projects: Project[]
  /** Currently focused project root, or null when the All tile is
   *  active (no filter). */
  focusedProject: string | null
  /** Live member counts per project root, keyed by root path. Used
   *  by `duo project list --counts` and by the CLI close confirm. */
  counts: Record<string, { terminals: number; workingTabs: number; hasClaudeKindTerminal: boolean }>
}

// Stage 21c — session state restored across Duo relaunches.
// Persisted at ~/.claude/duo/session-state.json. Identity-bearing
// IDs (tab UUIDs, BrowserTab numeric ids) are session-local and
// regenerated on each launch; persistence keys off durable
// references (path, url, cwd) instead.
export interface SessionStateTerminal {
  cwd: string
  kind: TerminalTabKind
  /** Display title at save time. Restored as-is so the user sees the
   *  same labels they had before the reload. New PTYs may overwrite
   *  this with a CWD-derived basename once they boot. */
  title: string
  /** ENH-177 — last detected Claude session in this tab. Populated by
   *  the save-side scanner when claudePresence reports 'claude' at
   *  serialize time. `id` is the basename of the most-recently-
   *  modified `.jsonl` under `~/.claude/projects/<encoded-cwd>/`.
   *  `capturedAt` is a UNIX epoch ms for staleness checks. On restore,
   *  the renderer offers a non-modal "Resume" banner if claudePresence
   *  isn't 'claude' but `lastClaudeSession.id` is present. */
  lastClaudeSession?: {
    id: string
    capturedAt: number
  } | null
}

export interface SessionStateFileTab {
  /** Absolute path to the file. Restored tabs reload the buffer from
   *  disk on first render; unsaved-edit recovery is out of scope for
   *  v1 (would need an autosave layer). */
  path: string
  /** WorkingTabType minus 'browser'. Mirrors the FileTab.type field. */
  type: 'editor' | 'page' | 'markdown-preview' | 'image' | 'pdf' | 'json' | 'unknown'
  mime: string
}

export interface SessionStateBrowserTab {
  url: string
  title: string
}

export type SessionStateActiveWorking =
  | { kind: 'browser'; index: number }
  | { kind: 'file'; path: string }
  | null

/** Sprint 3 Phase 3c — Split View aux state persistence. Captures the
 *  aux pane's open paths + active selection + divider position so a
 *  relaunch can restore the split exactly as it was. Additive to the
 *  v1 SessionState schema (aux=null on load when missing) — old
 *  saves stay valid without a schema bump. v1 paths.length ≤ 1 (no
 *  multi-tab aux yet); the array shape is forward-compatible with
 *  future Phase 3c+ multi-tab.
 *
 *  Sprint 7 Phase 3c shipped browser-in-aux as a SEPARATE renderer
 *  state (`auxBrowserTabId`) rather than threading a discriminated
 *  union through here. The two slot kinds are mutually exclusive at
 *  any moment (a file in aux clears the browser pin and vice versa).
 *  Browser-in-aux does NOT persist across relaunch in v1 — re-pin
 *  manually on next launch. File-aux persistence is unchanged. */
export interface SessionStateAux {
  /** Absolute file paths in the aux strip. v1: length 0 or 1.
   *  Browser-in-aux is tracked separately (auxBrowserTabId,
   *  renderer-side, non-persisted in v1). */
  paths: string[]
  /** Index of the active aux tab. -1 / out-of-range → restore picks 0
   *  (or no-op if paths is empty). */
  activeIndex: number
  /** Divider position as a fraction in [0.20, 0.80]. Restored as the
   *  aux's splitPct so the user's chosen ratio survives. */
  splitPct: number
}

export interface SessionState {
  /** Schema version. Bumped on breaking changes; old schemas return
   *  empty state so a fresh launch isn't confused by stale data. */
  version: 1
  /** ISO timestamp of the most recent successful save. Diagnostic
   *  only — restore doesn't gate on freshness. */
  savedAt: string
  /** `app.getVersion()` at save time. Diagnostic only. */
  appVersion: string

  terminals: SessionStateTerminal[]
  /** Index into `terminals` of the active terminal at save time.
   *  -1 (or out-of-range) → restore picks index 0. */
  activeTerminalIndex: number

  browserTabs: SessionStateBrowserTab[]
  /** Index into `browserTabs` of the active browser tab. */
  activeBrowserIndex: number

  fileTabs: SessionStateFileTab[]
  /** What the WorkingPane was showing at save time. Restored after
   *  the tab arrays are rehydrated. */
  activeWorking: SessionStateActiveWorking

  /** The path that the file navigator was rooted at. Empty string =
   *  fall back to home dir on next launch. */
  navigatorPath: string

  /** Sprint 3 Phase 3c — Split View aux state. Optional + null-able
   *  for backward compatibility: pre-Phase-3c saves don't include
   *  this field, and load() defaults to null in that case. */
  aux?: SessionStateAux | null
}

/** ENH-191 P4 — per-window geometry for the multi-window session envelope. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** ENH-191 P4 — one window's restorable session: the per-window slice of the
 *  old flat SessionState + geometry + windowId + the per-window active-workspace
 *  pointer (P3-S10's persistence home). At N=1 a single WindowState carries
 *  exactly what the flat SessionState did. */
export interface WindowState {
  windowId: number
  /** Window geometry; null when never persisted (restore picks a default). */
  bounds?: WindowBounds | null
  /** P3-S10 / P4 item 8 — this window's active-workspace pointer (the standalone
   *  active-workspace.json is a single slot two windows would clobber). */
  activeWorkspace?: ActiveWorkspace | null
  terminals: SessionStateTerminal[]
  activeTerminalIndex: number
  browserTabs: SessionStateBrowserTab[]
  activeBrowserIndex: number
  fileTabs: SessionStateFileTab[]
  activeWorking: SessionStateActiveWorking
  navigatorPath: string
  aux?: SessionStateAux | null
}

/** ENH-191 P4 — the multi-window session document (schema v2): replaces the
 *  flat single-window SessionState (v1) on disk. A back-compat migration reads
 *  an old v1 flat doc into a one-window envelope (core/session-envelope.ts). */
export interface SessionEnvelope {
  version: 2
  savedAt: string
  appVersion: string
  windows: WindowState[]
}

// ENH-167 — workspace-as-file. A `.duo-workspace` is a SessionState
// wrapped with a name, savedAt, appVersion, and an explicit
// schemaVersion bump so a future format change can roll forward
// without breaking older files. v1 is a thin envelope: same restore
// code path as the autosave (App.tsx's session-load effect re-runs
// against the loaded state after the in-place reset), so the file
// format is functionally equivalent to ~/.claude/duo/session-state.json
// with one extra `name` field.
//
// Naming: "workspace" (not "session") to avoid collision with Claude
// session terminology — see ENH-167 ADR for the design call. The
// inner `state` field still uses the SessionState type because that's
// the pre-existing Stage 21c autosave shape.
//
// File extension `.duo-workspace`. User picks the path; the filename
// (sans extension) seeds the workspace name field if the user
// doesn't override it.
export interface WorkspaceFile {
  /** Schema version. Bumped on breaking changes. v1 = current. */
  schemaVersion: 1
  /** Human-readable name shown in the title bar and Open Recent menu.
   *  Defaults to the filename (sans `.duo-workspace`). */
  name: string
  /** ISO timestamp of when this workspace file was last saved. */
  savedAt: string
  /** `app.getVersion()` at save time. Diagnostic. */
  appVersion: string
  /** The actual workspace state — identical shape to the autosave. */
  state: SessionState
}

// ENH-167 — discriminated op union for `duo workspace <op>`.
export type WorkspaceFileOp =
  | { op: 'save'; path?: string; name?: string }     // path omitted → CLI errors (Save dialog is GUI-only)
  | { op: 'open'; path: string }
  | { op: 'list-recent' }
  | { op: 'current' }
  | { op: 'new' }                                     // clears active-workspace pointer + resets to fresh shell

// ENH-167 — Open Recent entry. Mirrors BrowserHistoryService's shape.
// `lastOpenedAt` is the LRU sort key; `savedAt` is informational.
export interface WorkspaceHistoryEntry {
  /** Absolute path to the .duo-workspace file. */
  path: string
  /** Workspace name at the time of the last open / save. */
  name: string
  /** Epoch ms of the most recent open OR save of this workspace. */
  lastOpenedAt: number
  /** ISO timestamp from the file's `savedAt` field at last access. */
  savedAt: string
}

// ENH-167 — pointer to the workspace file the currently-open Duo
// instance was loaded from (or last saved to). Persisted at
// ~/.claude/duo/active-workspace.json. null state ("untitled")
// means nothing has been opened or saved.
export interface ActiveWorkspace {
  path: string
  name: string
}

/** Empty/default state for first launches and corrupt-file recovery. */
export const EMPTY_SESSION_STATE: SessionState = {
  version: 1,
  savedAt: '',
  appVersion: '',
  terminals: [],
  activeTerminalIndex: -1,
  browserTabs: [],
  activeBrowserIndex: -1,
  fileTabs: [],
  activeWorking: null,
  navigatorPath: '',
  aux: null,
}

export interface BrowserState {
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

// ENH-028 — find-in-page IPC payloads. Mirrors Electron's
// `webContents.findInPage` API but trimmed to what the renderer
// actually sends + receives.
export interface BrowserFindRequest {
  query: string
  /** When true, advance to the next/prev match for the same query. */
  findNext?: boolean
  /** Direction. Default true (forward). */
  forward?: boolean
}

export interface BrowserFindResult {
  /** 1-indexed position of the active match, 0 if no matches. */
  activeMatchOrdinal: number
  /** Total match count for the current query. */
  matches: number
  /** Electron sets this true on the final result for a query;
   *  intermediate updates while still scanning have it false. */
  finalUpdate: boolean
}

// ── Files / navigator (Stage 10) ─────────────────────────────────────────────

export interface DirEntry {
  name: string
  path: string                          // absolute
  kind: 'file' | 'directory'
  size?: number                         // files only
  mtimeMs?: number                      // files only
}

export interface FileReadResult {
  bytes: Uint8Array                     // IPC-serializable; main sends Uint8Array
  mime: string
  size: number
  mtimeMs: number
}

export interface FileChangeEvent {
  kind: 'added' | 'changed' | 'removed'
  path: string
}

export interface FileWatchPush {
  id: string                            // matches the subscription id
  event: FileChangeEvent
}

// Renderer → main snapshot of navigator state. Main caches the latest value
// for the CLI's `duo nav state` response.
export interface NavStateSnapshot {
  cwd: string
  selected: { path: string; kind: 'file' | 'folder' } | null
  /** ENH-148 — full multi-select set. Singular `selected` above stays
   *  for back-compat (it's the primary). Empty array when nothing is
   *  selected; when populated, the primary's path appears in this
   *  list too. */
  selectedPaths?: { path: string; kind: 'file' | 'folder' }[]
  expanded: string[]                    // absolute paths
  pinned: boolean
  /** ENH-172 (Sprint 20 / v0.7.7) — current `showDotfiles` navigator
   *  toggle state. False by default; flipped via View → Show Hidden
   *  Files, the ⌘⇧. chord, or `duo hidden-files show|toggle`. The
   *  `.claude` / `.obsidian` carve-outs in FileTree.tsx § shouldShow
   *  are unaffected — they remain always-visible regardless of this
   *  flag. Optional for back-compat with older snapshot consumers. */
  showDotfiles?: boolean
}

// Stage 11 § D29a — Renderer pushes the active editor's selection state so
// `duo selection` can return it without a renderer round-trip. `null` when
// no editor tab is active.
export interface EditorSelectionSnapshot {
  path: string
  /** Selected text (collapsed selection \u2192 ''). */
  text: string
  /** The full text of the paragraph (or block) the caret/selection sits
   *  inside. Helps the agent understand the local context. */
  paragraph: string
  /** Ancestor heading chain, outermost first. e.g. ['Risks', 'Market']. */
  heading_trail: string[]
  /** ProseMirror doc positions for the selection range. Used by
   *  `doc-write --replace-selection`. */
  start: number
  end: number
}

// Stage 11 § D27 / D29 — main \u2192 renderer requests for editor mutation.
export type DocWriteMode = 'replace-selection' | 'replace-all'

export interface DocWriteRequest {
  reqId: string                         // matches the renderer reply
  path?: string                         // optional; main routes to active editor when omitted
  mode: DocWriteMode
  text: string
}

export interface DocWriteResult {
  reqId: string
  ok: boolean
  error?: string
}

// ENH-195 — `duo doc edit` (surgical PLAIN markdown replace). Distinct
// from DocWriteRequest (whole-buffer replace) and the `doc-edit`
// CriticMarkup family (suggestion-wrapping). The find/replace text is
// literal (non-regex); `occurrence` / `all` / `atLine` mirror the
// `duo doc *` disambiguation model. Buffer-routed when the file is open
// (echo-safe through the editor's save), disk-direct when closed.
export interface DocEditPlainRequest {
  reqId: string
  /** Absolute path. The renderer handler silently ignores requests
   *  whose path doesn't match the active editor (BUG-144 pattern). */
  path: string
  /** Literal find text (non-regex). */
  find: string
  /** Literal replacement. May be '' (delete the match). */
  replace: string
  /** Replace only the Nth (1-indexed) occurrence. Ignored when `all`. */
  occurrence?: number
  /** Replace every occurrence in scope. */
  all?: boolean
  /** Restrict the replace to the single 1-indexed line. */
  atLine?: number
}

export interface DocEditPlainResult {
  reqId: string
  ok: boolean
  /** True when the body actually changed. */
  changed: boolean
  /** How many occurrences were replaced (0 on any no-op). */
  replacements: number
  /** Human-readable no-op reason (empty on success). Mirrors
   *  PlainEditResult.reason from core/markdown/plainEdit.ts. */
  reason: string
  /** Resolved path the edit landed on (open or disk). */
  path?: string
  error?: string
}

// ENH-195 — `duo json set|merge`. Structured edits to a JSON / YAML
// file. `set` writes `valueJson` (a JSON-encoded value) at the dotted
// `pointer` (`a.b[0].c`; empty / '.' = root). `merge` deep-merges
// `mergeJson` (a JSON-encoded object) into the root. Buffer-routed
// when the JSON viewer has the file open (echo-safe through its save),
// disk-direct when closed. YAML serialization drops comments — flagged
// in `reason`.
export type JsonOpKind = 'set' | 'merge'

export interface JsonOpRequest {
  reqId: string
  /** Absolute path. The renderer handler silently ignores requests
   *  whose path doesn't match the active JSON viewer. */
  path: string
  op: JsonOpKind
  /** `set` only — dotted path (`a.b[0].c`; empty / '.' = root). */
  pointer?: string
  /** `set` only — JSON-encoded value to assign at `pointer`. */
  valueJson?: string
  /** `merge` only — JSON-encoded object to deep-merge into the root. */
  mergeJson?: string
}

export interface JsonOpResult {
  reqId: string
  ok: boolean
  /** True when the parsed value actually changed (best-effort —
   *  always true on a successful write in v1). */
  changed: boolean
  /** Human-readable note (empty on a clean JSON success). Carries the
   *  "YAML comments not preserved" caveat for .yaml/.yml files. */
  reason: string
  /** Resolved path the op landed on (open or disk). */
  path?: string
  error?: string
}

// ENH-108 (Sprint 12) — `duo image insert <path>` request/reply.
// Source bytes are read by main (CLI process can't reach the renderer
// directly + bytes can be large) and shipped through. Renderer
// dispatches to active markdown editor → saveImageBeside + insert at
// caret. v1 supports markdown editor target only.
export interface ImageInsertRequest {
  reqId: string
  bytes: Uint8Array
  ext: string  // e.g. 'png', 'jpg' — used for the saved filename
  alt?: string // optional alt text on the inserted node
}

export interface ImageInsertResult {
  reqId: string
  ok: boolean
  /** Absolute path of the saved-alongside image, when ok. */
  absPath?: string
  error?: string
}

// ENH-022 (v0.5.4) — `duo doc goto` — agent-driven editor navigation.
// One of the three target fields must be set. The handler routes by
// active editor type: markdown editor handles `heading` + `line` +
// `anchor` (slugified-id); canvas handles `anchor` (data-duo-id or
// id attribute) + `line` (counts source lines in the rendered HTML).
// `path` is optional — main routes to the active editor when omitted.
export interface DocGotoRequest {
  reqId: string
  path?: string
  heading?: string                      // case-insensitive substring match on heading text (markdown only)
  line?: number                         // 1-indexed (clamped to last line if too large)
  anchor?: string                       // markdown: slugified-id; canvas: data-duo-id or HTML id
}

export interface DocGotoResult {
  reqId: string
  ok: boolean
  /** Resolved absolute path the goto landed on. */
  path?: string
  /** Resolved 1-indexed line number, when meaningful (markdown only). */
  line?: number
  /** Resolved anchor / heading slug — useful when the agent
   *  matched on `--heading "Foo"` and wants the canonical slug
   *  back for a follow-up `--anchor` call. */
  anchor?: string
  /** ENH-022 v3 — matched heading text verbatim. Lets the user
   *  verify which heading the precedence chain (exact > starts-with
   *  > word-boundary > substring) actually picked, so wrong-match
   *  reports are self-diagnosing. Omitted for line-based gotos. */
  matched_heading?: string
  /** ENH-022 v4 — true when the editor's buffer diverges from disk
   *  AND the buffer has unsaved edits (so we can't safely reload).
   *  The match was run against the stale buffer; if the result looks
   *  wrong, the agent should ask the user to save and retry. */
  buffer_stale?: boolean
  error?: string
}

// ENH-023 (v0.5.4) — `duo doc find` — read-only search of the
// markdown editor's buffer. Returns count + first-match line/col so
// an agent can pipe to `duo doc goto --line N` next. v1 markdown
// only; canvas / browser / terminal find variants are deferred.
export interface DocFindRequest {
  reqId: string
  path?: string
  query: string
  caseSensitive?: boolean              // default false
}

export interface DocFindResult {
  reqId: string
  ok: boolean
  path?: string
  matches?: number
  /** First-match position. 1-indexed line; 0-indexed col matches
   *  text-editor convention (the position-in-line where the match
   *  starts). */
  first?: { line: number; col: number }
  error?: string
}

// ── Stage 17b Phase C — `duo html *` op surface ────────────────────────────
// Single discriminated request shape so the IPC channel + main-process
// pairing logic stays simple. Renderer's PageTab dispatches each op
// to `htmlOps.ts § executeHtmlOp(doc, req)` and replies via
// `replyHtmlOp(result)`. PRD H37, H38.

export type HtmlOpRequest =
  | { reqId: string; op: 'query'; selector: string; path?: string }
  | { reqId: string; op: 'get'; id?: string; selector?: string; path?: string }
  | { reqId: string; op: 'set'; id?: string; selector?: string; html: string; path?: string }
  | { reqId: string; op: 'replace'; id?: string; selector?: string; html: string; path?: string }
  | { reqId: string; op: 'append'; parentId?: string; parentSelector?: string; html: string; path?: string }
  | { reqId: string; op: 'remove'; id?: string; selector?: string; path?: string }
  | { reqId: string; op: 'attr'; id?: string; selector?: string; set?: Record<string, string>; remove?: string[]; path?: string }
  /** ENH-055 — programmatic click. Resolves the target via `--id` or
   *  `--selector`, calls `element.click()`. Triggers the canvas-action
   *  delegated dispatcher (canvasActions.ts) just like a real user
   *  click — `data-duo-action` verbs fire normally. Used by the
   *  lesson fly-through harness to walk a playground end-to-end
   *  without manual clicking. */
  | { reqId: string; op: 'click'; id?: string; selector?: string; path?: string }

export interface HtmlOpResult {
  reqId: string
  ok: boolean
  result?: unknown            // op-specific shape
  error?: string
}

/** `duo html query` returns this shape per match. `text` is truncated
 *  to keep the JSON manageable; for full content use `duo html get`. */
export interface HtmlQueryMatch {
  id: string | null            // null when the element has no data-duo-id
  tag: string                  // lowercased tag name
  text: string                 // up to ~200 chars of textContent
  classes: string[]
}

/** `duo html get` returns this shape. */
export interface HtmlGetResult {
  id: string | null
  tag: string
  html: string                 // outerHTML
  text: string                 // full textContent
}

// ── Stage 17d — `duo html comment` op surface ──────────────────────────────
// Separate from HtmlOpRequest because comments mutate the SIDECAR, not the
// HTML document. Renderer's PageTab subscribes to a dedicated channel so
// the html-op subscription stays focused on DOM manipulation. PRD H24.

export interface HtmlCommentRequest {
  reqId: string
  /** Anchor selector — exactly one must be present. PRD H24:
   *   - id: exact data-duo-id lookup (preferred)
   *   - selector: CSS selector → nearest data-duo-id ancestor
   *   - text: substring match → nearest data-duo-id ancestor */
  id?: string
  selector?: string
  text?: string
  body: string                          // comment body (plain text v1)
  path?: string                         // optional canvas path; routes errors when active doesn't match
}

export interface HtmlCommentResult {
  reqId: string
  ok: boolean
  /** Mint id for the new comment entry (renderer adds it to the
   *  sidecar so the op is reported back as "the agent commented as
   *  `cmt_…`"). Present when ok. */
  commentId?: string
  /** The resolved anchor's `data-duo-id`. Present when ok. */
  anchorId?: string
  error?: string
}

/** `duo html comments` returns this shape. Read-only listing of the
 *  active canvas's comments — agent uses it to inspect what the user
 *  has flagged before responding. */
export interface HtmlCommentsListRequest {
  reqId: string
  path?: string
  /** Filter: 'all' (default) | 'open' | 'resolved'. */
  filter?: 'all' | 'open' | 'resolved'
}

export interface HtmlCommentsListResult {
  reqId: string
  ok: boolean
  threads?: HtmlCommentThread[]
  error?: string
}

export interface HtmlCommentThread {
  /** Thread id = anchor's data-duo-id. */
  id: string
  /** 1-indexed position in document order. */
  number: number
  /** Anchor element's textContent, truncated. */
  excerpt: string
  resolved: boolean
  entries: HtmlCommentEntry[]
}

export interface HtmlCommentEntry {
  id: string
  author: string                        // 'user' | 'claude' | display name
  ts: string                            // ISO 8601
  body: string
}

// `duo doc read` — request/reply pair. Renderer returns the live editor
// buffer (including unsaved edits) so the agent sees what the user sees,
// not the on-disk version.
export interface DocReadRequest {
  reqId: string
  path?: string                         // optional; routes to active editor when omitted
}

export interface DocReadResult {
  reqId: string
  ok: boolean
  /** The full document text (frontmatter + body, joined as it would be
   *  written to disk). Present when ok. */
  text?: string
  /** The path of the editor that responded (active editor when request
   *  omitted path). */
  path?: string
  /** True when the buffer has unsaved changes. */
  dirty?: boolean
  error?: string
}

// ── Surface selection union (Stage 15g unified shape) ───────────────────────
// `duo selection` returns the active surface's selection. The shape is a
// discriminated union so the agent can branch on `kind`. Three surface
// kinds today, with a fourth (`page`) reserved for Stage 17.
//
// Stage 13 Phase 0 lock (2026-04-26): the HTML canvas snapshot is
// declared NOW as a placeholder so Stage 15 (Send → Duo) can ship
// canvas-ready without a follow-up shape change. The Stage 17 PRD H25
// is the source of truth for the field set; this declaration matches
// it. Until Stage 17 lands, no producer pushes this kind — any consumer
// that needs to fall back must handle the union exhaustively.
//
// See docs/DECISIONS.md "Editor-agnostic primitives" for the contract.

export interface BrowserSelectionSnapshot {
  kind: 'browser'
  url: string
  text: string                          // selected text (empty if collapsed)
  surrounding?: string                  // up to ~1k chars of the enclosing block
  selector_path?: string                // best-effort CSS path to the focus node
}

// Stage 15.2 — page-coordinate rect of the user's current browser
// selection, pushed live by the page-side observer alongside the
// snapshot. Renderer translates page coords → screen coords (using the
// WebContentsView's bounds) for the floating pill. Separate from
// BrowserSelectionSnapshot because rect is a UI concern, not part of
// the agent's `duo selection` contract.
export interface BrowserSelectionRect {
  x: number
  y: number
  width: number
  height: number
}

// Stage 15.2 — main → renderer push when the page-side observer emits
// a new selection state. `null` snapshot + `null` rect means the
// selection collapsed or focus moved off the page.
export interface BrowserSelectionPush {
  snapshot: BrowserSelectionSnapshot | null
  rect: BrowserSelectionRect | null
}

// ENH-159b — element-inspect snapshot. Captured by the page-side
// INSPECT_OBSERVER_IIFE when the user clicks an outlined element
// while `duo inspect` mode is active. Distinct from
// BrowserSelectionSnapshot (which is text-range-centric); here the
// addressable unit is a single element. Field shape is locked at
// AUQ 2026-05-15: tag + selector_path + headingTrail + innerText +
// key attrs, no outerHTML (kept lean — agents that want the full
// HTML can `duo dom <selector>`).
export interface BrowserInspectSnapshot {
  kind: 'inspect'
  /** Page URL the element belongs to. */
  url: string
  /** Optional page title — carried into the provenance line. */
  pageTitle?: string
  /** Lowercased tag name (e.g. 'div', 'button', 'a'). */
  tag: string
  /** Best-effort CSS path to the element. Same `selectorFor` helper
   *  the SELECTION_OBSERVER_IIFE uses, so both flows produce
   *  comparable paths the agent can feed to `duo dom <selector>`. */
  selector_path: string
  /** H1–H6 section trail in document order, outermost first. Empty
   *  when the page has no preceding headings. */
  headingTrail: string[]
  /** Element `innerText`, capped (~2000 chars) for paste hygiene. */
  innerText: string
  /** Key attributes the agent likely cares about: id, role,
   *  aria-label, href, src, name, type, data-testid. Only emitted
   *  when present and non-empty. */
  attrs: Record<string, string>
}

/** Markdown editor (Stage 11) selection — TipTap/ProseMirror-backed. */
export type MarkdownSelectionSnapshot = EditorSelectionSnapshot & { kind: 'editor' }

/** Page (Stage 17 H25) selection — iframe contentEditable + DOM
 *  observer. Reserved 2026-04-26 in Stage 13 Phase 0 so the union shape
 *  is locked before Stage 15 ships. No producer until Stage 17. */
export interface PageSelectionSnapshot {
  kind: 'page'
  /** Absolute path of the .html file. */
  path: string
  /** Selected text (empty if collapsed). */
  text: string
  /** outerHTML of the selection for non-collapsed selections. */
  html?: string
  /** Nearest ancestor element with a `data-duo-id` attribute. */
  anchorId?: string
  /** Trail of ancestor data-duo-ids, outermost first. */
  anchorPath?: string[]
  /** Sub-element range within the anchor (for sentence-level selections). */
  range?: { startOffset: number; endOffset: number; textPath: string }
  /** Up to ~1k chars of the enclosing block for context. */
  surrounding?: string
}

export type DuoSelection =
  | MarkdownSelectionSnapshot
  | BrowserSelectionSnapshot
  | PageSelectionSnapshot
  | null

// Sprint 16 / v0.6.15 — Claude-tab Enter key preferences. ENH-127 v2
// (v0.6.13) shipped "plain Return → newline" by default; v0.6.15 flips
// the default to 'submit' (matches universal terminal expectation) but
// keeps the override capability behind a localStorage / CLI toggle.
// Shift+Return stays default 'newline' (matches Slack / Discord /
// claude.ai web convention). Renderer is the source of truth; main
// caches so `duo claude-return` / `duo shift-return` can read without
// a renderer RPC. Set via CLAUDE_KEY_PREFS_SET (main → renderer).
//
//   'submit'  — plain `\r` written (xterm default; Claude submits)
//   'newline' — `\x1b\r` written (ESC+CR, the byte ⌥Return natively
//               sends; Claude reads as multi-line newline)
export type ClaudeReturnMode = 'submit' | 'newline'
export type ShiftReturnMode = 'submit' | 'newline'

export interface ClaudeKeyPrefsSnapshot {
  claudeReturn: ClaudeReturnMode
  shiftReturn: ShiftReturnMode
}

// Stage 11 § D33d — theme state mirrored between renderer (owner) and main
// (cache) so `duo theme` can read without a renderer RPC, and set by
// dispatching a THEME_SET back down.
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeStateSnapshot {
  mode: ThemeMode
  effective: 'light' | 'dark'
}

// BUG-138 Phase 2 — author identity used when stamping CriticMarkup
// marks (track-changes insert/delete/substitute, comments). Same
// renderer-owner / main-cache pattern as the theme + claude-key-prefs
// surfaces. `duo author` (no arg) reads the cached value; `duo author
// "<name>"` dispatches AUTHOR_SET back to the renderer which persists
// to localStorage('duo:author'). Agent invocations set their own
// author via the DUO_AUTHOR env var — Phase 3's `duo doc *` verbs
// honor it without going through this verb.
export interface AuthorStateSnapshot {
  author: string
}

// Stage 15 G19 — Send → Duo payload format. Renderer is the source of
// truth (persisted in localStorage); main keeps a cache for `duo
// selection-format` reads. Same shape as theme: pushState from renderer
// + onSet from main (CLI-driven override).
//
// Modes:
//   'a' — quote block + 1-line provenance (default; readable to humans
//         glancing at the terminal even when no agent is present).
//   'b' — literal selected text only (compact; agent has to call `duo
//         selection` for context).
//   'c' — opaque token like `<<duo-sel-abc123>>` (most compact;
//         requires the agent to expand via `duo selection`).
export type SelectionFormat = 'a' | 'b' | 'c'

// ENH-178 (Sprint 20 / v0.7.7) — three-mode browser URL filter.
//
//   - `unfiltered` — embedded browser renders ANY URL. Debug-only
//     escape hatch. CLI requires IT-warning confirmation to engage.
//   - `filtered` — legacy behavior. Hostnames in
//     `~/.claude/duo/external-domains.json` redirect to the system
//     browser; everything else renders in Duo.
//   - `local-only` — NEW DEFAULT. Only `file://*`, `localhost:*`,
//     `127.0.0.1:*`, `[::1]:*` render in Duo; ALL other URLs pop
//     the system browser. Matches the "agent-driven browsing on the
//     open internet is IT-policy-disallowed" stance some users have.
export type BrowserMode = 'unfiltered' | 'filtered' | 'local-only'

export interface BrowserModeStateSnapshot {
  mode: BrowserMode
}

export interface SelectionFormatStateSnapshot {
  format: SelectionFormat
}

// ── ENH-050: native NSMenu + system sheet dialog primitives ──────────────────
//
// Renderer sends a flat template of menu items; main builds the
// macOS-native menu and pops it. Items are leaves only (v1) — no
// submenus. The chosen item's `id` returns to the renderer; the
// renderer maps the id to the action it wants to fire.
//
// Why flat: keeps the wire format simple, avoids serializing
// click handlers across IPC. The renderer maps id → handler
// after the response lands. v2 can add submenu support if needed.

export interface MenuTemplateItem {
  /** Stable id the renderer maps back to a click handler. Required
   *  for actionable rows; use unique values like 'reveal' / 'pin' /
   *  'trash'. Ignored for separators. */
  id?: string
  /** The label shown in the menu. Required for actionable rows. */
  label?: string
  /** Electron accelerator string, e.g. "CommandOrControl+Alt+Left".
   *  Renders on the right side of the menu item via OS conventions.
   *  v1 doesn't bind the accelerator to actually fire the menu item
   *  outside the menu — the row is just visually labeled. */
  accelerator?: string
  /** When false, the row renders dimmed and isn't clickable. */
  enabled?: boolean
  /** When 'separator', the entry renders as a horizontal rule and
   *  ignores all other fields. */
  type?: 'normal' | 'separator'
}

export interface MenuPopupRequest {
  /** Flat list of items. Use `{ type: 'separator' }` between groups. */
  items: MenuTemplateItem[]
  /** Optional anchor point in window coordinates. When omitted, the
   *  menu pops at the OS-default position (typically the cursor). */
  x?: number
  y?: number
}

export interface MenuPopupResult {
  /** The id of the clicked item, or null if dismissed without click
   *  (Esc / outside-click / clicking a separator). */
  chosenId: string | null
}

export interface DialogConfirmRequest {
  /** Heading shown in bold above the message. */
  title: string
  /** Body text below the title. Multi-line OK. */
  message: string
  /** Button labels, left-to-right. The leftmost is typically Cancel
   *  (mapped via `cancelId`). The default (Enter) is `defaultId`. */
  buttons: string[]
  /** Index of the button highlighted as default (Enter activates it).
   *  Convention: rightmost button for affirmative actions. */
  defaultId?: number
  /** Index of the button mapped to Esc / outside-click / sheet
   *  dismissal. Convention: leftmost (Cancel). */
  cancelId?: number
  /** macOS sheet icon — affects the symbol shown to the left of the
   *  text. Use 'warning' for destructive confirms, 'info' for purely
   *  informational dialogs. */
  type?: 'info' | 'warning' | 'error' | 'question'
}

export interface DialogConfirmResult {
  /** The index of the button the user clicked. Maps to the buttons
   *  array passed in. */
  response: number
}

// ── IPC channel names (renderer ↔ main) ─────────────────────────────────────

export const IPC = {
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
  // ENH-187 — best-effort live cwd for a PTY (via lsof in main). Used
  // by ⌘T / `duo new-tab` to inherit the focused terminal's CURRENT
  // shell cwd (where the user has `cd`'d to), not the launch cwd from
  // the navigator's follow-mode-synced state.
  PTY_LIVE_CWD: 'pty:live-cwd',
  // BUG-191 — batched, liveness-aware live-cwd lookup for the project
  // rail. Returns `{alive, cwd}` per tab id so a shell that cd-d away
  // (cwd changes) or exited (alive:false) stops keeping a ghost tile.
  PTY_LIVE_CWDS: 'pty:live-cwds',
  PTY_DATA: (id: string) => `pty:data:${id}`,
  PTY_EXIT: (id: string) => `pty:exit:${id}`,

  // Renderer → main
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_BOUNDS: 'browser:bounds',
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_GET_TABS: 'browser:get-tabs',
  BROWSER_ADD_TAB: 'browser:add-tab',
  BROWSER_SWITCH_TAB: 'browser:switch-tab',
  BROWSER_CLOSE_TAB: 'browser:close-tab',
  // BUG-027 — reopen last-closed browser tab (Chrome ⌘⇧T parity).
  BROWSER_REOPEN_LAST_CLOSED: 'browser:reopen-last-closed',
  // Issue #27 — URL-bar autocomplete suggestions from persisted browser
  // history. Renderer queries on every input keystroke; main returns a
  // ranked list of {url, title}.
  BROWSER_HISTORY_SUGGEST: 'browser:history-suggest',
  BROWSER_FOCUS_ACTIVE: 'browser:focus-active',

  // Main → renderer
  BROWSER_STATE: 'browser:state',
  BROWSER_TABS: 'browser:tabs',
  // Stage 15.2 — live selection push from the page-side observer
  BROWSER_SELECTION: 'browser:selection',
  // BUG-006 (v0.5.5) — in-page Send → Duo pill click. Page-side IIFE
  // renders a pill anchored to the selection (renderer-DOM portal is
  // occluded by the WCV at compositor level). Click → CDP binding →
  // this channel → renderer's existing handleSendToDuoClick.
  BROWSER_SEND_TO_DUO_CLICK: 'browser:send-to-duo-click',
  // ENH-094 (Sprint 5) — playground action click in a BROWSER-PANE
  // page (parallel to the canvas-iframe runtime in
  // renderer/components/Page/playgroundActions.ts). The PLAYGROUND_
  // RUNTIME_IIFE in cdp-bridge.ts captures `data-duo-action` clicks
  // page-side and ships the attribute bundle via Runtime.binding;
  // BrowserManager checks the trust gate against the active tab's URL,
  // forwards trusted actions over this channel; renderer dispatches
  // to the same handlePlaygroundAction the canvas runtime feeds.
  BROWSER_PLAYGROUND_ACTION: 'browser:playground-action',

  // ENH-159b — element-inspect mode plumbing. Three channels:
  //   - SET_MODE (renderer/CLI → main): turn inspect on/off (or
  //     'toggle'). Main owns the canonical state; calls
  //     cdp.setInspectMode(on) to flip the page-side
  //     `__duoInspectActive` flag.
  //   - MODE (main → renderer): broadcast on every state change so
  //     the toolbar toggle button (and any future affordance)
  //     reflects the truth without each subscriber polling.
  //   - CLICK (main → renderer): a snapshot of the element the user
  //     clicked while in inspect mode. The renderer formats it and
  //     hands the payload to the active terminal — same egress path
  //     as the Send → Duo pill.
  BROWSER_INSPECT_SET_MODE: 'browser:inspect-set-mode',
  BROWSER_INSPECT_MODE: 'browser:inspect-mode',
  BROWSER_INSPECT_CLICK: 'browser:inspect-click',

  // Stage 27 — renderer → main: emit a DuoEvent into the bus. Powers
  // the canvas-action `duo:event` verb. Main owns the EventBus
  // singleton; renderer is a producer only.
  DUO_EVENT_EMIT: 'duo:event-emit',

  // Stage 10 — file navigator + previewers
  FILES_LIST: 'files:list',
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',            // Stage 11 — editor-driven save
  FILES_OPEN_PATH: 'files:open-path',  // FOLLOWUP-026 — renamed from FILES_OPEN_EXTERNAL: this is shell.openPath for local file paths (NOT URLs)
  FILES_OPEN_EXTERNAL_URL: 'files:open-external-url',  // BUG-132 — shell.openExternal for http/https/mailto URLs (distinct from FILES_OPEN_PATH which opens local paths via shell.openPath)
  FILES_REVEAL_IN_FINDER: 'files:reveal-in-finder',
  FILES_GET_HTML_META: 'files:get-html-meta',  // pre-flight for <meta duo-open-in> routing
  // Stage 26 item 6 — file-mutation actions from the navigator
  // (right-click → Delete / Rename) and the matching `duo file *`
  // CLI verbs. Trash uses shell.trashItem (recoverable); rename is
  // a same-fs fs.rename.
  FILES_TRASH: 'files:trash',
  FILES_RENAME: 'files:rename',
  // BUG-039 — lightweight existence check used by session-restore
  // hydration to drop tabs whose files were deleted between sessions.
  FILES_EXISTS: 'files:exists',
  // ENH-096 v2 (Sprint 9 walk-1 fix) — directory-aware existence
  // check for the wikilink vault-root walker. `FILES_EXISTS` strictly
  // returns true only for regular files (BUG-039 semantic); this one
  // returns true only for directories.
  FILES_DIR_EXISTS: 'files:dir-exists',
  // ENH-016 — create a directory (used by the navigator's "New
  // folder…" context-menu entry).
  FILES_MKDIR: 'files:mkdir',
  // Stage 26 PR 3 item 8 — path-kind probe for the editable
  // breadcrumb's resolution logic.
  FILES_KIND: 'files:kind',
  // ENH-111 (Sprint 12) — file-size + mtime probe for the image
  // viewer chrome's "1440 × 900 · 312 KB" readout. Cheaper than
  // FILES_READ (no payload transfer).
  FILES_STAT: 'files:stat',
  // ENH-108 (Sprint 12) — paste-image: write a clipboard image
  // beside the active doc. Renderer hands main the bytes + parent
  // dir + extension; main generates a unique filename
  // (`image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`), writes the file, returns
  // the absolute path the editor inserts via `![](relative-path)`.
  // ENH-129 (Sprint 14) — same handler now accepts an optional
  // `prefix` arg ('image' default, 'pdf' for PDF link insert).
  FILES_SAVE_IMAGE_BESIDE: 'files:save-image-beside',
  // ENH-128 (Sprint 14) — transcode HEIC / HEIF / RAW to PNG/JPEG via
  // Electron's nativeImage. Returns converted bytes + ext so the
  // renderer can call FILES_SAVE_IMAGE_BESIDE with the right
  // extension. Lives in main because nativeImage is main-only.
  FILES_CONVERT_IMAGE_BYTES: 'files:convert-image-bytes',

  // Stage 24 — pinned WorkingPane tabs persisted to ~/.claude/duo/pins.json.
  PINS_LIST: 'pins:list',
  PINS_TOGGLE: 'pins:toggle',
  // Stage 26 PR 2 (ENH-010) — pinned files & folders in the navigator,
  // persisted to ~/.claude/duo/nav-pins.json. Separate from Stage 24's
  // tab pins (different storage, different UX): nav pins surface as a
  // bottom-of-pane shortcut list keyed by absolute path.
  NAV_PINS_LIST: 'nav-pins:list',
  NAV_PINS_TOGGLE: 'nav-pins:toggle',
  // BUG-030 — main → renderer push when nav pins change. Broadcast on
  // every TOGGLE handler reply AND every socket-server `nav-pin` op so
  // CLI mutations show up live in the renderer without a relaunch.
  NAV_PINS_CHANGED: 'nav-pins:changed',

  // Stage 21c — session state restored across relaunches
  // (~/.claude/duo/session-state.json). Renderer pulls on mount,
  // debounce-saves on each change. Persists terminal CWDs, file
  // tabs, browser tabs, navigator path so reload feels like
  // resuming, not starting over.
  SESSION_STATE_LOAD: 'session-state:load',
  SESSION_STATE_SAVE: 'session-state:save',

  // ENH-167 — workspace-as-file. Save / open / list-recent / active
  // / new APIs for the File > Save Workspace / Open Workspace / Open
  // Recent Workspace menu chain (and `duo workspace <op>` CLI parity).
  //
  // Save flow: main → renderer SNAPSHOT_REQUEST (renderer rebuilds the
  // live SessionState shape from React state and replies via
  // SNAPSHOT_RESULT). Open flow: main writes the loaded state to
  // session-state.json + active-workspace.json, then triggers an
  // in-place reset (PTY dispose + WCV close + renderer reload).
  WORKSPACE_FILE_SAVE: 'workspace-file:save',                  // renderer-initiated (menu click)
  WORKSPACE_FILE_OPEN: 'workspace-file:open',
  WORKSPACE_FILE_OPEN_RECENT: 'workspace-file:open-recent',
  WORKSPACE_FILE_LIST_RECENT: 'workspace-file:list-recent',
  WORKSPACE_FILE_ACTIVE: 'workspace-file:active',              // read current ActiveWorkspace (or null)
  WORKSPACE_FILE_NEW: 'workspace-file:new',                    // clear active pointer + reset workspace
  WORKSPACE_FILE_CLEAR_RECENT: 'workspace-file:clear-recent',  // wipe workspace-history.json
  // ENH-167 v1.2 — main → renderer push when activeWorkspaceService
  // changes (Save, Save As, Open, Open Recent, New Workspace).
  // Drives the in-app titlebar workspace-name badge so it tracks live.
  WORKSPACE_FILE_ACTIVE_CHANGED: 'workspace-file:active-changed',
  // Snapshot request/reply pair so Save can capture the live state
  // bypassing the autosave debounce (which would otherwise lag the
  // last burst of user activity). Keeps the SESSION_STATE_* prefix
  // because the underlying autosave shape is still SessionState
  // (Stage 21c terminology); only the user-facing concept is renamed.
  SESSION_STATE_SNAPSHOT_REQUEST: 'session-state:snapshot-request',  // main → renderer
  SESSION_STATE_SNAPSHOT_RESULT: 'session-state:snapshot-result',    // renderer → main

  // Stage 18 — first-launch self-install (skill + subagent + provenance).
  INSTALL_STATUS: 'install:status',
  INSTALL_RUN: 'install:run',
  // ENH-017 (v0.5.2 sprint) — banner-driven "Add ~/.local/bin to PATH"
  // action. Detects shell from $SHELL, appends a fenced PATH block to
  // the user's rc file, returns a result describing what changed.
  INSTALL_ADD_TO_PATH: 'install:add-to-path',

  // v0.4.0 — GitHub Releases update checker. Renderer asks main for
  // the latest cached upstream version + a refresh-if-stale hint.
  // Main owns the network fetch + the disk cache to keep the
  // anonymous GitHub API rate-limit (60 req/hr/IP) from being burned
  // by HMR re-mounts.
  UPDATE_CHECK: 'update:check',

  // Stage 25 (v0.4.0) — main pushes a "post-redirect" event after
  // `duo external` (or any other shell.openExternal call from the
  // duo subagent) succeeds. The renderer mounts a small auto-
  // dismissing banner ("Sent <host> to your default browser. ⌘Tab
  // to find it.") so the user knows their click went somewhere.
  EXTERNAL_REDIRECTED: 'external:redirected',

  // ENH-002 / v0.4.0 — "Paste and Match Style" menu item fires this
  // at the renderer; the active editor (markdown / canvas) performs
  // a plain-text paste. The keyboard chord ⌘⇧V is also handled
  // editor-locally without going through this channel; the IPC
  // surface is purely for the menu accelerator.
  PASTE_PLAIN_REQUEST: 'paste-plain:request',
  FILES_WATCH_START: 'files:watch-start',
  FILES_WATCH_UPDATE: 'files:watch-update',
  FILES_WATCH_STOP: 'files:watch-stop',
  FILES_CHANGED: 'files:changed',        // main → renderer push

  // ENH-050 (v0.6.3) — native NSMenu + system sheet dialogs to retire
  // the WCV-mute pattern for renderer-DOM context menus + confirm
  // modals. See `docs/DECISIONS.md § WCV-occlusion remediation`.
  // MENU_POPUP: renderer sends a flat item template + click coords;
  //   main builds Menu.buildFromTemplate([...]) and pops; the chosen
  //   item's `id` returns to the renderer (or null on dismiss).
  // DIALOG_CONFIRM: renderer sends sheet config; main calls
  //   dialog.showMessageBox(window, opts) and returns the response
  //   button index (with checkboxChecked when applicable).
  MENU_POPUP: 'menu:popup',
  DIALOG_CONFIRM: 'dialog:confirm',
  // BUG-105 (Sprint 10) — main-process clipboard write. The renderer's
  // `navigator.clipboard.writeText` silently rejects when called from
  // a native NSMenu's `click` handler because the user-gesture window
  // closed when the menu opened. Routing through main uses Electron's
  // `clipboard` module which has no gesture requirement. Used by every
  // "Copy path" / "Copy URL" affordance reachable from a context menu.
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  // ENH-111 (Sprint 12) — image-to-clipboard for the image viewer's
  // "Copy image" toolbar action and right-click "Copy image". The
  // renderer can't write image data to the clipboard reliably from
  // a JS-only path (`navigator.clipboard.write` requires a user
  // gesture and PNG-only `ClipboardItem` support); main's
  // `nativeImage.createFromPath` + `clipboard.writeImage` covers
  // every codec Electron can decode.
  CLIPBOARD_WRITE_IMAGE: 'clipboard:write-image',

  // Stage 10 Phase 6 — navigator state + agent-facing commands
  NAV_STATE_PUSH: 'nav:state-push',      // renderer → main (cache state for CLI)
  NAV_VIEW: 'nav:view',                  // main → renderer (open a file in WorkingPane)
  NAV_EDIT: 'nav:edit',                  // main → renderer (open .md in editor tab)
  NAV_REVEAL: 'nav:reveal',              // main → renderer (move navigator + chip)

  // Stage 11 — editor selection snapshot + agent doc-write requests
  EDITOR_SELECTION_PUSH: 'editor:selection-push', // renderer → main (cache for `duo selection`)
  EDITOR_DOC_WRITE: 'editor:doc-write',           // main → renderer (apply mutation)
  EDITOR_DOC_WRITE_RESULT: 'editor:doc-write-result', // renderer → main (reply)
  EDITOR_DOC_READ: 'editor:doc-read',             // main → renderer (request live buffer)
  EDITOR_DOC_READ_RESULT: 'editor:doc-read-result',   // renderer → main (reply)
  // ENH-022 (v0.5.4) — `duo doc goto` request/reply pair.
  EDITOR_DOC_GOTO: 'editor:doc-goto',               // main → renderer (scroll-to)
  EDITOR_DOC_GOTO_RESULT: 'editor:doc-goto-result', // renderer → main (reply)
  // ENH-023 (v0.5.4) — `duo doc find` request/reply pair (markdown only v1).
  EDITOR_DOC_FIND: 'editor:doc-find',
  EDITOR_DOC_FIND_RESULT: 'editor:doc-find-result',

  // ENH-195 — `duo doc edit` surgical PLAIN-text replace. main →
  // renderer applies the replace to the live buffer + echo-safe save;
  // renderer → main replies. Distinct from the CriticMarkup `doc-edit`
  // path (disk-only suggestion-wrapping).
  EDITOR_DOC_EDIT_PLAIN: 'editor:doc-edit-plain',               // main → renderer
  EDITOR_DOC_EDIT_PLAIN_RESULT: 'editor:doc-edit-plain-result', // renderer → main

  // Stage 17b Phase C — agent ops against the active page.
  PAGE_HTML_OP: 'page:html-op',               // main → renderer (apply / read)
  PAGE_HTML_OP_RESULT: 'page:html-op-result', // renderer → main (reply)

  // ENH-195 — `duo json set|merge` against the active JSON / YAML
  // viewer. main → renderer applies the structured edit + echo-safe
  // save; renderer → main replies. Mirrors the html-op channel pair.
  JSON_OP: 'json:op',               // main → renderer (apply)
  JSON_OP_RESULT: 'json:op-result', // renderer → main (reply)

  // ENH-108 (Sprint 12) — `duo image insert <path>` request/reply pair.
  // Main reads source bytes + sends; renderer dispatches to the active
  // markdown editor (v1 — canvas parity later) which calls
  // saveImageBeside + inserts at caret. Reply carries the absolute
  // path of the saved image.
  EDITOR_IMAGE_INSERT: 'editor:image-insert',                 // main → renderer
  EDITOR_IMAGE_INSERT_RESULT: 'editor:image-insert-result',   // renderer → main

  // Stage 17c — page selection snapshot push from the renderer. Mirrors
  // `EDITOR_SELECTION_PUSH` for the page surface so `duo selection
  // --pane canvas` can read without a renderer round-trip.
  PAGE_SELECTION_PUSH: 'page:selection-push', // renderer → main (cache)

  // Stage 17d — `duo html comment` (write) + `duo html comments` (read).
  // Comments live in the sidecar JSON; renderer is the only authoritative
  // source. Mirror the html-op channel pair pattern.
  PAGE_HTML_COMMENT: 'page:html-comment',                 // main → renderer
  PAGE_HTML_COMMENT_RESULT: 'page:html-comment-result',   // renderer → main
  PAGE_HTML_COMMENTS_LIST: 'page:html-comments-list',     // main → renderer
  PAGE_HTML_COMMENTS_LIST_RESULT: 'page:html-comments-list-result', // renderer → main

  // Sprint 6 BUG-081 — right-click "Comment" entry on a canvas iframe
  // sends this from main → renderer. The renderer-side bridge re-
  // dispatches as a 'duo-start-comment' CustomEvent so the active
  // PageTab's listener (also driven by ⌘⌥M and the toolbar) handles
  // it identically. One-way; no reply needed — the composer opens or
  // it doesn't, and the right-click already gave the user feedback.
  PAGE_COMMENT_REQUEST: 'page:comment-request',

  // Stage 11 § D33d — theme state + agent override
  THEME_STATE_PUSH: 'theme:state-push',  // renderer → main (cache state)
  THEME_SET: 'theme:set',                // main → renderer (CLI-driven override)

  // BUG-138 Phase 2 — author identity (used for CriticMarkup mark
  // attribution). Same shape as THEME_*: renderer caches in main;
  // main re-broadcasts CLI overrides.
  AUTHOR_STATE_PUSH: 'author:state-push',  // renderer → main
  AUTHOR_SET: 'author:set',                // main → renderer

  // Sprint 16 / v0.6.15 — Claude-tab Enter key preferences. Same
  // shape as THEME_*: renderer caches state in main; main re-broadcasts
  // CLI overrides. Single channel for both prefs (claudeReturn +
  // shiftReturn) — push and set carry the full ClaudeKeyPrefsSnapshot
  // (or a partial; the renderer hook only updates the keys present).
  CLAUDE_KEY_PREFS_STATE_PUSH: 'claude-key-prefs:state-push',  // renderer → main
  CLAUDE_KEY_PREFS_SET: 'claude-key-prefs:set',                // main → renderer

  // ENH-169 (Sprint 20) — File menu items for New File… / New
  // Folder… Main pushes when the menu items fire (their accelerators
  // ⌘N / ⌘⇧N own the chords at the app-menu level). Renderer
  // dispatches to newMarkdownFile / newFolder. Payload-free —
  // default location is always the navigator's current cwd.
  NEW_FILE_REQUEST: 'file:new-file-request',     // main → renderer
  NEW_FOLDER_REQUEST: 'file:new-folder-request', // main → renderer

  // Stage 15 G19 — Send → Duo payload format (agent-tunable runtime knob)
  SELECTION_FORMAT_STATE_PUSH: 'selection-format:state-push',  // renderer → main
  SELECTION_FORMAT_SET: 'selection-format:set',                // main → renderer

  // Stage 15 G17 — active terminal id push so `duo send` knows where to write.
  // ENH-013 — payload now also carries `kind` so the claude-presence prober
  // can arm its starting-grace window for `kind: 'claude'` tabs.
  TERMINAL_ACTIVE_PUSH: 'terminal:active-push',                // renderer → main
  // ENH-013 — main → renderer push when the front terminal's
  // claude-presence state flips. Drives the Send → Duo pill gate.
  TERMINAL_CLAUDE_PRESENCE_CHANGED: 'terminal:claude-presence-changed',

  // Stage 9 — cozy mode
  COZY_TOGGLE: 'cozy:toggle',            // main → renderer (menu clicked)
  COZY_STATE_PUSH: 'cozy:state-push',    // renderer → main (update menu checkmark)

  // ENH-172 (Sprint 20 / v0.7.7) — show/hide hidden files in the
  // navigator. Main → renderer carries the new value (true|false|toggle).
  // Renderer applies via useNavigator's setShowDotfiles + persists to
  // localStorage. The View-menu checkmark stays in sync via the
  // existing NAV_STATE_PUSH channel (showDotfiles is a field in
  // NavStateSnapshot since ENH-172). No dedicated state-push channel
  // needed.
  HIDDEN_FILES_SET: 'hidden-files:set',  // main → renderer ({ value: boolean | 'toggle' })

  // ENH-178 (Sprint 20 / v0.7.7) — browser-mode three-state filter.
  // BROWSER_MODE_GET → returns current mode + bootstrap info.
  // BROWSER_MODE_SET → renderer → main (persisted + applied).
  // BROWSER_MODE_PUSH → main → renderer (echo so CLI-driven changes
  // refresh the renderer-cached value used for the address-bar
  // affordances).
  BROWSER_MODE_GET: 'browser-mode:get',
  BROWSER_MODE_SET: 'browser-mode:set',
  BROWSER_MODE_PUSH: 'browser-mode:push',

  // Cmd-shortcuts pressed while the browser WebContentsView has focus.
  // Forwarded so the renderer can process them identically to native
  // window-focus keydowns (the WebContentsView swallows them otherwise).
  BROWSER_KEY_FORWARD: 'browser:key-forward',

  // BUG-042 — browser WebContentsView gained input focus (mousedown
  // landed inside the page, or it received OS focus via the focus
  // event). Renderer flips `focusedColumn = 'working'` so subsequent
  // ⌃Tab / ⌘T fire against the right pane. Symmetric to the canvas
  // iframe's mousedown forwarder (BUG-037 fix).
  BROWSER_FOCUS_GAINED: 'browser:focus-gained',

  // Stage 12 close — Claude just read a selection via `duo selection`.
  // Main pushes which pane the resolved selection came from; renderer
  // paints a brief accent glow on that pane's container so the user
  // sees "Claude is reading my work" without an explicit notification.
  // pane is one of 'editor' | 'browser' | 'canvas'; carries no
  // selection content (the agent already has it).
  CLAUDE_READ_SELECTION: 'claude:read-selection',

  // BUG-047 — temporarily mute the WebContentsView so renderer-DOM
  // overlays (context menus, tooltips) can render unobstructed. macOS
  // composites WCV above renderer DOM regardless of z-index. Renderer
  // sends `{ muted: true }` when the overlay opens and `{ muted: false }`
  // on close.
  BROWSER_OVERLAY_MUTED: 'browser:overlay-muted',

  // ENH-028 — find-in-page for the browser pane. Wraps Electron's
  // built-in `webContents.findInPage` API. Renderer sends START with
  // a query (re-called for each keystroke / next / prev), STOP to
  // close. Main pushes RESULT back with match counts via the
  // `found-in-page` event so the find bar can show "n / m".
  BROWSER_FIND_START: 'browser:find-start',
  BROWSER_FIND_STOP: 'browser:find-stop',
  BROWSER_FIND_RESULT: 'browser:find-result',

  // ⌘` — fired by the app-menu accelerator so it beats macOS's built-in
  // "cycle windows" system shortcut.
  PANE_TOGGLE_FOCUS: 'pane:toggle-focus',

  // BUG-048 v3 — renderer asks main to reclaim OS focus from a
  // WebContentsView. Used by togglePaneFocus AFTER it has decided
  // the toggle direction (so the xterm focus listener doesn't
  // poison the read). Without this, the focus reclaim used to live
  // in main's ⌘` accelerator click handler and fired BEFORE the
  // IPC, racing the toggle's prev read.
  PANE_FOCUS_RECLAIM: 'pane:focus-reclaim',

  // ENH-098 (Sprint 9) — main→renderer push for `duo focus-pane <name>`.
  // Renderer's existing focusPane() callback handles the dispatch; this
  // IPC just carries the target name. Mirrors PANE_TOGGLE_FOCUS but
  // payload-bearing (target) rather than payload-less.
  PANE_FOCUS_JUMP: 'pane:focus-jump',

  // Stage 19c D27 — `duo new-tab` from the CLI. Main forwards the
  // request (kind/cwd/cmd) to the renderer; renderer adds the tab and
  // ships the result back so the socket can return {id, kind, cwd, title}.
  NEW_TAB_REQUEST: 'terminal:new-tab-request',
  NEW_TAB_RESULT: 'terminal:new-tab-result',

  // ENH-014 (v0.5.2 sprint) — split-pane percentage push. Driven by
  // View → Pane size menu, ⌘⌥1/2/3/0/9 accelerators, and `duo split
  // <pct>`. Renderer clamps to 20–80 (same range as divider drag).
  SPLIT_SET: 'split:set',

  // ENH-099 — `⌘⌥4` chord + `duo split 3way` preset. Tells the renderer
  // to snap to the canonical 3-pane even layout: outer terminal/working
  // = 33/67, inner main/aux = 50/50. Net visual ≈ 33/33/33 across all
  // three columns. Same target shape as ENH-126's auto-redistribute on
  // split-open, but on-demand instead of triggered by aux-open. Renderer
  // applies the inner aux split only if aux is currently open; outer
  // gets the 33/67 either way.
  LAYOUT_3WAY_EVEN: 'layout:3way-even',

  // FOLLOWUP-015 (ENH-117 v2) — View → View source menu fires this so
  // the same `'duo-view-source'` window-event path that ⌘⌥V uses also
  // serves the menu entry (and any future host-side trigger). Tab-strip
  // right-click dispatches the window event directly — no main-side
  // round-trip needed because it's already in the renderer. Single
  // payload-less channel; the editor / canvas listener decides which
  // pane responds via its existing `isActive` gate.
  VIEW_SOURCE_REQUEST: 'view-source:request',

  // ENH-041 / Sprint 3 — Split View (one-aux companion in the canvas).
  // CLI verb `duo split-view open <path>` / `duo split-view close` /
  // `duo split-view` (state) routes through main → renderer via these
  // channels. State is renderer-authoritative (App.tsx owns the aux
  // useState); main caches the latest snapshot so the CLI's no-arg
  // state query can answer without a renderer round-trip.
  WORKING_AUX_OPEN: 'working:aux-open',          // main → renderer
  WORKING_AUX_OPEN_BROWSER: 'working:aux-open-browser', // main → renderer (Phase 3c — browser tab id into aux)
  WORKING_AUX_CLOSE: 'working:aux-close',        // main → renderer
  WORKING_AUX_PROMOTE: 'working:aux-promote',    // main → renderer (move to main)
  WORKING_AUX_RESIZE: 'working:aux-resize',      // main → renderer (CLI-driven splitPct)
  WORKING_AUX_STATE_PUSH: 'working:aux-state-push', // renderer → main (cache snapshot)
  /** Phase 3c — bounds for the aux-pinned browser tab. Renderer pushes
   *  on mount + on resize / split divider drag. Main applies them via
   *  BrowserManager.setAuxBounds. */
  BROWSER_AUX_BOUNDS: 'browser:aux-bounds',      // renderer → main
  /** Phase 3c — pin a browser tab into the aux slot. Renderer call.
   *  Carries the numeric BrowserTab id. Resolves with the aux'd tab's
   *  url/title so the renderer can render the aux header. */
  BROWSER_MOVE_TAB_TO_AUX: 'browser:move-tab-to-aux',
  /** Phase 3c — release the aux-pinned tab back to the main strip.
   *  Renderer call; main flips the BrowserManager flag and switches
   *  the strip's active tab to the released one. */
  BROWSER_RELEASE_AUX_TAB: 'browser:release-aux-tab',
  // ENH-152a — git status probe for the Navigator root chip. renderer → main.
  GIT_STATUS: 'git:status',
  // ENH-182 — D2 marker probe. Returns true if `dir` contains a
  // CLAUDE.md file or a .claude/ directory (a project marker per
  // the project-as-filter-layer model). Renderer → main; called by
  // useProjects when the navigator listing isn't sufficient (e.g.
  // user just opened a file under ~/.claude without navigating).
  PROJECTS_HAS_MARKER: 'projects:has-marker',
  // ENH-182 Phase 3 — persisted projects.json slice (pins). Renderer → main.
  // (Manual color-override IPC cut in ENH-191 P0 — colors are hash-stable.)
  PROJECTS_READ: 'projects:read',
  PROJECTS_TOGGLE_PIN: 'projects:toggle-pin',
  // ENH-182 Phase 3 — main → renderer push after any mutation
  // (toggle-pin, set-color-override, or a Phase 4 CLI verb), carrying
  // the fresh ProjectsFile so subscribers can update without polling.
  PROJECTS_CHANGED: 'projects:changed',
  // ENH-182 Phase 4 — CLI parity for `duo project` family.
  //   PROJECTS_GET_STATE  renderer → main (well, main → renderer
  //     async-pull): returns the rendered project list + the
  //     currently-focused root + per-project member counts. Backs
  //     `duo project list`; used by the CLI to resolve name → root
  //     before any subsequent action verb.
  //   PROJECTS_SET_FOCUS  main → renderer: setFocusedProject(root)
  //     or null for "All". Renderer subscribes; CLI invokes via the
  //     socket-server `project` command.
  //   PROJECTS_CLOSE_REQUEST  main → renderer: trigger handleClose-
  //     Project(root). Renderer subscribes; runs the same dialog
  //     confirm + bulk-flush as the right-click "Close N/M" path.
  PROJECTS_GET_STATE: 'projects:get-state',
  PROJECTS_SET_FOCUS: 'projects:set-focus',
  PROJECTS_CLOSE_REQUEST: 'projects:close-request',
  // ENH-182 Phase 4 — renderer → main push of the live rendered
  // project state, mirroring NAV_STATE_PUSH. Main caches the latest
  // snapshot so `duo project list` returns instantly without a
  // renderer round-trip.
  PROJECTS_STATE_PUSH: 'projects:state-push',
  // ENH-184 Phase 4 — main → renderer push for the workspace-pill
  // menu flag (CLI write path). Renderer applies via the existing
  // setWorkspacePillMenuFlag(boolean) helper which writes localStorage
  // + fires the duo:workspacePillMenuFlagChanged event so the hook
  // re-reads without a reload.
  WORKSPACE_PILL_MENU_SET: 'workspace-pill-menu:set',
  // Renderer pushes the current flag value to main on every change
  // (mirrors NAV_STATE_PUSH) so `duo workspace-pill-menu` (read) can
  // return immediately without a renderer round-trip.
  WORKSPACE_PILL_MENU_PUSH: 'workspace-pill-menu:push',
  // ENH-151 — clone wrapper + gh auth probe. renderer → main.
  GIT_CLONE: 'git:clone',
  GH_AUTH_STATUS: 'gh:auth-status',
  // ENH-155 — compose a GitHub URL for a file/folder path. renderer → main.
  GIT_GITHUB_URL_FOR: 'git:github-url-for',
  // ENH-152a v2 (peer-repos) — batch probe of which children of a
  // parent directory are themselves git repo roots. renderer → main.
  GIT_SCAN_REPOS_IN: 'git:scan-repos-in',
  // ENH-152b — per-file dirty status + line-diff for a work-tree.
  // renderer → main.
  GIT_DIRTY_FILES_FOR: 'git:dirty-files-for',
  // ENH-152c — fsevents-driven invalidation. Renderer subscribes via
  // GIT_WATCH_START(workTreeRoot); main starts a chokidar watcher
  // and pushes GIT_WATCH_INVALIDATE (debounced 250ms) when any file
  // in the work-tree changes. Renderer bumps its refresh tick.
  GIT_WATCH_START: 'git:watch-start',
  GIT_WATCH_STOP: 'git:watch-stop',
  GIT_WATCH_INVALIDATE: 'git:watch-invalidate',
  // FOLLOWUP-020 — main → renderer pushes to close the focused
  // working / terminal tab. Pairs with the ⌘W chord (App.tsx)
  // closing the same surface; this is the CLI-driven counterpart.
  NAV_CLOSE_ACTIVE_WORKING_TAB: 'nav:close-active-working-tab',
  NAV_CLOSE_TERMINAL_TAB: 'nav:close-terminal-tab',
  // FOLLOWUP-025 — main → renderer push triggered from the File
  // menu "Clone…" entry. Renderer opens the CloneModal.
  NAV_OPEN_CLONE_MODAL: 'nav:open-clone-modal',
  // FOLLOWUP-025 v2 — renderer → main request to open the Clone modal
  // (used by the Navigator right-click "Clone GitHub repo here…"
  // menu item). Main echoes via NAV_OPEN_CLONE_MODAL with the same
  // payload so App.tsx's subscriber handles both paths uniformly.
  NAV_OPEN_CLONE_MODAL_REQUEST: 'nav:open-clone-modal-request',

  // ENH-183 C5 — read banner title + user-message-count from the
  // Claude JSONL store. Renderer → main; main consults JSONL only
  // (D5 read ladder, D13 derivation). No caching — D9 invariant
  // means the renderer recomputes via this call on every banner
  // render. The cost is bounded by readJsonlLines' head+tail caps.
  SESSION_READ_BANNER_TITLE: 'session:read-banner-title',
  SESSION_READ_MESSAGE_COUNT: 'session:read-message-count',
  // ENH-183 C6 — list prior `<uuid>.jsonl` sessions in a CWD for the
  // S1 resume-pills surface.
  SESSION_LIST_PRIOR: 'session:list-prior'
  // ENH-183 pared 2026-05-25 (Option A): SESSION_MAYBE_HYDRATE removed
  // with the T3 auto-hydration + S2 inline-rename code paths.
} as const


// ── Re-exports (Stage A Move 3) ──────────────────────────────────────────────
// The renderer host contract was moved to shared/host-api.ts. Re-exported
// here so existing `import { ElectronAPI, ... } from '../shared/types'
// continues to work unchanged.
export * from './host-api'
