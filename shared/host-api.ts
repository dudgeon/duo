// Renderer host contract — the shape of `window.electron` that the
// renderer consumes. Extracted from shared/types.ts in Stage A Move 3
// so the host contract is reviewable on its own and a future
// non-Electron host (e.g. a Chrome-extension shim) can declare its
// own surface without forking the wire/domain types.
//
// types.ts re-exports everything from this file, so existing
// `import { ElectronAPI } from '../shared/types'` keeps working.

import type {
  TerminalTabKind,
  BrowserState, BrowserBounds, BrowserTab, BrowserSelectionPush, BrowserFindResult,
  DirEntry, FileReadResult, FileChangeEvent,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  DocWriteRequest, DocWriteResult,
  DocReadRequest, DocReadResult,
  DocGotoRequest, DocGotoResult,
  DocFindRequest, DocFindResult,
  HtmlOpRequest, HtmlOpResult, HtmlCanvasSelectionSnapshot,
  HtmlCommentRequest, HtmlCommentResult,
  HtmlCommentsListRequest, HtmlCommentsListResult,
  ThemeMode, ThemeStateSnapshot,
  SelectionFormat, SelectionFormatStateSnapshot,
  PinEntry, NavPinEntry,
  SessionState,
} from './types'

// ── Electron preload API surface ─────────────────────────────────────────────

export interface ElectronEnv {
  HOME: string
  SHELL: string
  /** Duo's package.json `version` field, populated at preload time
   *  via `app.getVersion()`. Surfaces in the titlebar so the user
   *  can confirm which build is running before a smoke walk. */
  appVersion: string
  /** True when running under `npm run dev` (electron-vite's HMR
   *  loop), false in a packaged build. Drives the dev-mode badge
   *  next to the version in the titlebar. */
  isDev: boolean
}

