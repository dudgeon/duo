// ── Tab / terminal session ───────────────────────────────────────────────────

export interface TabSession {
  id: string
  title: string
  cwd: string
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
  // Stage 11 § D33d — theme
  | 'theme'
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
}

// ── Working-pane tabs (Stage 10 § D25/D26) ───────────────────────────────────
// The right column is a polymorphic tabbed surface that holds mixed types.
// Browser tabs are real WebContentsView-backed; editor / preview tabs are
// rendered in-renderer. Tab IDs are continuous 1..N across types so `duo tab
// <n>` / `duo close <n>` stay simple.

export type WorkingTabType =
  | 'browser'
  | 'editor'             // Stage 11 — rich-text markdown editor
  | 'markdown-preview'   // Stage 10 v1 read-only .md (kept as a fallback)
  | 'image'
  | 'pdf'
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

// ── Skills panel ─────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string
  path: string
  source: 'SKILL.md' | 'CLAUDE.md' | '.claude/skills'
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
  expanded: string[]                    // absolute paths
  pinned: boolean
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
// kinds today, with a fourth (`html-canvas`) reserved for Stage 17.
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

/** Markdown editor (Stage 11) selection — TipTap/ProseMirror-backed. */
export type MarkdownSelectionSnapshot = EditorSelectionSnapshot & { kind: 'editor' }

/** HTML canvas (Stage 17 H25) selection — iframe contentEditable + DOM
 *  observer. Reserved 2026-04-26 in Stage 13 Phase 0 so the union shape
 *  is locked before Stage 15 ships. No producer until Stage 17. */
