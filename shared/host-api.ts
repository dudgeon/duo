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
  DocEditPlainRequest, DocEditPlainResult,
  JsonOpRequest, JsonOpResult,
  HtmlOpRequest, HtmlOpResult, PageSelectionSnapshot,
  HtmlCommentRequest, HtmlCommentResult,
  HtmlCommentsListRequest, HtmlCommentsListResult,
  ThemeMode, ThemeStateSnapshot,
  AuthorStateSnapshot,
  ClaudeKeyPrefsSnapshot,
  SelectionFormat, SelectionFormatStateSnapshot,
  PinEntry, NavPinEntry,
  SessionState,
} from './types'

// ── Electron preload API surface ─────────────────────────────────────────────

export interface ElectronEnv {
  HOME: string
  SHELL: string
  /** OS username — used as the default human author identity when
   *  localStorage('duo:author') hasn't been set yet (BUG-138 Phase 2). */
  USER: string
  /** Duo's package.json `version` field, populated at preload time
   *  via `app.getVersion()`. Surfaces in the titlebar so the user
   *  can confirm which build is running before a smoke walk. */
  appVersion: string
  /** True when running under `npm run dev` (electron-vite's HMR
   *  loop), false in a packaged build. Drives the dev-mode badge
   *  next to the version in the titlebar. */
  isDev: boolean
  /** ENH-191 P4 — THIS renderer's window id (== the main-process registry
   *  id / `mainWindow.id`), fetched once at preload via a synchronous IPC.
   *  Lets per-window localStorage keys (cozy/fontBump/nav) namespace by
   *  window so a second window can't clobber the first's per-tab maps.
   *  -1 only if the boot IPC ever fails (degrades to single shared key). */
  windowId: number
  /** ENH-191 NFR-6.2 — true when this renderer is a BLANK New-Window (opened
   *  via openNewWindow → createWindow({restore:false})). The pin-auto-open
   *  effect in App.tsx gates on `!blank` so a new window does NOT clone the
   *  pinned file tabs. False for the boot/restored windows. Injected
   *  synchronously via the --duo-blank additionalArgument (no IPC race). */
  blank: boolean
}

export interface ElectronPtyAPI {
  create: (id: string, shell?: string, cwd?: string) => Promise<void>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  kill: (id: string) => Promise<void>
  onData: (id: string, cb: (data: string) => void) => () => void
  onExit: (id: string, cb: (code: number) => void) => () => void
  // ENH-187 — best-effort live cwd for a PTY. Returns the shell's
  // CURRENT working directory (where the user has `cd`'d to) via lsof,
  // or null on any failure (lsof missing, dead pid, permission). Used
  // by ⌘T / `duo new-tab` so the new tab opens where the user IS, not
  // where the previous tab LAUNCHED.
  liveCwd: (id: string) => Promise<string | null>
  // BUG-191 — batched live-cwd + liveness for the project rail. For each
  // tab id: `alive:false` = the shell exited (no project membership);
  // `cwd` = the live shell cwd, or null when unknown (fall back to the
  // tab's launch cwd). lsof runs async + in parallel in main, so this
  // never blocks the main thread the way the single `liveCwd` can.
  liveCwds: (ids: string[]) => Promise<Record<string, { alive: boolean; cwd: string | null }>>
  // Note: tab titles come from xterm.js Terminal.onTitleChange() (OSC sequences),
  // not via IPC — no main-process emit needed.
}

export interface ElectronBrowserAPI {
  navigate: (url: string) => Promise<{ ok: boolean; url: string; title: string }>
  back: () => void
  forward: () => void
  reload: () => void
  setBounds: (bounds: BrowserBounds) => void
  /** Phase 3c — bounds for the aux-pinned browser tab (Split View).
   *  Renderer's AuxBrowserSlot pushes on mount + ResizeObserver +
   *  window resize + split divider drag. Stored separately from
   *  setBounds inside BrowserManager so the main strip and aux pane
   *  can have independent geometry. */
  setAuxBounds: (bounds: BrowserBounds) => void
  /** Phase 3c — pin a browser tab into the Split View aux slot.
   *  Removes it from the main tab strip's rotation. Returns the
   *  pinned tab's url + title so the AuxBrowserSlot header can
   *  display them without a second round trip. */
  moveTabToAux: (id: number) => Promise<{ ok: boolean; error?: string; url?: string; title?: string }>
  /** Phase 3c — release the aux-pinned tab back to the main strip.
   *  The released tab becomes main-strip active. No-op when no tab
   *  is currently in aux. */
  releaseAuxTab: () => Promise<{ ok: boolean; error?: string }>
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
  /** ENH-094 (Sprint 5) — playground action click in browser pane.
   *  Same shape as the canvas-iframe runtime: a typed `PlaygroundAction`
   *  reaches the renderer and gets dispatched through the existing
   *  `handlePlaygroundAction` handler. Trust gate is applied in main
   *  (BrowserManager) before forwarding — untrusted paths are dropped
   *  with a console warning, never reach the renderer. */
  onPlaygroundAction: (cb: (action: PlaygroundAction) => void) => () => void
  /** ENH-159b — element-inspect mode toggle. Accepts a boolean or
   *  'toggle'. Main is source of truth; pushes back via
   *  `onInspectMode` so the toolbar (when it lands) reflects the
   *  state without polling. */
  setInspectMode: (mode: boolean | 'toggle') => void
  /** ENH-159b — main → renderer push of the canonical inspect-mode
   *  state. Fires on every flip (renderer call OR page-side ESC). */
  onInspectMode: (cb: (active: boolean) => void) => () => void
  /** ENH-159b — main → renderer push of the captured element snapshot
   *  the user clicked while in inspect mode. `null` means the user
   *  pressed ESC to exit without picking. The renderer formats the
   *  snapshot via `formatBrowserInspectPayload` and routes it to the
   *  active terminal — same egress path as `onSendToDuoClick`. */
  onInspectClick: (cb: (snapshot: import('./types').BrowserInspectSnapshot | null) => void) => () => void
}