export interface ElectronPtyAPI {
  create: (id: string, shell?: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  onData: (id: string, cb: (data: string) => void) => () => void
  onExit: (id: string, cb: (code: number) => void) => () => void
  // Note: tab titles come from xterm.js Terminal.onTitleChange() (OSC sequences),
  // not via IPC — no main-process emit needed.
}

export interface ElectronBrowserAPI {
  navigate: (url: string) => Promise<{ ok: boolean; url: string; title: string }>
  back: () => void
  forward: () => void
  reload: () => void
  setBounds: (bounds: BrowserBounds) => void
  /** BUG-047 — temporarily mute the WebContentsView (collapse to 1×1)
   *  so a renderer-DOM overlay (context menu, tooltip) can render
   *  unobstructed. macOS composites WCV above renderer DOM regardless
   *  of z-index. Renderer should pair `setOverlayMuted(true)` on
   *  overlay open with `setOverlayMuted(false)` on close. */
  setOverlayMuted: (muted: boolean) => void
  /** ENH-028 — find-in-page. Each keystroke (and ⌘G / ⌘⇧G) calls
   *  findStart with the current query; pass `findNext: true` +
   *  forward direction to advance. Match counts stream back via
   *  onFindResult. Calling findStop closes the active find session
   *  and clears the page highlight. */
  findStart: (query: string, options?: { findNext?: boolean; forward?: boolean }) => void
  findStop: () => void
  onFindResult: (cb: (result: BrowserFindResult) => void) => () => void
  getState: () => Promise<BrowserState>
  getTabs: () => Promise<BrowserTab[]>
  addTab: (url?: string) => Promise<{ ok: boolean; id: number; url: string; title: string }>
  switchTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  closeTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  /** BUG-027 — reopen the most-recently-closed browser tab. ⌘⇧T from
   *  browser focus routes here (Chrome parity). Returns ok:false with
   *  reason 'empty' when the closed-tab stack is empty. */
  reopenLastClosed: () => Promise<{ ok: boolean; id?: number; url?: string; reason?: string }>
  /** Issue #27 — URL-bar autocomplete. Returns history entries
   *  matching `prefix` (substring, case-fold) ranked by recency ×
   *  visit count. Empty prefix → top recent entries. */
  historySuggest: (prefix: string, limit?: number) => Promise<HistorySuggestion[]>
  /** Move keyboard focus to the active browser view. */
  focusActive: () => void
  onStateChange: (cb: (state: BrowserState) => void) => () => void
  onTabsChange: (cb: (tabs: BrowserTab[]) => void) => () => void
  /** Stage 15.2 — live selection push from the page-side observer. */
  onSelection: (cb: (push: BrowserSelectionPush) => void) => () => void
  /** BUG-006 — in-page Send → Duo pill clicks (renderer-DOM pill is
   *  occluded by the WCV at the macOS compositor level, so we render
   *  the pill INSIDE the page via CDP and route clicks back here).
   *  The snapshot is captured synchronously by the page-side IIFE at
   *  mousedown time and passed through the binding payload (BUG-006
   *  v2 — eliminates the cache-clear race with selectionchange). */
  onSendToDuoClick: (cb: (snapshot: import('./types').BrowserSelectionSnapshot | null) => void) => () => void
}

export interface FileWriteResult {
  ok: true
  size: number
  mtimeMs: number
}

export interface HtmlFileMeta {
  /** `<meta name="duo-open-in" content="...">` — declarative routing hint
   *  for HTML files. `browser` opens the file in a browser tab (file://
   *  URL); `canvas` opens in the editable HTML canvas. Undefined = no
   *  preference, fall through to the classifier's default (canvas). */
  openIn?: 'browser' | 'canvas'
  /** `<meta name="duo-editable" content="false">` — when false, the
   *  canvas mounts read-only (no contentEditable, toolbar, comment
   *  composer, or ID-injection probe). Honored regardless of where the
   *  file ends up routing to. **Hard lock** — toolbar toggle is hidden;
   *  use `defaultEditable` for soft-default behaviour the user can
   *  flip at runtime. */
  editable?: boolean
  /** Stage 27 (ENH-034) — `<meta name="duo-default-editable" content="false">`
   *  hints the canvas should mount read-only by default but allows the
   *  user to flip it via the toolbar toggle. The choice persists in
   *  localStorage at `duo-canvas-editable-override:<absPath>` so a
   *  re-open honors the user's last decision. Tutorial / lesson
   *  canvases ship with `false` so click handlers fire instead of
   *  contentEditable's cursor placement; the user can opt INTO editing
   *  if they want to take notes on the page. */
  defaultEditable?: boolean
}

export interface ElectronFilesAPI {
  list: (path: string) => Promise<DirEntry[]>
  read: (path: string) => Promise<FileReadResult>
  /** Stage 11 — write a file atomically (tmp + rename). Creates parent dirs
   *  if needed. Caller sends raw bytes. */
  write: (path: string, bytes: Uint8Array) => Promise<FileWriteResult>
  openExternal: (path: string) => Promise<void>
  revealInFinder: (path: string) => Promise<void>
  /** Stage 26 item 6 — move to macOS Trash (recoverable from Finder). */
  trash: (path: string) => Promise<void>
  /** Stage 26 item 6 — rename / move within the same filesystem. */
  rename: (oldPath: string, newPath: string) => Promise<void>
  /** BUG-039 — lightweight existence check (regular file). Used by
   *  session-restore hydration to drop tabs whose files were
   *  deleted between sessions. */
  exists: (path: string) => Promise<boolean>
  /** ENH-016 — create a directory (recursive — parents created if
   *  missing). Used by the navigator's "New folder…" context-menu
   *  entry. */
  mkdir: (path: string) => Promise<void>
  /** Stage 26 PR 3 item 8 — path-kind probe for the editable
   *  breadcrumb's resolution logic. Returns 'file' / 'folder' /
   *  null. Symlinks resolve through to the target. */
  kind: (path: string) => Promise<'file' | 'folder' | null>
  /** Pre-flight read of an HTML file's head (~4KB) to extract Duo's
   *  routing meta tags. Used by the file-open dispatcher to decide
   *  whether an .html file mounts as a browser tab or a canvas tab.
   *  Returns an empty object on read failure or when no meta tags
   *  match — caller falls through to the classifier's default. */
  getHtmlMeta: (path: string) => Promise<HtmlFileMeta>
  /**
   * Start a filesystem watcher on the given paths. Returns an `unwatch`
   * function. The callback fires on each add/change/remove event.
   * Paths are watched at depth 0 — caller is responsible for also watching
   * the parents of any expanded subtrees.
   */
  watch: (
    paths: string[],
    cb: (event: FileChangeEvent) => void
  ) => Promise<() => Promise<void>>
  /** Update the set of watched paths on an existing subscription. */
  updateWatchPaths: (id: string, paths: string[]) => Promise<void>
}

export interface ElectronNavAPI {
  /** Push the latest navigator state into the main-process cache.
   *  Main returns this on `duo nav state`. */
  pushState: (snapshot: NavStateSnapshot) => void
  /** Subscribe to `duo reveal <path>` commands coming in from the CLI. */
  onReveal: (cb: (path: string) => void) => () => void
  /** Subscribe to `duo view <path>` commands coming in from the CLI. */
  onView: (cb: (path: string) => void) => () => void
  /** Subscribe to `duo edit <path>` commands coming in from the CLI. */
  onEdit: (cb: (path: string) => void) => () => void
}

export interface ElectronEditorAPI {
  /** Push the active editor's selection snapshot into the main-process
   *  cache so `duo selection` can return it without a renderer RPC. */
  pushSelection: (snapshot: EditorSelectionSnapshot | null) => void
  /** Subscribe to `duo doc write` requests from the CLI. The renderer
   *  applies the mutation and replies via `replyDocWrite`. */
  onDocWrite: (cb: (req: DocWriteRequest) => void) => () => void
  /** Reply to a doc-write request (success or error). */
  replyDocWrite: (result: DocWriteResult) => void
  /** Subscribe to `duo doc read` requests from the CLI. The renderer
   *  serializes the live buffer and replies via `replyDocRead`. */
  onDocRead: (cb: (req: DocReadRequest) => void) => () => void
  /** Reply to a doc-read request with the live buffer. */
  replyDocRead: (result: DocReadResult) => void
  /** ENH-022 — `duo doc goto`. */
  onDocGoto: (cb: (req: DocGotoRequest) => void) => () => void
  replyDocGoto: (result: DocGotoResult) => void
  /** ENH-023 — `duo doc find` (markdown editor v1). */
  onDocFind: (cb: (req: DocFindRequest) => void) => () => void
  replyDocFind: (result: DocFindResult) => void
}

/** Stage 17b Phase C — agent ops against the active HTML canvas.
 *  Only the active canvas tab subscribes; if no canvas is open the
 *  CLI request times out (handled in main.ts via the request map). */
export interface ElectronCanvasAPI {
  onHtmlOp: (cb: (req: HtmlOpRequest) => void) => () => void
  replyHtmlOp: (result: HtmlOpResult) => void
  /** Stage 17c — push the active canvas tab's selection snapshot so
   *  `duo selection --pane canvas` can return it without a renderer
   *  round-trip. `null` clears the cache (collapse, blur, unmount). */
  pushSelection: (snapshot: HtmlCanvasSelectionSnapshot | null) => void
  /** Stage 17d — agent comment write. Renderer resolves the anchor,
   *  appends to the sidecar, and replies. */
  onHtmlComment: (cb: (req: HtmlCommentRequest) => void) => () => void
  replyHtmlComment: (result: HtmlCommentResult) => void
  /** Stage 17d — agent comments read. Returns the sorted thread list. */
  onHtmlCommentsList: (cb: (req: HtmlCommentsListRequest) => void) => () => void
  replyHtmlCommentsList: (result: HtmlCommentsListResult) => void
}

export interface ElectronKeyboardAPI {
  /** Fires when the browser WebContentsView intercepts a Duo shortcut
   *  and forwards it back to the renderer for handling. */
  onBrowserKey: (cb: (e: ForwardedKeyEvent) => void) => () => void
  /** Fires when the View → Toggle pane focus menu accelerator
   *  (⌘`) is triggered. */
  onPaneToggleFocus: (cb: () => void) => () => void
  /** BUG-048 v3 — renderer-driven OS focus reclaim. Called by
   *  togglePaneFocus AFTER it has decided direction so the focus
   *  reclaim's xterm-focus-event side-effect doesn't poison the
   *  toggle's prev read. Fires `mainWindow.webContents.focus()`
   *  in the main process. */
  reclaimFocus: () => void
  /** BUG-042 — fires when the browser WebContentsView gains keyboard
   *  focus (click into the page, programmatic focus, etc.). Renderer
   *  flips `focusedColumn = 'working'` so subsequent ⌃Tab / ⌘T fire
   *  against the right pane. Symmetric to the canvas iframe's
   *  mousedown forwarder (BUG-037). */
  onBrowserFocusGained: (cb: () => void) => () => void
  /** Stage 12 close — Claude just read a selection via `duo selection`.
   *  Carries which pane the resolved selection came from so the
   *  renderer can paint a transient accent glow on the right surface.
   *  No selection content (the agent already has it). */
  onClaudeReadSelection: (cb: (e: { pane: 'editor' | 'browser' | 'html-canvas' }) => void) => () => void
}

export interface ForwardedKeyEvent {
  key: string
  shift: boolean
  meta: boolean
  alt: boolean
  ctrl: boolean
}

export interface ElectronCozyAPI {
  /** Subscribe to View → Cozy mode menu clicks. */
  onToggle: (cb: () => void) => () => void
  /** Push the active tab's cozy state so the menu checkmark tracks it. */
  pushState: (cozy: boolean) => void
}

export interface ElectronLayoutAPI {
  /** ENH-014 — fires when View → Pane size menu, the ⌘⌥1/2/3/0/9
   *  accelerators, or `duo split <pct>` set the split percentage.
   *  Renderer clamps to 20–80 (matching divider drag). */
  onSplitSet: (cb: (pct: number) => void) => () => void
}

export interface ElectronThemeAPI {
  /** Renderer pushes the current theme state so `duo theme` can return
   *  it without a renderer round-trip. */
  pushState: (snapshot: ThemeStateSnapshot) => void
  /** Subscribe to `duo theme <mode>` commands from the CLI. */
  onSet: (cb: (mode: ThemeMode) => void) => () => void
}

// Stage 27 — DuoEvent producer surface for the renderer. Main owns
// the EventBus singleton; renderer is a producer-only client. Used by
// the canvas-action `duo:event` verb; future renderer hooks (editor
// selection-changed, browser navigation, etc.) can plug in here without
// growing the API shape.
export interface ElectronEventsAPI {
  emit: (input: {
    source?: 'canvas' | 'editor' | 'cli' | 'main' | 'renderer'
    name: string
    payload?: Record<string, unknown>
  }) => void
}

export interface ElectronSelectionFormatAPI {
  /** Renderer pushes the Send → Duo payload format so `duo
   *  selection-format` reads without a renderer round-trip. */
  pushState: (snapshot: SelectionFormatStateSnapshot) => void
  /** Subscribe to `duo selection-format <a|b|c>` from the CLI. */
  onSet: (cb: (format: SelectionFormat) => void) => () => void
}

export interface ElectronTerminalAPI {
  /** Renderer pushes the active terminal-tab id (or null when no
   *  terminal tabs exist) plus its kind so `duo send` knows where to
   *  write the payload AND ENH-013's claude-presence prober can arm
   *  its starting-grace window for kind=='claude' tabs. */
  pushActiveId: (payload: { id: string | null; kind: TerminalTabKind | null }) => void
  /** Stage 19c D23 — `true` if `claude` was found on PATH at app boot
   *  (or last refresh). Used to decide between auto-typing `claude\n`
   *  and printing the install banner when a `kind: 'claude'` tab spawns. */
  claudeOnPath: () => Promise<boolean>
  /** Stage 19c D27 — subscribe to `duo new-tab` requests from the CLI.
   *  Renderer adds the tab and replies via `replyNewTab`. */
  onNewTabRequest: (cb: (req: NewTabRequest) => void) => () => void
  /** Reply to a new-tab request with the resolved tab metadata. */
  replyNewTab: (result: NewTabResult) => void
  /** ENH-013 — subscribe to claude-presence state changes for the
   *  front terminal. The Send → Duo pill is enabled only when the
   *  state is 'claude' or 'starting'. */
  onClaudePresenceChange: (cb: (state: ClaudePresenceState) => void) => () => void
}

/** ENH-013 — claude-presence state. See electron/claude-presence.ts. */
export type ClaudePresenceState = 'no-pty' | 'shell' | 'claude' | 'starting'

/** Issue #27 — URL-bar autocomplete suggestion shape. Returned by
 *  `browser.historySuggest`. */
export interface HistorySuggestion {
  url: string
  title: string
  lastVisited: number
  visitCount: number
}

// Stage 19c D27 — `duo new-tab` request shape (CLI → main → renderer).
export interface NewTabRequest {
  /** Correlation id; renderer echoes it back in NewTabResult so the
   *  socket-side promise resolves to the right request. */
  reqId: string
  /** undefined → use the persisted last choice (D28). */
  kind?: TerminalTabKind
  /** undefined → renderer's pending CWD (the navigator's current folder). */
  cwd?: string
  /** Optional pre-typed command — written into the PTY after spawn but
   *  WITHOUT a trailing newline (parity with Stage 15 `duo send`).
   *  Mutually exclusive with kind='claude' auto-launch in v1: if both
   *  apply, --cmd wins (the user's explicit string is more specific). */
  cmd?: string
}

export interface NewTabResult {
  reqId: string
  ok: boolean
  id?: string
  kind?: TerminalTabKind
  cwd?: string
  title?: string
  error?: string
}

export interface ElectronPinsAPI {
  /** Read the current pin list from ~/.claude/duo/pins.json. Returns
   *  an empty list if the file doesn't exist (first launch). */
  list: () => Promise<PinEntry[]>
  /** Toggle a pin: add the entry if not present (matched by kind+ref),
   *  remove it if present. Returns the resulting full list. */
  toggle: (entry: PinEntry) => Promise<PinEntry[]>
}

// Stage 26 PR 2 (ENH-010) — navigator pins (separate from Stage 24's
// tab pins). Same atomic-write JSON pattern, different storage file
// (~/.claude/duo/nav-pins.json), different UI surface (navigator's
// bottom section, not the WorkingPane strip).
export interface ElectronNavPinsAPI {
  list: () => Promise<NavPinEntry[]>
  /** Toggle a nav pin: add if absent (matched by absolute path),
   *  remove if present. Returns the resulting full list. */
  toggle: (entry: NavPinEntry) => Promise<NavPinEntry[]>
  /** BUG-030 — subscribe to nav-pin state changes (UI- or CLI-driven).
   *  Returns an unsubscribe function. */
  onChange: (cb: (pins: NavPinEntry[]) => void) => () => void
}

// Stage 18 — first-launch self-install state. The "installed"
// provenance lives at ~/.claude/duo/installed.json with a version +
// timestamp; absence of that file means we've never set up this
// user's ~/.claude/ for Duo. Phase 1 copies skill + subagent + help
// + external-domains scaffold. Phase 2 adds the `duo` CLI binary
// install to ~/.local/bin/duo (no sudo needed; user-owned bin dir).
export interface InstallStatus {
  installed: boolean
  /** Version recorded in installed.json (Duo's package.json version
   *  at the time of install). Undefined when never installed. */
  version?: string
  /** ISO timestamp from installed.json. */
  installedAt?: string
  /** True if a Duo version is installed but older than the running
   *  build — surface an "Update?" affordance. */
  needsUpdate?: boolean
  /** Stage 18 Phase 2 — CLI binary install state. Tracked separately
   *  from the skill/agent state because PATH can change without us
   *  re-running install (user edits .zshrc), and because we want to
   *  surface a tailored hint when the binary is installed but its
   *  dir isn't on $PATH. */
  cli?: CliInstallStatus
  /** Stage 19b — passive priming state (SessionStart hook + bundled
   *  priming.md). Tracked separately from the skill/agent state because
   *  the user can edit ~/.claude/settings.json by hand and we want
   *  the renderer to surface "your hook is missing — re-run install?"
   *  hints accurately. */
  priming?: PrimingInstallStatus
}

export interface CliInstallStatus {
  /** True if the duo binary file exists at the install path. */
  installed: boolean
  /** Absolute path to the installed binary
   *  (default: `<HOME>/.local/bin/duo`). */
  path?: string
  /** True if the binary's parent dir is in the user's $PATH at app
   *  boot. False means the user needs to add it via shell-rc. */
  onPath: boolean
}

// Stage 23 — Canvas actions. A discriminated union of the v1
// vocabulary the canvas runtime can dispatch: `claude:spawn` (open
// a new claude tab, optionally with a CWD or a pre-typed cmd
// payload), `terminal:send` (write text into the active PTY, with
// an optional Enter), `browser:open` (open a URL in a new browser
// tab — uses the existing duo-open / external routing logic so
// off-host hosts in external-domains.json punt to the system
// browser). Trust gating + feedback ribbons live in the canvas-side
// runtime module (renderer/components/HtmlCanvas/canvasActions.ts);
// host-side dispatch lives in App.tsx via WorkingPane → CanvasTab's
// onCanvasAction prop.
//
// Stage 27 — Canvas authoring vocabulary expansion. Six additional
// verbs let an authored canvas drive the wider Duo surface (open a
// file in the editor / canvas / browser, reveal in the navigator,
// scroll to a selection, flip the theme, focus the active terminal,
// emit an arbitrary event for `duo events --follow` consumers).
// These power the lesson packs that ship in Stage 28; the primitives
// land here so tutorial canvases never need bespoke renderer code.
// All verbs inherit the path-restricted trust gate from Stage 23.
export type CanvasAction =
  | { kind: 'claude:spawn'; cwd?: string; cmd?: string }
  | { kind: 'terminal:send'; text: string; enter?: boolean }
  | { kind: 'browser:open'; url: string }
  | { kind: 'editor:open'; path: string; mode?: 'editor' | 'canvas' | 'browser' }
  | { kind: 'nav:reveal'; path: string }
  | {
      kind: 'selection:set'
      target: 'editor' | 'canvas'
      text?: string
      line?: number
      anchor?: string
    }
  | { kind: 'theme:set'; mode: 'light' | 'dark' | 'system' }
  | { kind: 'terminal:focus'; tabId?: string }
  | { kind: 'duo:event'; event: string; payload?: Record<string, unknown> }

// Stage 19b — passive priming. Two delivery mechanisms:
//
//   1. PATH shim at ~/.claude/duo/bin/claude (load-bearing). Every PTY
//      Duo spawns prepends ~/.claude/duo/bin to PATH so any `claude`
//      invocation inside a Duo terminal hits this wrapper, which calls
//      the real binary with `--append-system-prompt "$(cat priming.md)"`.
//      Outside Duo it's a pass-through.
//   2. SessionStart hook in ~/.claude/settings.json (safety net).
//      `cat`s priming.md when DUO_SESSION is set. We can't rely on
//      hooks (users disable them, settings.json gets reset, certain
//      CLI flags skip them), so this is redundancy on top of the shim.
//
// Both reference the same source-of-truth `priming.md` at
// ~/.claude/duo/priming.md (bootstrap-only on install — never clobber
// a user-edited copy). The hook block is tagged with a `_duo` marker
// so re-installs can find + replace it idempotently without touching
// unrelated hook entries. The shim is fully overwritten on re-install
// (it's owned by Duo; the user shouldn't edit it).
export interface PrimingInstallStatus {
  /** True if ~/.claude/duo/priming.md exists at the install path. */
  primingFile: boolean
  /** True if the load-bearing PATH shim file exists + is executable
   *  at ~/.claude/duo/bin/claude. */
  shimInstalled: boolean
  /** Absolute path to the real `claude` binary that the shim execs.
   *  Resolved via a login shell at install time. Undefined if the
   *  install couldn't find Claude Code on the user's PATH (the shim
   *  is then skipped, and the SessionStart hook is the only priming
   *  mechanism — strictly worse, but workable). */
  realClaudePath?: string
  /** True if a duo-managed SessionStart hook entry exists in
   *  ~/.claude/settings.json. Hook is the redundant safety net; the
   *  shim is load-bearing. */
  hookInstalled: boolean
  /** Version tag on the duo-managed hook block (e.g. "managed-v0.3.0").
   *  Used for upgrade detection on re-install. */
  hookVersion?: string
  /** True if a non-Duo SessionStart hook entry already exists. We
   *  don't overwrite — the install adds the duo-tagged entry alongside
   *  it. Surface this so the user knows priming may interleave with
   *  whatever else they had configured. */
  hookConflict: boolean
}

export interface InstallResult {
  ok: boolean
  /** When ok=true, the new InstallStatus the renderer should show. */
  status?: InstallStatus
  /** When ok=false, a short user-readable explanation. */
  error?: string
  /** Stage 21e-iii — relative paths under ~/.claude/ that the install
   *  service WANTED to overwrite but the user's on-disk version
   *  differed from the previously-recorded SHA. We left those files
   *  alone; the user's customizations are preserved. The renderer
   *  surfaces this in the install-result banner so the user knows
   *  which of their edits survived (and which Duo-shipped updates
   *  they're missing). Empty array = all writable files were either
   *  unchanged or freshly created. */
  preservedConflicts?: string[]
}

export interface ElectronInstallAPI {
  /** Read installed.json to determine whether this user's ~/.claude/
   *  has been bootstrapped for Duo. Cheap (single file stat). */
  status: () => Promise<InstallStatus>
  /** Run the install: copy skill + subagent into ~/.claude/, bootstrap
   *  external-domains.json, write installed.json. Idempotent —
   *  re-running on an already-installed system overwrites the skill
   *  + subagent (useful for upgrades) and rewrites installed.json. */
  run: () => Promise<InstallResult>
  /** ENH-017 — append a fenced PATH block to the user's shell rc so
   *  `~/.local/bin` (where the CLI lives) is on PATH. Idempotent: if
   *  the fence is already present, returns ok without rewriting. */
  addToShellPath: () => Promise<AddToShellPathResult>
}

export interface AddToShellPathResult {
  ok: boolean
  /** When ok: absolute path to the rc file we wrote to (or detected
   *  the fenced block in). The renderer shows it in the success copy
   *  so the user knows which file to `source`. */
  rcFile?: string
  /** When ok: the shell family we detected. */
  shell?: 'zsh' | 'bash' | 'fish'
  /** When ok: true if the fenced block was already present (we did
   *  nothing); false if we appended it just now. */
  alreadyPresent?: boolean
  /** When ok=false: short user-readable explanation. */
  error?: string
}

// Stage 25 (v0.4.0) — post-redirect chrome banner payload. Pushed
// from main on `IPC.EXTERNAL_REDIRECTED` after a successful
// `shell.openExternal` call. The renderer surfaces a small auto-
// dismissing banner above the WorkingPane.
export interface ExternalRedirectedPush {
  /** The hostname the URL was redirected to. */
  host: string
  /** Optional per-domain reason text from external-domains.json's
   *  extended-schema entries (`{host, reason?}` form). Surfaces in
   *  the banner under the main message when present. */
  reason?: string
}

// v0.4.0 — GitHub Releases update checker.
export interface UpdateCheckResult {
  /** Duo's running version (`app.getVersion()`). */
  current: string
  /** Latest tag on GitHub Releases (without leading `v`), or null
   *  if the check hasn't completed / failed. */
  latest: string | null
  /** True when latest > current per semver-style comparison. */
  updateAvailable: boolean
  /** Browser URL of the release page. Null when unknown. */
  releaseUrl: string | null
  /** ISO timestamp of the last successful fetch. Null when the
   *  cache is empty. */
  lastChecked: string | null
}

export interface ElectronUpdateAPI {
  /** Get the current cached update-availability snapshot. Refreshes
   *  from GitHub if the cache is older than the check interval (6h)
   *  or empty; returns immediately on the cached value otherwise. */
  check: () => Promise<UpdateCheckResult>
}

// Stage 25 (v0.4.0) — post-redirect chrome banner subscription.
export interface ElectronExternalAPI {
  /** Subscribe to "external URL redirected" events fired after a
   *  successful `shell.openExternal` from the duo subagent (or
   *  anywhere else main calls into it). Returns an unsubscribe fn. */
  onRedirected: (cb: (push: ExternalRedirectedPush) => void) => () => void
}

// v0.4.0 — app-menu accelerator pushes. Currently just the
// "Paste and Match Style" item in the Edit menu (ENH-002 follow-up
// — the keyboard chord ⌘⇧V is handled editor-locally; this is the
// menu surface for discoverability).
export interface ElectronAppMenuAPI {
  /** Subscribe to "Paste and Match Style" menu invocations. The
   *  editor with keyboard focus performs a plain-text paste; other
   *  editors no-op. Returns an unsubscribe fn. */
  onPastePlainRequest: (cb: () => void) => () => void
}

// Stage 21c — session state restored across Duo relaunches.
// ~/.claude/duo/session-state.json. Renderer pulls on mount,
// debounce-saves on every state change.
export interface ElectronSessionStateAPI {
  /** Read the persisted session state. Returns the empty state on
   *  first launch / corrupt-file / missing-file conditions — never
   *  rejects. */
  load: () => Promise<SessionState>
  /** Push the current state. Coalesced + debounced in main; safe to
   *  call on every state change without thrash. */
  save: (state: SessionState) => Promise<void>
}

export interface ElectronAPI {
  env: ElectronEnv
  pty: ElectronPtyAPI
  browser: ElectronBrowserAPI
  files: ElectronFilesAPI
  nav: ElectronNavAPI
  editor: ElectronEditorAPI
  canvas: ElectronCanvasAPI
  cozy: ElectronCozyAPI
  layout: ElectronLayoutAPI
  theme: ElectronThemeAPI
  selectionFormat: ElectronSelectionFormatAPI
  terminal: ElectronTerminalAPI
  keyboard: ElectronKeyboardAPI
  pins: ElectronPinsAPI
  navPins: ElectronNavPinsAPI
  install: ElectronInstallAPI
  update: ElectronUpdateAPI
  external: ElectronExternalAPI
  appMenu: ElectronAppMenuAPI
  sessionState: ElectronSessionStateAPI
  events: ElectronEventsAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