export interface HtmlCanvasSelectionSnapshot {
  kind: 'html-canvas'
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

/**
 * @deprecated Renamed to `MarkdownSelectionSnapshot` 2026-04-26 for symmetry
 * with `BrowserSelectionSnapshot` and `HtmlCanvasSelectionSnapshot`. Existing
 * call sites can keep using this alias until they're migrated.
 */
export type EditorSelectionTagged = MarkdownSelectionSnapshot

export type DuoSelection =
  | MarkdownSelectionSnapshot
  | BrowserSelectionSnapshot
  | HtmlCanvasSelectionSnapshot
  | null

// Stage 11 § D33d — theme state mirrored between renderer (owner) and main
// (cache) so `duo theme` can read without a renderer RPC, and set by
// dispatching a THEME_SET back down.
export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeStateSnapshot {
  mode: ThemeMode
  effective: 'light' | 'dark'
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

export interface SelectionFormatStateSnapshot {
  format: SelectionFormat
}

// ── IPC channel names (renderer ↔ main) ─────────────────────────────────────

export const IPC = {
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_KILL: 'pty:kill',
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
  BROWSER_FOCUS_ACTIVE: 'browser:focus-active',

  // Main → renderer
  BROWSER_STATE: 'browser:state',
  BROWSER_TABS: 'browser:tabs',
  // Stage 15.2 — live selection push from the page-side observer
  BROWSER_SELECTION: 'browser:selection',

  SKILLS_SCAN: 'skills:scan',
  SKILLS_RESULT: 'skills:result',

  // Stage 10 — file navigator + previewers
  FILES_LIST: 'files:list',
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',            // Stage 11 — editor-driven save
  FILES_OPEN_EXTERNAL: 'files:open-external',
  FILES_REVEAL_IN_FINDER: 'files:reveal-in-finder',
  FILES_WATCH_START: 'files:watch-start',
  FILES_WATCH_UPDATE: 'files:watch-update',
  FILES_WATCH_STOP: 'files:watch-stop',
  FILES_CHANGED: 'files:changed',        // main → renderer push

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

  // Stage 11 § D33d — theme state + agent override
  THEME_STATE_PUSH: 'theme:state-push',  // renderer → main (cache state)
  THEME_SET: 'theme:set',                // main → renderer (CLI-driven override)

  // Stage 15 G19 — Send → Duo payload format (agent-tunable runtime knob)
  SELECTION_FORMAT_STATE_PUSH: 'selection-format:state-push',  // renderer → main
  SELECTION_FORMAT_SET: 'selection-format:set',                // main → renderer

  // Stage 15 G17 — active terminal id push so `duo send` knows where to write
  TERMINAL_ACTIVE_PUSH: 'terminal:active-push',                // renderer → main

  // Stage 9 — cozy mode
  COZY_TOGGLE: 'cozy:toggle',            // main → renderer (menu clicked)
  COZY_STATE_PUSH: 'cozy:state-push',    // renderer → main (update menu checkmark)

  // Cmd-shortcuts pressed while the browser WebContentsView has focus.
  // Forwarded so the renderer can process them identically to native
  // window-focus keydowns (the WebContentsView swallows them otherwise).
  BROWSER_KEY_FORWARD: 'browser:key-forward',

  // ⌘` — fired by the app-menu accelerator so it beats macOS's built-in
  // "cycle windows" system shortcut.
  PANE_TOGGLE_FOCUS: 'pane:toggle-focus'
} as const

// ── Electron preload API surface ─────────────────────────────────────────────

export interface ElectronEnv {
  HOME: string
  SHELL: string
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
  getState: () => Promise<BrowserState>
  getTabs: () => Promise<BrowserTab[]>
  addTab: (url?: string) => Promise<{ ok: boolean; id: number; url: string; title: string }>
  switchTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  closeTab: (id: number) => Promise<{ ok: boolean; error?: string }>
  /** Move keyboard focus to the active browser view. */
  focusActive: () => void
  onStateChange: (cb: (state: BrowserState) => void) => () => void
  onTabsChange: (cb: (tabs: BrowserTab[]) => void) => () => void
  /** Stage 15.2 — live selection push from the page-side observer. */
  onSelection: (cb: (push: BrowserSelectionPush) => void) => () => void
}

export interface FileWriteResult {
  ok: true
  size: number
  mtimeMs: number
}

export interface ElectronFilesAPI {
  list: (path: string) => Promise<DirEntry[]>
  read: (path: string) => Promise<FileReadResult>
  /** Stage 11 — write a file atomically (tmp + rename). Creates parent dirs
   *  if needed. Caller sends raw bytes. */
  write: (path: string, bytes: Uint8Array) => Promise<FileWriteResult>
  openExternal: (path: string) => Promise<void>
  revealInFinder: (path: string) => Promise<void>
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
}

export interface ElectronKeyboardAPI {
  /** Fires when the browser WebContentsView intercepts a Duo shortcut
   *  and forwards it back to the renderer for handling. */
  onBrowserKey: (cb: (e: ForwardedKeyEvent) => void) => () => void
  /** Fires when the View → Toggle pane focus menu accelerator
   *  (⌘`) is triggered. */
  onPaneToggleFocus: (cb: () => void) => () => void
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

export interface ElectronThemeAPI {
  /** Renderer pushes the current theme state so `duo theme` can return
   *  it without a renderer round-trip. */
  pushState: (snapshot: ThemeStateSnapshot) => void
  /** Subscribe to `duo theme <mode>` commands from the CLI. */
  onSet: (cb: (mode: ThemeMode) => void) => () => void
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
   *  terminal tabs exist) so `duo send` knows where to write the
   *  payload. */
  pushActiveId: (id: string | null) => void
}

export interface ElectronAPI {
  env: ElectronEnv
  pty: ElectronPtyAPI
  browser: ElectronBrowserAPI
  files: ElectronFilesAPI
  nav: ElectronNavAPI
  editor: ElectronEditorAPI
  cozy: ElectronCozyAPI
  theme: ElectronThemeAPI
  selectionFormat: ElectronSelectionFormatAPI
  terminal: ElectronTerminalAPI
  keyboard: ElectronKeyboardAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