export interface FileWriteResult {
  ok: true
  size: number
  mtimeMs: number
}

/** ENH-111 (Sprint 12) — payload for `files.stat`. Returned for
 *  regular files; null when the path doesn't exist or stat throws. */
export interface FileStatResult {
  size: number
  mtimeMs: number
}

/** ENH-108 (Sprint 12) — payload for `files.saveImageBeside`. Renderer
 *  hands main raw image bytes + active doc path + extension; main
 *  generates a unique filename, writes alongside, returns the absolute
 *  path the editor uses to compose the markdown link. `relPath` is the
 *  path RELATIVE to the active doc — that's what gets serialized into
 *  the doc as `![](image-...)` so moving the doc + adjacent image as
 *  a unit doesn't break the link. */
export interface FileSaveImageBesideResult {
  absPath: string
  relPath: string
  size: number
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
  /** FOLLOWUP-026 — renamed from openExternal: opens a local file
   *  path via shell.openPath (the OS picks the default app for that
   *  extension). Distinct from openExternalUrl which is for URLs. */
  openPath: (path: string) => Promise<void>
  /** BUG-132 — open an http/https/mailto URL via shell.openExternal.
   *  Distinct from openPath (which routes through shell.openPath
   *  for local file paths). Used by the Navigator's right-click
   *  "Open on GitHub" + future URL-opening surfaces. */
  openExternalUrl: (url: string) => Promise<{ ok: boolean; opened?: string; error?: string }>
  revealInFinder: (path: string) => Promise<void>
  /** Stage 26 item 6 — move to macOS Trash (recoverable from Finder). */
  trash: (path: string) => Promise<void>
  /** Stage 26 item 6 — rename / move within the same filesystem. */
  rename: (oldPath: string, newPath: string) => Promise<void>
  /** BUG-039 — lightweight existence check (regular file). Used by
   *  session-restore hydration to drop tabs whose files were
   *  deleted between sessions. */
  exists: (path: string) => Promise<boolean>
  /** ENH-096 v2 (Sprint 9 walk-1 fix) — directory-aware existence
   *  probe. `exists` strictly returns true only for regular files
   *  (BUG-039 semantic); this one returns true only for directories.
   *  Used by the wikilink vault-root walker to detect `.obsidian/`. */
  dirExists: (path: string) => Promise<boolean>
  /** ENH-016 — create a directory (recursive — parents created if
   *  missing). Used by the navigator's "New folder…" context-menu
   *  entry. */
  mkdir: (path: string) => Promise<void>
  /** Stage 26 PR 3 item 8 — path-kind probe for the editable
   *  breadcrumb's resolution logic. Returns 'file' / 'folder' /
   *  null. Symlinks resolve through to the target. */
  kind: (path: string) => Promise<'file' | 'folder' | null>
  /** ENH-111 (Sprint 12) — file size + mtime probe for the image
   *  viewer chrome's "1440 × 900 · 312 KB" readout. Returns null
   *  when the path doesn't exist or isn't a regular file. */
  stat: (path: string) => Promise<FileStatResult | null>
  /** ENH-108 (Sprint 12) — write a clipboard-image (or any byte
   *  buffer) to disk beside the active doc. `activeDocPath` is the
   *  doc currently in the editor; `parentDir = dirname(activeDocPath)`
   *  is the write target. Filename is generated by main as
   *  `image-<YYYYMMDD-HHMMSS>-<4charhash>.<ext>` (timestamp-prefix +
   *  random suffix → sortable + collision-free even for rapid
   *  successive pastes). Returns absolute + relative paths plus the
   *  on-disk size. Caller composes the markdown / HTML insertion
   *  using `relPath`. */
  saveImageBeside: (activeDocPath: string, bytes: Uint8Array, ext: string, prefix?: string) => Promise<FileSaveImageBesideResult>
  /** ENH-128 (Sprint 14) — transcode HEIC / HEIF / RAW source bytes
   *  to PNG (default) or JPEG (HEIC source). Lives in main because
   *  Electron's nativeImage API isn't available in the renderer.
   *  Returns the converted bytes + new extension; caller follows up
   *  with `saveImageBeside(..., result.bytes, result.ext)`. Throws
   *  when the source bytes can't be decoded by the platform. */
  convertImageBytes: (bytes: Uint8Array, sourceMime: string) => Promise<{ bytes: Uint8Array; ext: string }>
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
   *
   * ENH-195 B2/B4 — `opts.ignored` overrides the default
   * `.git`/`.obsidian`/`node_modules` ignore globs (a single open-file editor
   * passes `[]` so a file inside such a path still watches); `opts.watchParents`
   * additionally watches each path's parent dir at depth 0 to catch
   * atomic-rename / delete saves. Existing callers pass two args unchanged.
   */
  watch: (
    paths: string[],
    cb: (event: FileChangeEvent) => void,
    opts?: { ignored?: (string | RegExp)[]; watchParents?: boolean }
  ) => Promise<() => Promise<void>>
  /** Update the set of watched paths on an existing subscription. */
  updateWatchPaths: (id: string, paths: string[]) => Promise<void>
}

