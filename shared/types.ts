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
  // Stage 17a (HTML canvas) — `duo html new <path>` creates a fresh
  // .html file from boilerplate (PRD H17, minimal v1) and opens it in
  // the canvas tab. Other `duo html *` verbs land in 17b/17c.
  | 'html-new'
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
  | 'html-canvas'        // Stage 17a — rendered + editable .html
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
  // Stage 24 — pinned tabs render with a pin icon, sort to leftmost,
  // and gate ⌘W behind a confirm modal. Pin identity is stable across
  // sessions (browser tabs by URL, file tabs by absolute path); the
  // pinned flag is computed by WorkingPane against the persisted
  // pins.json each render.
  pinned?: boolean
}

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
}

export interface SessionStateFileTab {
  /** Absolute path to the file. Restored tabs reload the buffer from
   *  disk on first render; unsaved-edit recovery is out of scope for
   *  v1 (would need an autosave layer). */
  path: string
  /** WorkingTabType minus 'browser'. Mirrors the FileTab.type field. */
  type: 'editor' | 'html-canvas' | 'markdown-preview' | 'image' | 'pdf' | 'unknown'
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

// ── Stage 17b Phase C — `duo html *` op surface ────────────────────────────
// Single discriminated request shape so the IPC channel + main-process
// pairing logic stays simple. Renderer's CanvasTab dispatches each op
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
// HTML document. Renderer's CanvasTab subscribes to a dedicated channel so
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
  FILES_GET_HTML_META: 'files:get-html-meta',  // pre-flight for <meta duo-open-in> routing

  // Stage 24 — pinned WorkingPane tabs persisted to ~/.claude/duo/pins.json.
  PINS_LIST: 'pins:list',
  PINS_TOGGLE: 'pins:toggle',

  // Stage 21c — session state restored across relaunches
  // (~/.claude/duo/session-state.json). Renderer pulls on mount,
  // debounce-saves on each change. Persists terminal CWDs, file
  // tabs, browser tabs, navigator path so reload feels like
  // resuming, not starting over.
  SESSION_STATE_LOAD: 'session-state:load',
  SESSION_STATE_SAVE: 'session-state:save',

  // Stage 18 — first-launch self-install (skill + subagent + provenance).
  INSTALL_STATUS: 'install:status',
  INSTALL_RUN: 'install:run',

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

  // Stage 17b Phase C — agent ops against the active HTML canvas.
  CANVAS_HTML_OP: 'canvas:html-op',               // main → renderer (apply / read)
  CANVAS_HTML_OP_RESULT: 'canvas:html-op-result', // renderer → main (reply)

  // Stage 17c — canvas selection snapshot push from the renderer. Mirrors
  // `EDITOR_SELECTION_PUSH` for the html-canvas surface so `duo selection
  // --pane canvas` can read without a renderer round-trip.
  CANVAS_SELECTION_PUSH: 'canvas:selection-push', // renderer → main (cache)

  // Stage 17d — `duo html comment` (write) + `duo html comments` (read).
  // Comments live in the sidecar JSON; renderer is the only authoritative
  // source. Mirror the html-op channel pair pattern.
  CANVAS_HTML_COMMENT: 'canvas:html-comment',                 // main → renderer
  CANVAS_HTML_COMMENT_RESULT: 'canvas:html-comment-result',   // renderer → main
  CANVAS_HTML_COMMENTS_LIST: 'canvas:html-comments-list',     // main → renderer
  CANVAS_HTML_COMMENTS_LIST_RESULT: 'canvas:html-comments-list-result', // renderer → main

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
  PANE_TOGGLE_FOCUS: 'pane:toggle-focus',

  // Stage 19c D27 — `duo new-tab` from the CLI. Main forwards the
  // request (kind/cwd/cmd) to the renderer; renderer adds the tab and
  // ships the result back so the socket can return {id, kind, cwd, title}.
  NEW_TAB_REQUEST: 'terminal:new-tab-request',
  NEW_TAB_RESULT: 'terminal:new-tab-result'
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

export interface HtmlFileMeta {
  /** `<meta name="duo-open-in" content="...">` — declarative routing hint
   *  for HTML files. `browser` opens the file in a browser tab (file://
   *  URL); `canvas` opens in the editable HTML canvas. Undefined = no
   *  preference, fall through to the classifier's default (canvas). */
  openIn?: 'browser' | 'canvas'
  /** `<meta name="duo-editable" content="false">` — when false, the
   *  canvas mounts read-only (no contentEditable, toolbar, comment
   *  composer, or ID-injection probe). Honored regardless of where the
   *  file ends up routing to. */
  editable?: boolean
}

export interface ElectronFilesAPI {
  list: (path: string) => Promise<DirEntry[]>
  read: (path: string) => Promise<FileReadResult>
  /** Stage 11 — write a file atomically (tmp + rename). Creates parent dirs
   *  if needed. Caller sends raw bytes. */
  write: (path: string, bytes: Uint8Array) => Promise<FileWriteResult>
  openExternal: (path: string) => Promise<void>
  revealInFinder: (path: string) => Promise<void>
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
  /** Stage 19c D23 — `true` if `claude` was found on PATH at app boot
   *  (or last refresh). Used to decide between auto-typing `claude\n`
   *  and printing the install banner when a `kind: 'claude'` tab spawns. */
  claudeOnPath: () => Promise<boolean>
  /** Stage 19c D27 — subscribe to `duo new-tab` requests from the CLI.
   *  Renderer adds the tab and replies via `replyNewTab`. */
  onNewTabRequest: (cb: (req: NewTabRequest) => void) => () => void
  /** Reply to a new-tab request with the resolved tab metadata. */
  replyNewTab: (result: NewTabResult) => void
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
export type CanvasAction =
  | { kind: 'claude:spawn'; cwd?: string; cmd?: string }
  | { kind: 'terminal:send'; text: string; enter?: boolean }
  | { kind: 'browser:open'; url: string }

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
  theme: ElectronThemeAPI
  selectionFormat: ElectronSelectionFormatAPI
  terminal: ElectronTerminalAPI
  keyboard: ElectronKeyboardAPI
  pins: ElectronPinsAPI
  install: ElectronInstallAPI
  update: ElectronUpdateAPI
  external: ElectronExternalAPI
  appMenu: ElectronAppMenuAPI
  sessionState: ElectronSessionStateAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
