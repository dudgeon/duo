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
  // ENH-014 (v0.5.2 sprint) — set split-pane percentage. Mirrors
  // the View → Pane size menu and ⌘⌥1/2/3 keyboard accelerators.
  // Clamps to the 20–80 range the divider drag uses.
  | 'split'

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

  SKILLS_SCAN: 'skills:scan',
  SKILLS_RESULT: 'skills:result',

  // Stage 10 — file navigator + previewers
  FILES_LIST: 'files:list',
  FILES_READ: 'files:read',
  FILES_WRITE: 'files:write',            // Stage 11 — editor-driven save
  FILES_OPEN_EXTERNAL: 'files:open-external',
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
  // ENH-016 — create a directory (used by the navigator's "New
  // folder…" context-menu entry).
  FILES_MKDIR: 'files:mkdir',
  // Stage 26 PR 3 item 8 — path-kind probe for the editable
  // breadcrumb's resolution logic.
  FILES_KIND: 'files:kind',

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

  // Stage 19c D27 — `duo new-tab` from the CLI. Main forwards the
  // request (kind/cwd/cmd) to the renderer; renderer adds the tab and
  // ships the result back so the socket can return {id, kind, cwd, title}.
  NEW_TAB_REQUEST: 'terminal:new-tab-request',
  NEW_TAB_RESULT: 'terminal:new-tab-result',

  // ENH-014 (v0.5.2 sprint) — split-pane percentage push. Driven by
  // View → Pane size menu, ⌘⌥1/2/3/0/9 accelerators, and `duo split
  // <pct>`. Renderer clamps to 20–80 (same range as divider drag).
  SPLIT_SET: 'split:set'
} as const


// ── Re-exports (Stage A Move 3) ──────────────────────────────────────────────
// The renderer host contract was moved to shared/host-api.ts. Re-exported
// here so existing `import { ElectronAPI, ... } from '../shared/types'
// continues to work unchanged.
export * from './host-api'