export interface ElectronNavAPI {
  /** Push the latest navigator state into the main-process cache.
   *  Main returns this on `duo nav state`. */
  pushState: (snapshot: NavStateSnapshot) => void
  /** Subscribe to `duo reveal <path>` commands coming in from the CLI. */
  /** Subscribe to "main → renderer" nav-state push (legacy alias).
   *  Subscribe-style callback returning an unsubscribe fn. */
  onReveal: (cb: (path: string) => void) => () => void
  /** Subscribe to `duo view <path>` commands coming in from the CLI.
   *  ENH-097 — `mode` carries an optional override ('canvas' forces
   *  canvas-mode mount even if the file declares `duo-open-in: browser`). */
  onView: (cb: (path: string, mode?: 'canvas' | 'browser') => void) => () => void
  /** Subscribe to `duo edit <path>` commands coming in from the CLI.
   *  See onView for the optional `mode` override. */
  onEdit: (cb: (path: string, mode?: 'canvas' | 'browser') => void) => () => void
  /** FOLLOWUP-020 — close the focused working-pane tab. Renderer
   *  applies the pinned-tab gate (dialog.confirm) + the actual tab-
   *  removal. CLI parity for ⌘W. */
  onCloseActiveWorkingTab: (cb: () => void) => () => void
  /** FOLLOWUP-020 — close a terminal tab. `n` omitted → focused tab;
   *  `n` supplied (1-indexed) → that specific terminal tab. */
  onCloseTerminalTab: (cb: (n?: number) => void) => () => void
  /** FOLLOWUP-025 — File → Clone… modal trigger. Renderer opens the
   *  CloneModal component. v2: optional payload carries a `path` to
   *  pre-populate the modal's parent-dir input (owner Q1 right-click
   *  context wins over Navigator cwd). */
  onOpenCloneModal: (cb: (payload?: { path?: string }) => void) => () => void
  /** FOLLOWUP-025 v2 — renderer-initiated request to open the Clone
   *  modal (Navigator right-click → "Clone GitHub repo here…"). The
   *  main process echoes back via NAV_OPEN_CLONE_MODAL so all
   *  trigger paths (CLI / native menu / right-click) converge on
   *  App.tsx's onOpenCloneModal subscriber. */
  openCloneModal: (opts?: { path?: string }) => void
  /** ENH-169 (Sprint 20) — File → New File… clicked. Renderer
   *  dispatches to its `newMarkdownFile` callback (same one the ⌘N
   *  chord drives). Default location = navigator's current cwd. */
  onNewFileRequest: (cb: () => void) => () => void
  /** ENH-169 (Sprint 20) — File → New Folder… clicked. Renderer
   *  dispatches to its `newFolder` callback (same one the ⌘⇧N
   *  chord drives). Default location = navigator's current cwd. */
  onNewFolderRequest: (cb: () => void) => () => void
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
  /** ENH-108 — `duo image insert <path>` request. The renderer routes
   *  to the active markdown editor, calls `saveImageBeside`, inserts
   *  at caret, and replies via `replyImageInsert`. v1 markdown only. */
  onImageInsert: (cb: (req: import('./types').ImageInsertRequest) => void) => () => void
  replyImageInsert: (result: import('./types').ImageInsertResult) => void
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
  /** ENH-195 — `duo doc edit` surgical PLAIN replace. The active
   *  markdown editor applies the literal find/replace to its live
   *  buffer, kicks an echo-safe save, and replies. Disk-direct path
   *  (file not open) is handled in socket-server, not here. */
  onDocEditPlain: (cb: (req: DocEditPlainRequest) => void) => () => void
  replyDocEditPlain: (result: DocEditPlainResult) => void
}

/** ENH-195 — agent structured edits against the active JSON / YAML
 *  viewer (`duo json set|merge`). Only the active JSON tab subscribes;
 *  if no JSON viewer is open the CLI request resolves disk-direct in
 *  socket-server. Mirrors ElectronCanvasAPI's onHtmlOp/replyHtmlOp. */
export interface ElectronJsonAPI {
  onJsonOp: (cb: (req: JsonOpRequest) => void) => () => void
  replyJsonOp: (result: JsonOpResult) => void
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
  pushSelection: (snapshot: PageSelectionSnapshot | null) => void
  /** Stage 17d — agent comment write. Renderer resolves the anchor,
   *  appends to the sidecar, and replies. */
  onHtmlComment: (cb: (req: HtmlCommentRequest) => void) => () => void
  replyHtmlComment: (result: HtmlCommentResult) => void
  /** Stage 17d — agent comments read. Returns the sorted thread list. */
  onHtmlCommentsList: (cb: (req: HtmlCommentsListRequest) => void) => () => void
  replyHtmlCommentsList: (result: HtmlCommentsListResult) => void
  /** Sprint 6 BUG-081 — fired when the user picks "Comment" from the
   *  canvas right-click menu. The renderer-side bridge re-dispatches
   *  as a 'duo-start-comment' window CustomEvent so the active
   *  PageTab handles it identically to the ⌘⌥M / toolbar paths. */
  onCommentRequest: (cb: () => void) => () => void
}

export interface ElectronKeyboardAPI {
  /** Fires when the browser WebContentsView intercepts a Duo shortcut
   *  and forwards it back to the renderer for handling. */
  onBrowserKey: (cb: (e: ForwardedKeyEvent) => void) => () => void
  /** Fires when the View → Toggle pane focus menu accelerator
   *  (⌘`) is triggered. */
  onPaneToggleFocus: (cb: () => void) => () => void
  /** ENH-098 (Sprint 9) — fires when `duo focus-pane <name>` is
   *  dispatched from the CLI. Payload is the target pane name; the
   *  renderer's focusPane() implements the actual focus shift. */
  onPaneFocusJump: (cb: (target: 'terminal' | 'main' | 'aux') => void) => () => void
  /** BUG-048 v3 — renderer-driven OS focus reclaim. Called by
   *  togglePaneFocus AFTER it has decided direction so the focus
   *  reclaim's xterm-focus-event side-effect doesn't poison the
   *  toggle's prev read. Fires `mainWindow.webContents.focus()`
   *  in the main process. */
  reclaimFocus: () => void
  /** BUG-042 — fires when a browser WebContentsView gains keyboard
   *  focus (click into the page, programmatic focus, etc.). Renderer
   *  flips `focusedColumn = 'working'` so subsequent ⌃Tab / ⌘T fire
   *  against the right pane. Symmetric to the canvas iframe's
   *  mousedown forwarder (BUG-037).
   *
   *  Phase 3c BUG-095 — payload carries `tabId` + `slot` so the
   *  renderer can distinguish a focus event on the aux-pinned tab
   *  from one on the main-strip active tab. The aux slot focusing
   *  should NOT flip activeWorking to 'browser' (it would replace
   *  the main pane's active editor / canvas with a different
   *  browser tab, since the aux'd tab itself is already in aux). */
  onBrowserFocusGained: (cb: (payload: { tabId: number; slot: 'main' | 'aux' }) => void) => () => void
  /** Stage 12 close — Claude just read a selection via `duo selection`.
   *  Carries which pane the resolved selection came from so the
   *  renderer can paint a transient accent glow on the right surface.
   *  No selection content (the agent already has it). */
  onClaudeReadSelection: (cb: (e: { pane: 'editor' | 'browser' | 'page' }) => void) => () => void
}

export interface ForwardedKeyEvent {
  key: string
  /** `KeyboardEvent.code` — modifier-independent physical key. Required
   *  to round-trip chord matchers that use `e.code === 'KeyA'` /
   *  `e.code === 'Slash'` etc. Pre-fix this field was missing and the
   *  synthetic event in useKeyboardShortcuts had `code === ''`, so any
   *  WCV-forwarded chord whose matcher consulted `e.code` silently
   *  dropped (ENH-080 ⌘⇧A bug — palette didn't open from browser-pane
   *  focus, and ⌘⇧/ split-view-promote was similarly broken). */
  code: string
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

// ENH-172 (Sprint 20 / v0.7.7) — show/hide hidden files toggle. Main
// fires `onSet` when the View → Show Hidden Files menu is clicked OR
// when the `duo hidden-files` CLI verb writes. Renderer subscribes,
// applies via useNavigator's setShowDotfiles, persists to localStorage,
// and pushes nav-state. Main reads `showDotfiles` from the next
// NAV_STATE_PUSH to refresh the menu checkmark.
export interface ElectronHiddenFilesAPI {
  /** Subscribe to View → Show Hidden Files clicks and CLI-driven sets.
   *  `value` is true (show) / false (hide) / 'toggle' (renderer flips
   *  the current value). */
  onSet: (cb: (value: boolean | 'toggle') => void) => () => void
}

// ENH-178 (Sprint 20 / v0.7.7) — browser-mode three-state filter.
// Renderer holds the persisted value in localStorage; on boot it
// calls `set(...)` once to push the persisted value back into main.
// CLI changes arrive via `onPush`.
export interface ElectronBrowserModeAPI {
  get: () => Promise<{ mode: 'unfiltered' | 'filtered' | 'local-only' }>
  set: (mode: 'unfiltered' | 'filtered' | 'local-only') => Promise<{ ok: boolean; mode?: string; error?: string }>
  onPush: (cb: (mode: 'unfiltered' | 'filtered' | 'local-only') => void) => () => void
}

export interface ElectronLayoutAPI {
  /** ENH-014 — fires when View → Pane size menu, the ⌘⌥1/2/3/0/9
   *  accelerators, or `duo split <pct>` set the split percentage.
   *  Renderer clamps to 20–80 (matching divider drag). */
  onSplitSet: (cb: (pct: number) => void) => () => void
  /** ENH-099 — fires when the `⌘⌥4` chord, View → Pane size → 3-way
   *  even, or `duo split 3way` requests the canonical 3-pane layout
   *  (outer 33/67 + inner aux 50/50 if aux is open). */
  onLayout3wayEven: (cb: () => void) => () => void
  /** FOLLOWUP-015 — fires when View → View source menu is clicked.
   *  Renderer dispatches the existing `'duo-view-source'` window
   *  event so the same MarkdownEditor + PageTab listeners that handle
   *  the ⌘⌥V chord (owned by globalShortcuts.ts) and the tab-strip
   *  right-click also handle this entry. Payload-free; the listener's
   *  isActive gate decides which surface responds. */
  onViewSourceRequest: (cb: () => void) => () => void
}

// ENH-041 / Sprint 3 — Split View ("aux") API. Renderer is the
// source of truth for aux state; main pushes verbs via the four
// `on*` listeners and caches the renderer's pushed snapshot for the
// CLI's no-arg `duo split-view` state query.
export interface ElectronWorkingAuxAPI {
  /** Renderer pushes the current aux snapshot whenever it changes
   *  (open / close / promote / resize / activeTab change). Main
   *  caches this for the CLI state query. Default `null` (split
   *  closed) until first push. */
  pushState: (snapshot: import('./types').WorkingAuxSnapshot) => void
  /** Subscribe to `duo split-view open <path>` from the CLI. The
   *  path arg is already tilde-expanded by main. */
  onOpen: (cb: (path: string) => void) => () => void
  /** Phase 3c — subscribe to `duo split-view open-browser <id>` from
   *  the CLI. Carries the numeric BrowserTab id; renderer routes
   *  through splitViewMoveBrowserTab. */
  onOpenBrowser: (cb: (browserTabId: number) => void) => () => void
  /** Subscribe to `duo split-view close` from the CLI. */
  onClose: (cb: () => void) => () => void
  /** Subscribe to `duo split-view promote` — move aux's tab to main
   *  and close the split. Mirrors the empty-main edge case (locked
   *  spec § 5.5). */
  onPromote: (cb: () => void) => () => void
  /** Subscribe to `duo split-view resize <pct>` from the CLI. Pct
   *  is a fraction in [0.20, 0.80] (clamped main-side). */
  onResize: (cb: (pct: number) => void) => () => void
}

export interface ElectronThemeAPI {
  /** Renderer pushes the current theme state so `duo theme` can return
   *  it without a renderer round-trip. */
  pushState: (snapshot: ThemeStateSnapshot) => void
  /** Subscribe to `duo theme <mode>` commands from the CLI. */
  onSet: (cb: (mode: ThemeMode) => void) => () => void
}

/** Sprint 16 / v0.6.15 — Claude-tab Enter key preferences bridge.
 *  Mirrors ElectronThemeAPI shape: renderer is the source of truth;
 *  main caches via pushState so the CLI can read; CLI overrides
 *  re-broadcast via onSet (payload is partial — only the keys the
 *  CLI verb touched). */
export interface ElectronClaudeKeyPrefsAPI {
  pushState: (snapshot: ClaudeKeyPrefsSnapshot) => void
  onSet: (cb: (prefs: Partial<ClaudeKeyPrefsSnapshot>) => void) => () => void
}

/** BUG-138 Phase 2 — author identity bridge. Same pattern as
 *  ElectronThemeAPI: renderer owns localStorage; main caches the
 *  current value via pushState so `duo author` can read without a
 *  renderer round-trip; CLI overrides re-broadcast via onSet. */
export interface ElectronAuthorAPI {
  pushState: (snapshot: AuthorStateSnapshot) => void
  onSet: (cb: (author: string) => void) => () => void
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

// ENH-183 C5 — read-only API over Claude session JSONLs for the
// polymorphic SessionHeader. Both methods recompute on every call (no
// cache, D9 invariant). Backed by electron/claude-session-tracker.ts.
export type BannerTitleSource = 'customTitle' | 'aiTitle' | 'jsonl-firstmsg' | 'uuid'
export interface BannerTitleResult { title: string; source: BannerTitleSource }
export interface PriorSessionListing {
  uuid: string
  title: string
  source: BannerTitleSource
  messageCount: number
  modifiedAt: number
}
// ENH-183 pared 2026-05-25 (Option A): MaybeHydrateResult removed along
// with the entire T3 auto-hydration + S2 inline-rename code path.
export interface ElectronSessionAPI {
  readBannerTitle: (uuid: string, cwd: string) => Promise<BannerTitleResult>
  readMessageCount: (uuid: string, cwd: string) => Promise<number>
  listPrior: (cwd: string, opts?: { limit?: number; excludeUuid?: string }) => Promise<PriorSessionListing[]>
}

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
// runtime module (renderer/components/Page/playgroundActions.ts);
// host-side dispatch lives in App.tsx via WorkingPane → PageTab's
// onPlaygroundAction prop.
//
// Stage 27 — Canvas authoring vocabulary expansion. Six additional
// verbs let an authored canvas drive the wider Duo surface (open a
// file in the editor / canvas / browser, reveal in the navigator,
// scroll to a selection, flip the theme, focus the active terminal,
// emit an arbitrary event for `duo events --follow` consumers).
// These power the lesson packs that ship in Stage 28; the primitives
// land here so tutorial canvases never need bespoke renderer code.
// All verbs inherit the path-restricted trust gate from Stage 23.
export type PlaygroundAction =
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
  /** ENH-141 — when the CLI installs successfully but `~/.local/bin`
   *  isn't already on the user's PATH, `run()` auto-wires their shell
   *  rc as part of the same install action (previously a separate
   *  dismissible "Add to PATH" button that users skipped, leaving
   *  them with `duo: command not found` from external terminals).
   *  Undefined if PATH was already wired or the CLI didn't install. */
  pathWiringResult?: AddToShellPathResult
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

// ENH-050 (v0.6.3) — native NSMenu + system sheet primitives.
// `menu.popup()` builds Menu.buildFromTemplate from the items
// template + pops on the active BrowserWindow; the chosen id (or
// null on dismiss) returns to the renderer. `dialog.confirm()`
// calls dialog.showMessageBox with sheet semantics; the response
// button index returns. See `docs/DECISIONS.md § WCV-occlusion
// remediation` for the full rationale.
export interface ElectronMenuAPI {
  popup: (req: import('./types').MenuPopupRequest) => Promise<import('./types').MenuPopupResult>
}
export interface ElectronDialogAPI {
  confirm: (req: import('./types').DialogConfirmRequest) => Promise<import('./types').DialogConfirmResult>
}

// BUG-105 (Sprint 10) — main-process clipboard write. The renderer's
// `navigator.clipboard.writeText` silently rejects when called from
// inside a native NSMenu's `click` handler (the user-gesture window
// closed when the menu opened). Routing through main uses Electron's
// `clipboard` module which has no gesture requirement.
export interface ElectronClipboardAPI {
  writeText: (text: string) => Promise<void>
  /** ENH-111 (Sprint 12) — copy an image file to the system
   *  clipboard. Reads the file in main via `nativeImage.createFromPath`
   *  and writes via Electron's `clipboard.writeImage`. Returns false
   *  when the path doesn't decode as an image (createFromPath returns
   *  an empty native image — we detect via `isEmpty()`). */
  writeImage: (path: string) => Promise<boolean>
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
  /** ENH-167 — main pushes a snapshot-request when it needs the
   *  live SessionState (Save Session bypasses the autosave debounce).
   *  Renderer replies via `snapshotReply(reqId, state)`. */
  onSnapshotRequest: (cb: (reqId: string) => void) => () => void
  snapshotReply: (payload: { reqId: string; state: SessionState }) => void
}

// ENH-167 — workspace-as-file. Mirrors the File menu surface: Save /
// Save As (via opts.saveAs) / Open / Open Recent / New, plus list +
// active queries + clear-recent for the submenu's housekeeping.
export interface ElectronWorkspaceFileAPI {
  save: (opts?: { saveAs?: boolean }) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  open: () => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  openRecent: (path: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  listRecent: () => Promise<import('./types').WorkspaceHistoryEntry[]>
  active: () => Promise<import('./types').ActiveWorkspace | null>
  newWorkspace: () => Promise<{ ok: boolean }>
  clearRecent: () => Promise<{ ok: boolean }>
  /** ENH-167 v1.2 — main pushes when activeWorkspaceService changes
   *  (Save, Save As, Open, New). Drives the in-app titlebar badge. */
  onActiveChanged: (cb: (active: import('./types').ActiveWorkspace | null) => void) => () => void
}

export interface ElectronAPI {
  env: ElectronEnv
  pty: ElectronPtyAPI
  browser: ElectronBrowserAPI
  files: ElectronFilesAPI
  nav: ElectronNavAPI
  editor: ElectronEditorAPI
  canvas: ElectronCanvasAPI
  // ENH-195 — `duo json set|merge` against the active JSON / YAML viewer.
  json: ElectronJsonAPI
  cozy: ElectronCozyAPI
  /** ENH-172 (Sprint 20) — show/hide hidden-files toggle. */
  hiddenFiles: ElectronHiddenFilesAPI
  /** ENH-178 (Sprint 20) — browser-mode three-state filter. */
  browserMode: ElectronBrowserModeAPI
  layout: ElectronLayoutAPI
  workingAux: ElectronWorkingAuxAPI
  theme: ElectronThemeAPI
  // BUG-138 Phase 2 — author identity (CriticMarkup attribution).
  author: ElectronAuthorAPI
  // Sprint 16 / v0.6.15 — Claude-tab Enter key preferences.
  claudeKeyPrefs: ElectronClaudeKeyPrefsAPI
  selectionFormat: ElectronSelectionFormatAPI
  terminal: ElectronTerminalAPI
  keyboard: ElectronKeyboardAPI
  pins: ElectronPinsAPI
  navPins: ElectronNavPinsAPI
  install: ElectronInstallAPI
  update: ElectronUpdateAPI
  external: ElectronExternalAPI
  appMenu: ElectronAppMenuAPI
  // ENH-050 — native menu / sheet primitives.
  menu: ElectronMenuAPI
  dialog: ElectronDialogAPI
  // BUG-105 (Sprint 10) — main-process clipboard, used from
  // context-menu click handlers.
  clipboard: ElectronClipboardAPI
  sessionState: ElectronSessionStateAPI
  // ENH-183 C5 — banner-title + message-count lookups against the
  // Claude JSONL store. Pure reads (D9 invariant).
  session: ElectronSessionAPI
  // ENH-167 — workspace-as-file (Save / Open / Open Recent menu).
  workspaceFile: ElectronWorkspaceFileAPI
  events: ElectronEventsAPI
  // ENH-151 / ENH-152a — GitHub integration: status (Navigator root
  // chip) + clone (File → Clone… modal) + ghAuth (auth probe).
  git: ElectronGitAPI
  // ENH-182 — project marker probe (D2). Used by useProjects to
  // detect `CLAUDE.md` / `.claude/` markers for folders the
  // navigator hasn't scanned (e.g. `~/.claude` when the user opens
  // a file directly under it without navigating there first).
  projects: ElectronProjectsAPI
  // ENH-184 (Sprint 23 / v0.8.0) — workspace-pill click-to-open-menu
  // CLI parity. Renderer pushes flag changes; main pushes CLI writes.
  workspacePillMenu: ElectronWorkspacePillMenuAPI
  // ENH-212 — Home re-entry surface: live snapshot, paged session
  // expander, the session click contract, and the `duo home` /
  // `duo term tab` push subscriptions.
  home: ElectronHomeAPI
}

export interface ElectronProjectsAPI {
  hasMarker(dir: string): Promise<boolean>
  /** Read the persisted slice (pins). Returns the default empty file if
   *  projects.json is missing / corrupt. */
  read(): Promise<import('./types').ProjectsFile>
  /** Add/remove `root` from the persisted pin set (D12). Returns the
   *  updated file so callers don't need to re-read. */
  togglePin(root: string): Promise<import('./types').ProjectsFile>
  /** Subscribe to mutation pushes. Returns an unsubscribe fn. */
  onChange(cb: (file: import('./types').ProjectsFile) => void): () => void
  /** Phase 4 — renderer pushes the live rail snapshot to main on
   *  every change. Main caches it for `duo project list`. */
  pushState(snapshot: import('./types').ProjectsStateSnapshot): void
  /** Phase 4 — main → renderer push from `duo project focus`. */
  onSetFocus(cb: (root: string | null) => void): () => void
  /** Phase 4 — main → renderer push from `duo project close`. */
  onCloseRequest(cb: (root: string) => void): () => void
}

// ENH-184 Phase 4 — workspace-pill click-to-open-menu CLI bridge.
export interface ElectronWorkspacePillMenuAPI {
  pushState(enabled: boolean): void
  onSet(cb: (enabled: boolean) => void): () => void
}

// ENH-151 / ENH-152a — GitHub integration host API.
export interface GitStatusSnapshot {
  isRepo: boolean
  workTreeRoot?: string
  branch: string
  head: string
  dirty: boolean
  changedCount: number
  ahead: number
  behind: number
  reason?: 'not-a-repo' | 'git-not-found' | 'git-error'
}

/**
 * ENH-152a v2 — compose the Navigator chip's display string. Locked
 * owner decisions (v0.7.0-rev2/rev3 gates):
 *
 * - branch-only-clean format (v1-Q1): clean=`main`, dirty=`main · 3
 *   modified`, diverged=`main · 2 ahead, 1 behind`, both=
 *   `main · 3 modified, 2 ahead, 1 behind`.
 * - Always visible when in a repo (v1 changed: empty-on-clean
 *   directive was rejected at v0.7.0 walk). Non-repos still return ''.
 *
 * Returns '' iff snap.isRepo === false. Callers should check the
 * empty-string sentinel to decide whether to render the chip.
 */
export function formatGitStatusChip(snap: GitStatusSnapshot): string {
  if (!snap.isRepo) return ''
  const ref = snap.branch || snap.head
  const parts: string[] = []
  if (snap.dirty) parts.push(`${snap.changedCount} modified`)
  if (snap.ahead > 0) parts.push(`${snap.ahead} ahead`)
  if (snap.behind > 0) parts.push(`${snap.behind} behind`)
  if (parts.length === 0) return ref
  return `${ref} · ${parts.join(', ')}`
}

/**
 * ENH-152a v2 — compose the Navigator chip's hover-tooltip per owner
 * prototype-Q3 PLAIN-ENGLISH pick: "Main branch of '<repo>' repo" +
 * an optional second line with dirty/ahead/behind summary so users
 * who hover get more state than the chip alone shows.
 *
 * `repoName` is the basename of the repo root (e.g. 'duo' for
 * /Users/.../duo/). Empty string returns a tooltip without quoting.
 */
export function formatGitStatusTooltip(snap: GitStatusSnapshot, repoName: string): string {
  if (!snap.isRepo) return ''
  const ref = snap.branch || snap.head
  const repoLabel = repoName ? `'${repoName}' repo` : 'repo'
  const lines: string[] = [`${ref} branch of ${repoLabel}`]
  const summary: string[] = []
  if (snap.dirty) summary.push(`${snap.changedCount} modified file${snap.changedCount === 1 ? '' : 's'}`)
  if (snap.ahead > 0) summary.push(`${snap.ahead} commit${snap.ahead === 1 ? '' : 's'} ahead`)
  if (snap.behind > 0) summary.push(`${snap.behind} commit${snap.behind === 1 ? '' : 's'} behind`)
  if (summary.length > 0) lines.push(summary.join(' · '))
  return lines.join('\n')
}

/**
 * ENH-152a v2 — extract the repo basename for tooltip + ribbon usage.
 * From `/Users/me/code/duo` returns 'duo'. Empty string on falsy input.
 */
export function repoBasenameFor(workTreeRoot: string | null | undefined): string {
  if (!workTreeRoot) return ''
  const trimmed = workTreeRoot.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed
}

export interface CloneRequest {
  url: string
  targetDir?: string
  cwd?: string
}

export interface CloneResult {
  ok: boolean
  clonedTo?: string
  errorKind?: 'bad-url' | 'auth-missing' | 'clone-failed'
  error?: string
  via?: 'gh' | 'git'
}

export interface GhAuthStatus {
  ghInstalled: boolean
  authenticated: boolean
  host?: string
  user?: string
  ghNotFound: boolean
}

export interface GitHubUrlRequest {
  cwd: string
  workTreeRoot: string
  branch: string
  absPath: string
  isFolder: boolean
}

export interface GitHubUrlResult {
  url: string | null
  host: string | null
}

export interface ElectronGitAPI {
  /** ENH-152a — get a git status snapshot for a directory. Renderer
   *  uses this for the Navigator root chip. */
  status(cwd: string): Promise<GitStatusSnapshot>
  /** ENH-151 — clone a GitHub repo via gh / git. Used by the
   *  File → Clone… modal. */
  clone(req: CloneRequest): Promise<CloneResult>
  /** ENH-151 — probe `gh auth status`. Used by the Clone modal's
   *  pre-flight. */
  ghAuth(): Promise<GhAuthStatus>
  /** ENH-155 — compose a GitHub URL for a file/folder. Powers the
   *  Navigator right-click "Open on GitHub" / "Copy GitHub URL"
   *  menu items. Returns null url when the remote isn't a GitHub
   *  host (gitlab.com, bitbucket.org, etc.) so callers can suppress
   *  the menu items. */
  githubUrlFor(req: GitHubUrlRequest): Promise<GitHubUrlResult>
  /** ENH-152a v2 (peer-repos) — for each named child of parentDir
   *  that's a git repo root, return its GitStatusSnapshot. Non-repo
   *  children are absent from the result map. Powers the inline chip
   *  on peer-repo folder rows when the user is browsing a parent
   *  directory containing multiple repos. */
  scanReposIn(req: { parentDir: string; childNames: string[] }): Promise<Record<string, GitStatusSnapshot>>
  /** ENH-152b — per-file dirty status + line-diff map keyed by
   *  absolute path. Powers the per-file dirty dots in the Navigator
   *  tree, with STATUS-DIFF tooltip ("Modified · +24 / −7 lines"). */
  dirtyFilesFor(req: { workTreeRoot: string }): Promise<Record<string, { status: string; plus: number; minus: number }>>
  /** ENH-152c — start a bounded fs watcher on the current navigator
   *  cwd (depth 1 — only the visible rows). Replaces any prior
   *  watcher. Main process emits GIT_WATCH_INVALIDATE pushes
   *  (debounced 250ms) when any file changes; renderer bumps its
   *  refresh tick to re-fetch git status + dirty files +
   *  child-repo maps. workTreeRoot is passed for context but the
   *  watch target is cwd (avoids overwhelming chokidar when the
   *  work-tree is huge — e.g. user has ~/Documents as a git repo). */
  watchStart(req: { workTreeRoot: string; cwd: string }): Promise<{ ok: boolean; reused?: boolean }>
  /** ENH-152c — stop the active watcher. Called on cwd change to
   *  a non-repo OR on unmount. */
  watchStop(): Promise<{ ok: boolean }>
  /** ENH-152c — subscribe to debounced invalidation events from the
   *  active watcher. Returns a cleanup function. */
  onWatchInvalidate(cb: () => void): () => void
}

// ENH-212 — Home re-entry surface. All reads recompute live in main on
// every call (D9 invariant — no cache, no sidecar). Backed by
// electron/home-snapshot.ts + claude-session-tracker primitives.
export interface ElectronHomeAPI {
  /** Full Home snapshot: greeting + rolled-up projects with their most
   *  recent sessions. `limitPerProject` caps sessions per project
   *  (heroes show 3; main applies its default when omitted). */
  snapshot(limitPerProject?: number): Promise<import('./types').HomeSnapshot>
  /** Paged "all N sessions" expander for one project root. Lazy titles —
   *  rows beyond the snapshot's cap resolve on demand. */
  listSessions(root: string, offset: number, limit: number): Promise<import('./types').HomeSession[]>
  /** Session click contract (§ 4.3): focus raises the hosting window +
   *  activates its terminal tab; resume spawns `claude --resume <uuid>`
   *  in the sender's window. Openness is re-checked main-side before
   *  any spawn. */
  sessionAction(action: import('./types').HomeSessionAction): Promise<{ ok: boolean; error?: string }>
  /** main → renderer push from `duo home` — focus/synthesize the Home
   *  tab. Returns a cleanup function. */
  onHomeShow(cb: () => void): () => void
  /** main → renderer push to activate a terminal tab by id (the focus
   *  leg of the click contract + `duo term tab <id>`). The handler
   *  reuses the `terminal:focus` body. Returns a cleanup function. */
  onTerminalActivateTab(cb: (tabId: string) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
  }
}
