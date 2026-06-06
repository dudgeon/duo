// Stage 3: Unix socket server — bridge between the duo CLI and the main process.
//
// Protocol: newline-delimited JSON over a Unix domain socket.
//   → {"id":"<uuid>","cmd":"text","args":{"selector":"article"}}
//   ← {"id":"<uuid>","ok":true,"result":"..."}
//   ← {"id":"<uuid>","ok":false,"error":"Element not found"}
//
// Socket path: ~/Library/Application Support/duo/duo.sock
// Security: MVP allows any local process. Before Trailblazers rollout, add a
//   launch-time token in args (see §14 of brief).

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { CdpBridge } from '../electron/cdp-bridge'
import type { BrowserManager } from '../electron/browser-manager'
import type { FilesService } from '../electron/files-service'
import type { NavPinsService } from './nav-pins-service'
import type { EventBus, DuoEvent } from './event-bus'
import type { PackLoader } from './pack-loader'
import type {
  DuoRequest,
  DuoResponse,
  ConsoleLevel,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  PageSelectionSnapshot,
  DocWriteRequest,
  DocWriteResult,
  DocReadRequest,
  DocReadResult,
  DocGotoRequest,
  DocGotoResult,
  DocFindRequest,
  DocFindResult,
  DuoSelection,
  HtmlOpRequest,
  HtmlOpResult,
  HtmlCommentRequest,
  HtmlCommentResult,
  HtmlCommentsListRequest,
  HtmlCommentsListResult,
  ThemeMode,
  ThemeStateSnapshot,
  AuthorStateSnapshot,
  ClaudeReturnMode,
  ShiftReturnMode,
  ClaudeKeyPrefsSnapshot,
  SelectionFormat,
  SelectionFormatStateSnapshot,
  NewTabRequest,
  NewTabResult,
  TerminalTabKind,
  NavPinEntry,
  WorkingAuxSnapshot
} from '../shared/types'
import { SOCKET_PATH, PORT_FILE } from './constants'

export interface NavBridge {
  /** Returns the most recent snapshot pushed by the renderer. */
  getState: () => NavStateSnapshot
  /** Ask the renderer to move the navigator to `path` + fire a chip. */
  reveal: (path: string) => { ok: boolean; error?: string }
  /** Ask the renderer to open `path` as a file tab in the WorkingPane. */
  /** ENH-097 — optional `mode` forces canvas-mode mount for HTML
   *  files that declare `duo-open-in: browser`. `undefined` keeps
   *  the meta-tag-default routing. */
  view: (path: string, mode?: 'canvas' | 'browser') => { ok: boolean; error?: string }
  /** Stage 11 — open `path` in the rich markdown editor tab. */
  edit: (path: string, mode?: 'canvas' | 'browser') => { ok: boolean; error?: string }
  /** Stage 11 § D29a — return the active editor's selection snapshot. */
  getSelection: () => EditorSelectionSnapshot | null
  /** Stage 17c — return the active canvas's selection snapshot. */
  getCanvasSelection: () => PageSelectionSnapshot | null
  /** Stage 11 § D27 — apply a doc-write to the active editor. */
  docWrite: (req: Omit<DocWriteRequest, 'reqId'>) => Promise<DocWriteResult>
  /** ENH-108 — insert an image into the active markdown editor.
   *  Bytes are read from disk by the CLI/main process. Renderer
   *  saves the image alongside the active doc + inserts at caret. */
  imageInsert: (req: { bytes: Uint8Array; ext: string; alt?: string }) => Promise<import('../shared/types').ImageInsertResult>
  /** Read the live editor buffer (active or specified path). */
  docRead: (req: Omit<DocReadRequest, 'reqId'>) => Promise<DocReadResult>
  /** ENH-022 — agent-driven editor navigation (heading / line / anchor). */
  docGoto: (req: Omit<DocGotoRequest, 'reqId'>) => Promise<DocGotoResult>
  /** ENH-023 — read-only buffer search (markdown editor v1). */
  docFind: (req: Omit<DocFindRequest, 'reqId'>) => Promise<DocFindResult>
  /** Stage 11 § D33d — current theme state (renderer \u2192 main cache). */
  getTheme: () => ThemeStateSnapshot
  /** Stage 11 § D33d — CLI-driven theme override. */
  setTheme: (mode: ThemeMode) => { ok: boolean; error?: string }
  /** BUG-138 Phase 2 — current author identity (renderer → main cache). */
  getAuthor: () => AuthorStateSnapshot
  /** BUG-138 Phase 2 — CLI-driven author override. */
  setAuthor: (author: string) => { ok: boolean; error?: string }
  /** Sprint 16 / v0.6.15 — current Claude-tab Enter key prefs
   *  (renderer \u2192 main cache). */
  getClaudeKeyPrefs: () => ClaudeKeyPrefsSnapshot
  /** Sprint 16 / v0.6.15 — CLI-driven Return-key override. */
  setClaudeReturn: (mode: ClaudeReturnMode) => { ok: boolean; error?: string }
  /** Sprint 16 / v0.6.15 — CLI-driven Shift+Return override. */
  setShiftReturn: (mode: ShiftReturnMode) => { ok: boolean; error?: string }
  /** ENH-172 (Sprint 20 / v0.7.7) — CLI-driven show/hide hidden-files
   *  toggle. `value` is true (show) / false (hide) / 'toggle' (flip).
   *  Reads the current value out of `getState().showDotfiles` rather
   *  than a dedicated getter — the renderer pushes nav-state already. */
  setHiddenFiles: (value: boolean | 'toggle') => { ok: boolean; error?: string }
  /** ENH-178 (Sprint 20 / v0.7.7) — echo CLI-driven browser-mode
   *  changes back to the renderer so its cached value (used for
   *  address-bar affordances + future Settings UI) stays fresh.
   *  Optional — main can no-op if the renderer-side cache isn't
   *  wired yet. */
  pushBrowserMode?: (mode: import('../shared/types').BrowserMode) => void
  /** ENH-014 — CLI-driven split-pane percentage (clamped 20–80). */
  setSplit: (pct: number) => { ok: boolean; pct?: number; error?: string }
  /** ENH-099 — `duo split 3way` / `⌘⌥4` chord. Snaps to outer 33/67 +
   *  inner aux 50/50 (when aux is open). On-demand sibling of ENH-126. */
  setLayout3wayEven: () => { ok: boolean; error?: string }
  /** FOLLOWUP-020 — close the focused working-pane tab. Mirrors ⌘W
   *  on the working strip. Renderer applies the pinned-tab gate
   *  (uses dialog.confirm before unpinning). Returns { ok: true }
   *  even when nothing was closed (no active tab); error only when
   *  the renderer isn't reachable. */
  closeActiveWorkingTab: () => { ok: boolean; error?: string }
  /** FOLLOWUP-020 — close a terminal tab. `n` omitted closes the
   *  focused terminal tab; `n` provided (1-indexed) closes that
   *  specific tab. */
  closeTerminalTab: (n?: number) => { ok: boolean; error?: string }
  /** FOLLOWUP-025 — open the File → Clone… modal in the renderer.
   *  Triggered by the native File menu entry + CLI parity for
   *  `duo clone --modal` (future). */
  openCloneModal: () => { ok: boolean; error?: string }
  /** ENH-183 C12 — Claude session lifecycle CLI verbs. Each one
   *  routes through PtyManager (resume/rename inject into the named
   *  PTY) or claude-session-tracker (list reads JSONL store).
   *  ENH-183 pared 2026-05-25 (Option A): hydrate removed. */
  sessionList: (cwd: string) => Promise<unknown>
  sessionResume: (tabId: string, uuid: string) => { ok: boolean; error?: string }
  // ENH-183 pared 2026-05-25 (Option A): sessionRename + sessionHydrate
  // removed. Force-rename unnecessary (Haiku covers it); inline rename
  // surface dropped with S2.
  /** ENH-122 — query the renderer's DOM from the CLI. Mirrors the
   *  `duo eval` shape but targets the main renderer (the React shell)
   *  instead of the browser-pane CDP target. Use cases: inspect what
   *  TipTap rendered for the active editor, verify image src on a
   *  pasted asset, confirm a CSS class landed on the right
   *  ProseMirror node. Selector-based queries are the common path;
   *  `js` allows arbitrary expressions for the long tail. */
  queryRendererDom: (req: {
    selector?: string
    js?: string
    attr?: string
    text?: boolean
    computed?: string[]
    all?: boolean
  }) => Promise<unknown>
  /** ENH-123 — open / close DevTools on either the main renderer (the
   *  React shell) or the active browser pane. Backstop for cases
   *  where ENH-122's targeted query isn't enough. */
  openDevTools: (opts: { target?: 'renderer' | 'browser-pane'; close?: boolean }) => { ok: boolean; target?: string; opened?: boolean; error?: string }
  /** ENH-124 — JSON snapshot of the WorkingPane state (active main
   *  tab, aux tab if open, splitPct, terminal/navigator collapsed,
   *  focused subpane). Computed on-demand by querying the renderer's
   *  `window.__duoGetLayout()` exposed by App.tsx — always-fresh,
   *  no push-and-cache pipeline needed. */
  getLayout: () => Promise<unknown>
  /** ENH-130 — used by `duo edit --reveal` and `duo open --reveal` to
   *  ensure the artifact the agent just created is actually visible
   *  to the user. Reads layout state via getLayout(); if the working
   *  pane is collapsed (splitPct >= 75 — terminal-dominant), calls
   *  setSplit(50) to expose the canvas. Then sends PANE_FOCUS_JUMP
   *  to focus the main pane. Idempotent — already-visible canvas
   *  stays at its current ratio; focus jump is harmless if already
   *  focused. */
  revealMainPaneIfCollapsed: () => Promise<void>
  /** ENH-041 / Sprint 3 — Split View aux pane. CLI-driven open/close/
   *  promote/resize + state query. State is renderer-authoritative;
   *  the no-arg getter returns main's cached snapshot pushed by the
   *  renderer on every aux state change. */
  splitViewOpen: (path: string) => { ok: boolean; error?: string }
  /** Phase 3c — pin a browser tab (numeric BrowserTab id) into the
   *  Split View aux slot. Mirrors splitViewOpen but routes through
   *  IPC.WORKING_AUX_OPEN_BROWSER instead of WORKING_AUX_OPEN. */
  splitViewOpenBrowser: (browserTabId: number) => { ok: boolean; error?: string }
  splitViewClose: () => { ok: boolean; error?: string }
  splitViewPromote: () => { ok: boolean; error?: string }
  splitViewResize: (pct: number) => { ok: boolean; pct?: number; error?: string }
  getSplitViewState: () => WorkingAuxSnapshot
  /** Stage 5 v2 A24 — open a URL in the macOS default browser via
   *  Electron's `shell.openExternal`. Used by the duo subagent for
   *  hostnames listed in `~/.claude/duo/external-domains.json`. */
  openExternal: (url: string) => Promise<{ ok: boolean; opened?: string; error?: string }>
  /** Stage 15 G19 — Send → Duo payload format (agent-tunable). */
  getSelectionFormat: () => SelectionFormatStateSnapshot
  setSelectionFormat: (format: SelectionFormat) => { ok: boolean; error?: string }
  /** Stage 15 G17 — write a payload into the active terminal's PTY.
   *  No Enter appended; user confirms. Surfaces an error when no
   *  terminal is active. */
  sendToActiveTerminal: (text: string) => { ok: boolean; written?: number; terminalId?: string; error?: string }
  /** Stage 17a — `duo html new <path>` writes the H17 boilerplate and
   *  asks the renderer to open the canvas tab via NAV_EDIT (the
   *  classifier routes .html → html-canvas). */
  htmlNew: (path: string, title?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  /** Stage 17b Phase C — dispatch a `duo html *` op to the active
   *  canvas. Single discriminated request shape; renderer's PageTab
   *  applies it via htmlOps.executeHtmlOp and replies. */
  htmlOp: (req: Omit<HtmlOpRequest, 'reqId'>) => Promise<HtmlOpResult>
  /** Stage 17d — dispatch a `duo html comment` write. Anchor resolution
   *  happens in the renderer (which knows the live DOM). */
  htmlComment: (req: Omit<HtmlCommentRequest, 'reqId'>) => Promise<HtmlCommentResult>
  /** Stage 17d — dispatch a `duo html comments` read. Returns the
   *  thread list as the renderer sees it post-doc-order sort. */
  htmlCommentsList: (req: Omit<HtmlCommentsListRequest, 'reqId'>) => Promise<HtmlCommentsListResult>
  /** Stage 19c D27 — open a new terminal tab via the renderer's
   *  authoritative tab state. kind/cwd/cmd are all optional — the
   *  renderer picks defaults (D28 persisted last-kind, navigator
   *  pending CWD, no pre-typed command). */
  newTab: (req: Omit<NewTabRequest, 'reqId'>) => Promise<NewTabResult>
  /** ENH-098 (Sprint 9) — pane-jump focus action. Same shape as the
   *  ⌘⌥L/;/' chord set, exposed via `duo focus-pane <name>`. Returns
   *  `{ok: false, error: 'split view not open'}` for target='aux'
   *  when neither file aux nor browser aux is mounted. */
  focusPane: (target: 'terminal' | 'main' | 'aux') => { ok: boolean; target?: string; error?: string }
  /** BUG-030 — broadcast nav-pin state change to renderer subscribers
   *  after a CLI-driven mutation (the IPC handler broadcasts itself;
   *  this is the socket-server's path to the same channel). */
  pushNavPinsChanged: (pins: NavPinEntry[]) => void
  /** ENH-167 — session-as-file CLI parity. Wraps the main-process
   *  helpers so `duo session <op>` can drive the same Save / Open /
   *  Open Recent flows as the File menu. */
  workspaceSave: (opts: { targetPath?: string; name?: string; saveAs?: boolean }) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  workspaceOpen: (path: string) => Promise<{ ok: boolean; path?: string; name?: string; error?: string }>
  workspaceListRecent: () => Promise<import('../shared/types').WorkspaceHistoryEntry[]>
  workspaceCurrent: () => Promise<import('../shared/types').ActiveWorkspace | null>
  workspaceNew: () => Promise<{ ok: boolean }>
  /** ENH-182 Phase 4 — cached rail snapshot for `duo project list`
   *  + name→root resolution (renderer pushes via
   *  PROJECTS_STATE_PUSH). */
  getProjectsState: () => import('../shared/types').ProjectsStateSnapshot
  /** ENH-182 Phase 4 — resolve a `name|root` ref against the cached
   *  list. Returns `{ root }` on unique match, `{ ambiguous: [...] }`
   *  when the name resolves to multiple projects (BUG-163), or null
   *  for no match at all. */
  resolveProjectRef: (
    ref: string
  ) => { root: string } | { ambiguous: string[] } | null
  /** ENH-182 Phase 4 — push focus change to renderer (null = All). */
  setProjectFocus: (root: string | null) => { ok: boolean; error?: string }
  /** ENH-182 Phase 4 — push bulk-close request to renderer. */
  requestProjectClose: (root: string) => { ok: boolean; error?: string }
  /** ENH-182 Phase 4 — direct main-side pin toggle (no renderer hop).
   *  Returns the updated persisted file. */
  projectsTogglePin: (root: string) => Promise<import('../shared/types').ProjectsFile>
  /** ENH-184 (Sprint 23 / v0.8.0) — workspace-pill menu CLI parity. */
  getWorkspacePillMenuEnabled: () => boolean
  setWorkspacePillMenuEnabled: (enabled: boolean) => { ok: boolean; error?: string }
}

export class SocketServer {
  private unixServer: net.Server | null = null
  // Stage 20 — TCP fallback alongside the Unix socket. Lives on
  // 127.0.0.1 with an ephemeral port + per-launch auth token, so a
  // sandboxed Claude Code session (where Unix sockets are blocked
  // but localhost TCP is allowed) can still reach the bridge. See
  // docs/DECISIONS.md → *Sandbox-tolerant transport*.
  private tcpServer: net.Server | null = null
  private tcpPort: number | null = null
  private tcpToken: string | null = null

  // Stage 12 close — optional renderer event sink. When set, the
  // socket-server pushes `claude:read-selection` (and any future
  // ambient-presence events) so the UI can paint a glow when the
  // agent reads from a pane. Optional because the sink is wired in
  // Electron-host setup; a future Native Messaging host would inject
  // its own. Same pattern as PtyManager's setEventSink (electron/main.ts).
  private eventSink: ((channel: string, payload: unknown) => void) | null = null

  constructor(
    private readonly cdp: CdpBridge,
    private readonly browser: BrowserManager,
    private readonly files: FilesService,
    private readonly nav: NavBridge,
    private readonly navPins: NavPinsService,
    private readonly events: EventBus,
    private readonly packs: PackLoader,
    // Real running app version (app.getVersion() → package.json), injected
    // from electron/main.ts. Returned by the `ping` handler so `duo doctor`
    // compares it against the CLI's build-time version and flags a stale
    // binary symlink. Mirrors the `new PtyManager(app.getVersion())` pattern.
    private readonly appVersion: string
  ) {}

  /** Stage 12 close — install a renderer-push callback. */
  setEventSink(send: (channel: string, payload: unknown) => void): void {
    this.eventSink = send
  }

  start(): void {
    this.startUnix()
    this.startTcp()
  }

  stop(): void {
    this.unixServer?.close()
    this.tcpServer?.close()
    try { fs.unlinkSync(SOCKET_PATH) } catch { /* already gone */ }
    try { fs.unlinkSync(PORT_FILE) } catch { /* already gone */ }
    this.unixServer = null
    this.tcpServer = null
    this.tcpPort = null
    this.tcpToken = null
  }

  private startUnix(): void {
    // Remove stale socket from a previous run
    try { fs.unlinkSync(SOCKET_PATH) } catch { /* doesn't exist — fine */ }

    this.unixServer = net.createServer((socket) => {
      this.attachConnection(socket, /* requireToken */ null)
    })

    this.unixServer.listen(SOCKET_PATH, () => {
      // Restrict to owner only — prevents other local users from driving the browser
      try { fs.chmodSync(SOCKET_PATH, 0o700) } catch { /* non-fatal */ }
    })

    this.unixServer.on('error', (err) => {
      console.error('[SocketServer] unix error:', err.message)
    })
  }

  private startTcp(): void {
    // Per-launch token; lives only in this process and the port file.
    const token = crypto.randomBytes(32).toString('hex')
    this.tcpToken = token

    this.tcpServer = net.createServer((socket) => {
      this.attachConnection(socket, /* requireToken */ token)
    })

    this.tcpServer.listen(0, '127.0.0.1', () => {
      const addr = this.tcpServer?.address()
      if (typeof addr === 'object' && addr) {
        this.tcpPort = addr.port
        this.writePortFile(addr.port, token)
      }
    })

    this.tcpServer.on('error', (err) => {
      // TCP failure is non-fatal — the Unix socket is the primary
      // transport and the CLI happily uses it when present.
      console.error('[SocketServer] tcp error:', err.message)
    })
  }

  private writePortFile(port: number, token: string): void {
    try {
      // 0o600 ensures only the owner can read the token, matching the
      // Unix socket's chmod.
      fs.writeFileSync(
        PORT_FILE,
        JSON.stringify({ port, token }, null, 2),
        { mode: 0o600 }
      )
    } catch (err) {
      console.error('[SocketServer] failed to write port file:', err)
    }
  }

  /**
   * Wires a newly accepted connection to the request dispatch loop.
   * If `requireToken` is non-null, the first NDJSON line must be
   * `{"token":"<value>"}` matching it; otherwise the connection is
   * dropped before any command can run. Unix sockets pass `null`
   * because their chmod 0o700 is the access control.
   */
  private attachConnection(socket: net.Socket, requireToken: string | null): void {
    let buf = ''
    let authed = requireToken == null
    // Stage 27 — `events --follow` keeps the socket open and writes
    // multiple JSON lines per request, breaking the request/response
    // contract that `handle()` returns a single Promise<DuoResponse> for.
    // The unsubscribe lives here so socket close cleans up the bus
    // subscriber and any pending stream.
    let eventsUnsub: (() => void) | null = null

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        if (!authed) {
          try {
            const handshake = JSON.parse(line) as { token?: unknown }
            if (typeof handshake.token === 'string' && handshake.token === requireToken) {
              authed = true
              continue
            }
          } catch { /* fall through to reject */ }
          if (!socket.destroyed) {
            socket.write(JSON.stringify({ id: '', ok: false, error: 'auth required' }) + '\n')
          }
          socket.destroy()
          return
        }
        let req: DuoRequest
        try { req = JSON.parse(line) } catch { continue }
        // Stage 27 — `events --follow` is the only streaming command.
        // Branch BEFORE handle() so we can write multiple JSON lines
        // and skip the standard {id, ok, result} envelope. Snapshot
        // mode (`events` without --follow) flows through the standard
        // path below.
        if (req.cmd === 'events' && (req.args as { follow?: unknown } | undefined)?.follow === true) {
          this.handleEventsFollow(req, socket, (unsub) => { eventsUnsub = unsub })
          continue
        }
        this.handle(req)
          .then(res => { if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n') })
          .catch(err => {
            const res: DuoResponse = { id: req.id, ok: false, error: String(err) }
            if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n')
          })
      }
    })

    const cleanup = () => {
      if (eventsUnsub) {
        try { eventsUnsub() } catch { /* bus subscriber already gone */ }
        eventsUnsub = null
      }
    }
    socket.on('error', cleanup)
    socket.on('close', cleanup)
    socket.on('end', cleanup)
  }

  /**
   * Streaming response handler for `duo events --follow`. Writes an
   * initial `{id, ok:true, result:{subscribed, since}}` ack, replays
   * any events on the ring with cursor > since (oldest first), then
   * attaches a live subscriber that writes each new event as a bare
   * `{event: DuoEvent}` JSON line. The CLI's parse loop knows the
   * convention: an `id` envelope is the ack; an `event` payload is a
   * streamed event. Socket close = unsubscribe.
   */
  private handleEventsFollow(
    req: DuoRequest,
    socket: net.Socket,
    onUnsub: (fn: () => void) => void
  ): void {
    const args = (req.args ?? {}) as { since?: unknown; limit?: unknown }
    const since = typeof args.since === 'string' ? args.since : undefined
    const writeLine = (obj: unknown) => {
      if (!socket.destroyed) socket.write(JSON.stringify(obj) + '\n')
    }
    // Initial ack so the CLI knows the subscription is live and can
    // start parsing event lines.
    writeLine({ id: req.id, ok: true, result: { subscribed: true, since: since ?? null } })
    const writeEvent = (event: DuoEvent) => writeLine({ event })
    const unsub = this.events.subscribe(writeEvent, since !== undefined ? { since } : undefined)
    onUnsub(unsub)
  }

  /**
   * BUG-138 Phase 3 — apply a CriticMarkup operation to a markdown
   * file on disk. Routes through the pure helpers in
   * core/markdown/docEdit.ts. Disk-only in v1: when the file is open
   * in the editor, the autosave reconciliation flow picks up the
   * external change (BUG-085 path).
   */
  private async handleDocEdit(args: Record<string, unknown>): Promise<{
    ok: boolean
    changed: boolean
    reason: string
    op: string
    path: string
  }> {
    const docEdit = await import('./markdown/docEdit')
    const frontmatter = await import('./markdown/frontmatter')

    const path = args['path'] as string | undefined
    const op = args['op'] as string | undefined
    if (!path || typeof path !== 'string') throw new Error('doc-edit requires a path arg')
    if (!op || typeof op !== 'string') throw new Error('doc-edit requires an op arg')
    if (!path.endsWith('.md')) {
      throw new Error(`doc-edit only supports .md files (got ${path})`)
    }
    const validOps = ['insert', 'delete', 'substitute', 'highlight', 'comment', 'accept', 'reject']
    if (!validOps.includes(op)) {
      throw new Error(`doc-edit op must be one of: ${validOps.join(', ')}`)
    }

    const occurrence = typeof args['occurrence'] === 'number' ? args['occurrence'] as number : undefined
    const opts = occurrence !== undefined ? { occurrence } : {}

    // Read the file from disk via the FilesService (consistent with
    // other socket commands — respects the MAX_READ_BYTES cap, etc.).
    const readResult = await this.files.read(path)
    const text = new TextDecoder('utf-8').decode(readResult.bytes)
    const split = frontmatter.splitFrontmatter(text)

    let editResult: { body: string; changed: boolean; reason: string }

    if (op === 'insert') {
      const newText = args['text'] as string | undefined
      const after = args['after'] as string | undefined
      const before = args['before'] as string | undefined
      const atLine = args['atLine'] as number | undefined
      if (typeof newText !== 'string') throw new Error('insert requires --text')
      if ([after, before, atLine].filter(v => v !== undefined).length !== 1) {
        throw new Error('insert requires exactly one of --after / --before / --at-line')
      }
      if (after !== undefined) editResult = docEdit.insertAfter(split.body, after, newText, opts)
      else if (before !== undefined) editResult = docEdit.insertBefore(split.body, before, newText, opts)
      else editResult = docEdit.insertAtLine(split.body, atLine as number, newText)
    } else if (op === 'delete') {
      const target = args['text'] as string | undefined
      if (typeof target !== 'string') throw new Error('delete requires --text')
      editResult = docEdit.deleteText(split.body, target, opts)
    } else if (op === 'substitute') {
      const oldText = args['text'] as string | undefined
      const newText = args['with'] as string | undefined
      if (typeof oldText !== 'string') throw new Error('substitute requires --text')
      if (typeof newText !== 'string') throw new Error('substitute requires --with')
      editResult = docEdit.substituteText(split.body, oldText, newText, opts)
    } else if (op === 'highlight') {
      // BUG-138 family — close the CLI parity gap. HighlightMark exists
      // in the editor; this verb wraps existing text as `{==X==}`.
      const target = args['text'] as string | undefined
      if (typeof target !== 'string') throw new Error('highlight requires --text')
      editResult = docEdit.highlightText(split.body, target, opts)
    } else if (op === 'comment') {
      const anchor = args['anchor'] as string | undefined
      const body = args['body'] as string | undefined
      const replyTo = args['replyTo'] as string | undefined
      const authorArg = args['author'] as string | undefined
      if (typeof body !== 'string') throw new Error('comment requires --body')
      const author = authorArg ?? process.env.DUO_AUTHOR ?? this.nav.getAuthor().author ?? 'agent'
      const ts = new Date().toISOString()
      // BUG-143 — when --reply-to is supplied without --anchor, route to
      // the proper reply path (append `↪ @author ts: body` to the parent
      // token). Pre-fix the agent had to pass the parent id as anchor
      // text, which corrupted the parent comment with a nested token.
      if (typeof replyTo === 'string' && replyTo.length > 0 && typeof anchor !== 'string') {
        editResult = docEdit.addCommentReply(split.body, {
          replyTo,
          replyBody: body,
          author,
          ts
        })
      } else {
        if (typeof anchor !== 'string') {
          throw new Error('comment requires --anchor (or --reply-to to reply to an existing thread)')
        }
        const commentId = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        editResult = docEdit.addAnchoredComment(split.body, {
          anchorText: anchor,
          commentBody: body,
          author,
          ts,
          commentId,
          replyTo,
          occurrence
        })
      }
    } else if (op === 'accept' || op === 'reject') {
      const id = args['id'] as string | undefined
      const match = args['match'] as string | undefined
      if (!id && !match) throw new Error(`${op} requires --id or --match`)
      const ident = { id, match, occurrence }
      editResult = op === 'accept'
        ? docEdit.acceptOp(split.body, ident)
        : docEdit.rejectOp(split.body, ident)
    } else {
      throw new Error(`unhandled op: ${op}`)
    }

    if (!editResult.changed) {
      return { ok: true, changed: false, reason: editResult.reason, op, path }
    }

    const fullText = frontmatter.joinFrontmatter(split.frontmatter, editResult.body, split.eol)
    const bytes = new TextEncoder().encode(fullText)
    await this.files.write(path, bytes)
    return { ok: true, changed: true, reason: '', op, path }
  }

  private async handle(req: DuoRequest): Promise<DuoResponse> {
    const { id, cmd, args } = req
    try {
      let result: unknown

      switch (cmd) {
        case 'ping': {
          // Stage 20 — cheap liveness probe used by `duo doctor` and
          // by the CLI fallback to confirm the TCP transport is wired
          // up before bothering with any real command. Returns the
          // running app's version so the CLI can flag mismatches when
          // a stale binary symlink is pointing at an older bundle.
          result = { version: this.appVersion }
          break
        }
        case 'navigate': {
          // BUG-149 (Sprint 20 / v0.7.7) — `duo navigate` is a
          // BROWSER-PANE verb (dispatches CDP Page.navigate). The
          // verb name reads like a navigator-pane move, so users
          // (+ agents) sometimes pass a filesystem path. We hard-
          // error with a helpful redirect at `duo reveal <path>`
          // (the canonical navigator-move verb). Recognized path
          // shapes: starts with `/`, `~`, or `./` `../`.
          //
          // ENH-175 (2026-05-23) — route through `navigateOrFocus`
          // so an existing tab matching `url` is focused; otherwise
          // a new tab is opened. Active tab is NOT clobbered. The
          // renderer's address bar keeps the older reuse-active
          // semantics via the BROWSER_NAVIGATE IPC path.
          const url = args['url'] as string
          if (!url) throw new Error('navigate requires a url arg')
          if (url.startsWith('/') || url.startsWith('~') || url.startsWith('./') || url.startsWith('../')) {
            throw new Error(`'duo navigate' expects a URL (this is a BROWSER-PANE verb). To move the file navigator to a path, use 'duo reveal <path>'. To open a local file, use 'duo open <path>' (browser-mode) or 'duo edit <path>' (canvas-/editor-mode).`)
          }
          result = await this.browser.navigateOrFocus(url)
          break
        }
        case 'open': {
          const url = args['url'] as string
          if (!url) throw new Error('open requires a url arg')
          // ENH-156 — verb-driven mode. CLI passes mode='browser' by
          // default (or 'canvas' on --canvas override). For HTML file://
          // paths the verb decides the surface; the legacy `<meta name=
          // "duo-open-in" content="browser">` declaration is no longer
          // consulted.
          const mode = args['mode'] as 'canvas' | 'browser' | undefined
          // ENH-130 walk-1 fix — pre-condition the layout BEFORE the
          // open lands so the open's own focus push isn't overridden
          // by browser-pane visibility-change events. Same fix as
          // case 'edit' / case 'view'. See those branches for the
          // race detail.
          if (args['reveal']) await this.nav.revealMainPaneIfCollapsed()
          // BUG-067 — for LOCAL FILE paths (file:// URLs pointing at an
          // existing file on disk), route through the renderer's
          // openFileSmart via NavBridge.edit instead of unconditionally
          // landing in the browser pane. The renderer's smart router
          // handles HTML browser-mode de-dupe (BUG-059), focus, and
          // the non-HTML classifier (.md → editor, image → viewer).
          // ENH-156 — HTML routing flipped to verb-driven: pass the
          // CLI-supplied mode through to openFileSmart so HTML lands
          // where `duo open` (browser default) or `duo open --canvas`
          // says, ignoring any `<meta duo-open-in>` declaration.
          // Web URLs (http/https/etc.) keep the existing browser-tab
          // path; bare hostnames are pre-resolved by the CLI's
          // resolveOpenTarget() before we ever see them.
          let resolvedLocally = false
          // BUG-129 — track file:// URLs that DON'T resolve so we can
          // emit an explicit "file not found" error instead of falling
          // through to openTab (which would just render a blank tab).
          let missingFilePath: string | null = null
          if (url.startsWith('file://')) {
            try {
              const localPath = decodeURI(url.slice('file://'.length))
              if (fs.existsSync(localPath)) {
                const lower = localPath.toLowerCase()
                const isHtml = lower.endsWith('.html') || lower.endsWith('.htm')
                // ENH-156 routing: HTML respects the CLI mode (browser
                // default; canvas on --canvas override). Non-HTML
                // ignores mode — the renderer's classifier picks the
                // natural surface for the extension.
                const effectiveMode: 'canvas' | 'browser' | undefined =
                  isHtml ? (mode ?? 'browser') : undefined
                const editResult = this.nav.edit(localPath, effectiveMode)
                if (editResult.ok) {
                  const routedTo =
                    effectiveMode === 'browser' ? 'browser' :
                    effectiveMode === 'canvas' ? 'canvas' :
                    'editor'
                  result = { ok: true, url, routedTo }
                  resolvedLocally = true
                }
              } else {
                missingFilePath = localPath
              }
            } catch {
              // Fall through to the browser-tab path on decode failure.
            }
          }
          // BUG-129 — file:// URL with a missing target: surface a
          // friendly error to the CLI instead of opening a blank tab.
          // The dominant cause is agent-authored relative paths that
          // resolve against the wrong cwd (e.g. `duo open
          // docs/research/foo.html` from a terminal in the parent
          // dir). Returning an error here lets the agent self-correct.
          if (!resolvedLocally && missingFilePath !== null) {
            result = { ok: false, error: `File not found: ${missingFilePath}` }
            break
          }
          let openedTabId: number | null = null
          if (!resolvedLocally) {
            // http(s) URLs + bare hostnames (already https://-prefixed by
            // resolveOpenTarget on the CLI side) all land here.
            const browserResult = await this.browser.openTab(url)
            // FOLLOWUP-027 — when local-only / filtered mode bounces the
            // URL externally, openTab returns `{ok, url, routedTo:
            // 'system-browser'}` without creating an embedded tab. Pass
            // that through; skip the browser:focus-gained push below
            // since no Duo tab opened.
            if ('id' in browserResult) {
              openedTabId = browserResult.id
              result = { ...browserResult, routedTo: 'browser' }
            } else {
              result = browserResult
            }
          }
          // ENH-130 — reveal already fired pre-open above (see comment
          // there). Don't fire twice — would reset focus a second time.
          // BUG-048 v2 — explicit BROWSER_FOCUS_GAINED push.
          // BrowserManager.openTab calls webContents.focus() on the new
          // view, which SHOULD fire `webContents.on('focus')` and route
          // through the existing IPC. But when `duo open` runs from a
          // terminal that's NOT inside Duo (e.g. iTerm), Terminal.app is
          // frontmost — Electron's programmatic .focus() may queue or
          // no-op until Duo is foregrounded, and the focus event may
          // never fire. The renderer's focusedColumn stays at 'terminal'
          // and ⌘` toggles in the wrong direction. Pushing the IPC
          // unconditionally here aligns the renderer's tracking with
          // user intent ("the page just opened, attention is here now")
          // independent of OS-focus mechanics.
          //
          // BUG-067 — only fire when the URL actually went to the
          // browser. Editor-routed opens get their own focus push from
          // the renderer's NAV_EDIT handler.
          //
          // BUG-101 (Sprint 10) — pre-fix the payload was `null`, but
          // the renderer's `onBrowserFocusGained` handler dereferences
          // `payload.slot` (Phase 3c BUG-095 contract) so the null
          // synthesized event threw and `activeWorking` never flipped
          // to 'browser'. The genuine `webContents.on('focus')` event
          // (browser-manager.ts) sends a proper `{tabId, slot}` shape;
          // the supplemental defensive push has to match. `duo open`
          // always lands a NEW main-strip tab (BrowserManager.openTab
          // appends to `this.tabs`, never to the aux-pinned slot), so
          // `slot: 'main'` is always correct for this path.
          if (!resolvedLocally && this.eventSink && openedTabId !== null) {
            this.eventSink(
              'browser:focus-gained',
              { tabId: openedTabId, slot: 'main' }
            )
          }
          break
        }
        case 'reload': {
          // Stage 20 — `duo reload` reloads the active browser tab in
          // place. Pair for `duo navigate` that doesn't require a URL;
          // closes the Stage 8 iteration flow ("agent emits HTML →
          // user clicks → agent edits → user clicks reload").
          this.browser.reload()
          // Capture state via the existing public getters so the
          // response shape matches `navigate` — agents that chain
          // `duo navigate` → `duo reload` keep getting the same
          // `{url, title}` shape. (Reload is async at the WebContents
          // layer; the response captures the BEFORE-reload state,
          // which is the same URL the user is reloading.)
          const state = this.browser.getState()
          result = { ok: true, url: state.url, title: state.title }
          break
        }
        case 'url':
          result = this.browser.getActiveUrl()
          break

        case 'title':
          result = this.browser.getActiveTitle()
          break

        case 'dom': {
          // ENH-122 — selector / --js / --attr / --text / --computed /
          // --all are renderer-DOM queries (they target the main React
          // shell). Bare `duo dom` keeps the legacy browser-pane HTML
          // dump (CDP-attached, returns the full document of the active
          // browser tab). The disambiguation key is "any args at all" —
          // legacy callers pass nothing.
          const selector = args['selector'] as string | undefined
          const js = args['js'] as string | undefined
          if (selector !== undefined || js !== undefined) {
            result = await this.nav.queryRendererDom({
              selector,
              js,
              attr: args['attr'] as string | undefined,
              text: args['text'] as boolean | undefined,
              computed: args['computed'] as string[] | undefined,
              all: args['all'] as boolean | undefined
            })
          } else {
            result = await this.cdp.getDOM()
          }
          break
        }
        case 'devtools': {
          // ENH-123 — main renderer or browser pane DevTools. --close
          // closes any open instance for the chosen target.
          const target = (args['target'] as 'renderer' | 'browser-pane' | undefined) ?? 'renderer'
          const close = args['close'] as boolean | undefined
          result = this.nav.openDevTools({ target, close })
          break
        }
        case 'layout': {
          // ENH-124 — JSON snapshot of WorkingPane / terminal /
          // navigator state. Computed on-demand from the renderer's
          // window.__duoGetLayout() — see App.tsx for the shape.
          result = await this.nav.getLayout()
          break
        }

        case 'text': {
          const selector = args['selector'] as string | undefined
          result = await this.cdp.getText(selector)
          break
        }
        case 'ax': {
          const selector = args['selector'] as string | undefined
          const format = (args['format'] as string | undefined) ?? 'md'
          const tree = await this.cdp.getAxTree(selector)
          result = format === 'json' ? tree : this.cdp.axToMarkdown(tree)
          break
        }
        case 'focus': {
          const selector = args['selector'] as string
          if (!selector) throw new Error('focus requires a selector arg')
          result = await this.cdp.focus(selector)
          break
        }
        case 'type': {
          const text = args['text'] as string
          if (typeof text !== 'string') throw new Error('type requires a text arg')
          result = await this.cdp.insertText(text)
          break
        }
        case 'key': {
          const name = args['key'] as string
          if (!name) throw new Error('key requires a key name arg')
          const modifiers = (args['modifiers'] as string[] | undefined) ?? []
          result = await this.cdp.dispatchKey(name, modifiers)
          break
        }
        case 'console': {
          const since = args['since'] as number | undefined
          const level = args['level'] as ConsoleLevel[] | undefined
          const limit = args['limit'] as number | undefined
          result = this.cdp.getConsole({ since, level, limit })
          break
        }
        case 'errors': {
          const since = args['since'] as number | undefined
          const limit = args['limit'] as number | undefined
          result = this.cdp.getErrors({ since, limit })
          break
        }
        case 'network': {
          const since = args['since'] as number | undefined
          const limit = args['limit'] as number | undefined
          const filterStr = args['filter'] as string | undefined
          let filter: RegExp | undefined
          if (filterStr) {
            try { filter = new RegExp(filterStr) }
            catch (e) { throw new Error(`Invalid filter regex: ${(e as Error).message}`) }
          }
          result = this.cdp.getNetwork({ since, filter, limit })
          break
        }
        case 'click': {
          const selector = args['selector'] as string
          if (!selector) throw new Error('click requires a selector arg')
          result = await this.cdp.click(selector)
          break
        }
        case 'fill': {
          const selector = args['selector'] as string
          const value = args['value'] as string
          if (!selector || value === undefined) throw new Error('fill requires selector and value args')
          result = await this.cdp.fill(selector, value)
          break
        }
        case 'eval': {
          const js = args['js'] as string
          if (!js) throw new Error('eval requires a js arg')
          result = await this.cdp.evalJS(js)
          break
        }
        case 'screenshot': {
          const selector = args['selector'] as string | undefined
          result = await this.cdp.screenshot(selector)  // returns base64 PNG
          break
        }
        case 'tabs':
          result = this.browser.getTabs()
          break

        case 'tab': {
          const n = args['n'] as number
          if (typeof n !== 'number' || isNaN(n)) throw new Error('tab requires a numeric n arg')
          result = await this.browser.switchTab(n)
          break
        }
        case 'close': {
          const n = args['n'] as number
          if (typeof n !== 'number' || isNaN(n)) throw new Error('close requires a numeric n arg')
          result = await this.browser.closeTab(n)
          break
        }
        case 'wait': {
          const selector = args['selector'] as string
          const timeout = args['timeout'] as number | undefined
          if (!selector) throw new Error('wait requires a selector arg')
          result = await this.cdp.waitForSelector(selector, timeout)
          break
        }
        // Stage 10 Phase 6 — navigator + file-surface commands
        case 'view': {
          const p = args['path'] as string
          if (!p) throw new Error('view requires a path arg')
          // ENH-097 — optional `mode: 'canvas'` overrides the file's
          // `duo-open-in` meta to force canvas-mode mount.
          const mode = args['mode'] as 'canvas' | 'browser' | undefined
          // ENH-130 walk-1 fix — fire reveal BEFORE the open. Pre-fix
          // ordering was open → reveal: the open's setActiveWorking +
          // file-tab focus arrived first, then setSplit(50) flipped
          // splitPct, then the previously-hidden browser pane became
          // visible and its `webContents.on('focus')` event fired,
          // routing focus AWAY from the just-opened file. Reordering
          // pre-conditions the layout (canvas already visible when
          // the file mounts), so the file's own focus push wins.
          if (args['reveal']) await this.nav.revealMainPaneIfCollapsed()
          result = this.nav.view(p, mode)
          break
        }
        case 'edit': {
          const p = args['path'] as string
          if (!p) throw new Error('edit requires a path arg')
          const mode = args['mode'] as 'canvas' | 'browser' | undefined
          if (args['reveal']) await this.nav.revealMainPaneIfCollapsed()
          result = this.nav.edit(p, mode)
          break
        }
        case 'selection': {
          // Stage 15g unified shape extended in Stage 17c: try the
          // requested pane (or auto-pick by precedence: browser
          // highlight > canvas selection > editor cached selection).
          // The auto path matches user intuition — the most recent
          // *visible* selection wins; editor falls through last
          // because its cache is informative even when collapsed.
          const pane = (args['pane'] as string | undefined) ?? 'auto'
          if (pane !== 'auto' && pane !== 'editor' && pane !== 'browser' && pane !== 'canvas') {
            throw new Error('selection pane must be auto|editor|browser|canvas')
          }
          let resolved: DuoSelection = null
          if (pane === 'editor') {
            const ed = this.nav.getSelection()
            resolved = ed ? { kind: 'editor', ...ed } : null
          } else if (pane === 'browser') {
            resolved = await this.cdp.getBrowserSelection().catch(() => null)
          } else if (pane === 'canvas') {
            resolved = this.nav.getCanvasSelection()
          } else {
            const browser = await this.cdp.getBrowserSelection().catch(() => null)
            if (browser && browser.text) {
              resolved = browser
            } else {
              const canvas = this.nav.getCanvasSelection()
              if (canvas && canvas.text) {
                resolved = canvas
              } else {
                const ed = this.nav.getSelection()
                resolved = ed ? { kind: 'editor', ...ed } : null
              }
            }
          }
          // Stage 12 close — whisper-level "Claude read here" cue.
          // Pushes the resolved pane up to the renderer so it can
          // paint a transient accent glow. Only fires when we
          // actually returned a non-null selection (gates out
          // collapsed-or-missing reads that wouldn't be visible).
          if (this.eventSink && resolved) {
            this.eventSink('claude:read-selection', { pane: resolved.kind })
          }
          result = resolved
          break
        }
        case 'doc-write': {
          const text = args['text'] as string
          const mode = (args['mode'] as string | undefined) ?? 'replace-selection'
          if (typeof text !== 'string') throw new Error('doc-write requires a text arg')
          if (mode !== 'replace-selection' && mode !== 'replace-all') {
            throw new Error('doc-write mode must be replace-selection or replace-all')
          }
          const path = args['path'] as string | undefined
          result = await this.nav.docWrite({ text, mode, path })
          break
        }
        case 'doc-edit': {
          // BUG-138 Phase 3 — agent CriticMarkup verbs. Disk-only in
          // v1: reads the file, applies the op, writes atomically.
          // When the file is open in the editor, the autosave
          // reconciliation flow surfaces the external change.
          result = await this.handleDocEdit(args)
          break
        }
        case 'image-insert': {
          // ENH-108 — `duo image insert <source-path>` reads the source
          // image from disk and asks the renderer to save it alongside
          // the active markdown editor's doc + insert at caret. v1
          // markdown only.
          const sourcePath = args['path'] as string | undefined
          const alt = args['alt'] as string | undefined
          if (!sourcePath) throw new Error('image insert requires a path arg')
          // Resolve via Node fs — same MAX cap as files.read.
          const fs = await import('fs/promises')
          const pathMod = await import('path')
          const buf = await fs.readFile(sourcePath)
          const extRaw = pathMod.extname(sourcePath).slice(1).toLowerCase()
          if (!extRaw) throw new Error(`image insert: source path has no file extension: ${sourcePath}`)
          const knownExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tiff'].includes(extRaw)
          if (!knownExt) {
            throw new Error(`image insert: unsupported extension .${extRaw} (supported: png, jpg, jpeg, gif, webp, svg, bmp, tiff)`)
          }
          const reply = await this.nav.imageInsert({ bytes: new Uint8Array(buf), ext: extRaw, alt })
          if (!reply.ok) throw new Error(reply.error ?? 'image insert failed')
          result = { absPath: reply.absPath }
          break
        }
        case 'doc-read': {
          const path = args['path'] as string | undefined
          result = await this.nav.docRead({ path })
          break
        }
        case 'doc-goto': {
          // ENH-022 — at least one of heading/line/anchor must be set.
          const path = args['path'] as string | undefined
          const heading = args['heading'] as string | undefined
          const lineRaw = args['line']
          const anchor = args['anchor'] as string | undefined
          let line: number | undefined
          if (lineRaw !== undefined) {
            const n = typeof lineRaw === 'number' ? lineRaw : Number(lineRaw)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              throw new Error('doc-goto --line requires a positive integer')
            }
            line = n
          }
          if (heading === undefined && line === undefined && anchor === undefined) {
            throw new Error('doc-goto requires one of --heading, --line, --anchor')
          }
          result = await this.nav.docGoto({ path, heading, line, anchor })
          break
        }
        case 'doc-find': {
          const query = args['query'] as string
          if (typeof query !== 'string' || query.length === 0) {
            throw new Error('doc-find requires a query string')
          }
          const path = args['path'] as string | undefined
          const caseSensitive = args['case-sensitive'] === true
          result = await this.nav.docFind({ path, query, caseSensitive })
          break
        }
        case 'theme': {
          const mode = args['mode'] as string | undefined
          if (mode === undefined) {
            // Read-only: return cached state.
            result = this.nav.getTheme()
          } else {
            if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
              throw new Error('theme mode must be system|light|dark')
            }
            const setResult = this.nav.setTheme(mode as ThemeMode)
            if (!setResult.ok) throw new Error(setResult.error ?? 'theme set failed')
            // Return the new state the renderer will land on. The cache
            // updates asynchronously via THEME_STATE_PUSH but mode is the
            // reliable signal to report back.
            result = { ...this.nav.getTheme(), mode }
          }
          break
        }
        case 'author': {
          // BUG-138 Phase 2 — `duo author` reads the cached human-author
          // identity; `duo author "<name>"` overrides + persists in the
          // renderer's localStorage. Agent invocations use the
          // DUO_AUTHOR env var directly, not this verb.
          const author = args['author'] as string | undefined
          if (author === undefined) {
            result = this.nav.getAuthor()
          } else {
            if (typeof author !== 'string') {
              throw new Error('author must be a string')
            }
            const setResult = this.nav.setAuthor(author)
            if (!setResult.ok) throw new Error(setResult.error ?? 'author set failed')
            result = { author: author.trim() }
          }
          break
        }
        case 'claude-return': {
          // Sprint 16 / v0.6.15 — `duo claude-return [submit|newline]`.
          const mode = args['mode'] as string | undefined
          if (mode === undefined) {
            result = this.nav.getClaudeKeyPrefs()
          } else {
            if (mode !== 'submit' && mode !== 'newline') {
              throw new Error('claude-return mode must be submit|newline')
            }
            const setResult = this.nav.setClaudeReturn(mode as ClaudeReturnMode)
            if (!setResult.ok) throw new Error(setResult.error ?? 'claude-return set failed')
            result = { ...this.nav.getClaudeKeyPrefs(), claudeReturn: mode }
          }
          break
        }
        case 'shift-return': {
          // Sprint 16 / v0.6.15 — `duo shift-return [submit|newline]`.
          const mode = args['mode'] as string | undefined
          if (mode === undefined) {
            result = this.nav.getClaudeKeyPrefs()
          } else {
            if (mode !== 'submit' && mode !== 'newline') {
              throw new Error('shift-return mode must be submit|newline')
            }
            const setResult = this.nav.setShiftReturn(mode as ShiftReturnMode)
            if (!setResult.ok) throw new Error(setResult.error ?? 'shift-return set failed')
            result = { ...this.nav.getClaudeKeyPrefs(), shiftReturn: mode }
          }
          break
        }
        case 'hidden-files': {
          // ENH-172 (Sprint 20 / v0.7.7) — `duo hidden-files [show|hide|toggle]`.
          // Bare reads the current value (from cached NavStateSnapshot);
          // arg writes. The `.claude` / `.obsidian` always-visible
          // carve-outs in FileTree's shouldShow() function are NOT
          // controlled by this flag — they remain visible regardless.
          const mode = args['mode'] as string | undefined
          const current = this.nav.getState().showDotfiles === true
          if (mode === undefined) {
            result = { showDotfiles: current }
          } else {
            let target: boolean | 'toggle'
            if (mode === 'show') target = true
            else if (mode === 'hide') target = false
            else if (mode === 'toggle') target = 'toggle'
            else throw new Error('hidden-files mode must be show|hide|toggle')
            const setResult = this.nav.setHiddenFiles(target)
            if (!setResult.ok) throw new Error(setResult.error ?? 'hidden-files set failed')
            // Resolve final value: for 'toggle' the new value is the
            // inverse of the cached current. For show/hide, it's the
            // explicit target. The renderer's NAV_STATE_PUSH echo
            // updates the cache shortly after, but reporting the
            // intended target gives the CLI caller a deterministic answer.
            const newValue = target === 'toggle' ? !current : target
            result = { showDotfiles: newValue }
          }
          break
        }
        case 'browser-mode': {
          // ENH-178 (Sprint 20 / v0.7.7) — `duo browser-mode [unfiltered|filtered|local-only]`.
          // Bare reads the current value; arg writes. CLI side enforces
          // the IT-warning prompt for `unfiltered`; main accepts the
          // value unconditionally so renderer + CLI + future Settings
          // surfaces share one wire.
          const mode = args['mode'] as string | undefined
          if (mode === undefined) {
            result = { mode: this.browser.getBrowserMode() }
          } else {
            if (mode !== 'unfiltered' && mode !== 'filtered' && mode !== 'local-only') {
              throw new Error("browser-mode value must be 'unfiltered', 'filtered', or 'local-only'")
            }
            this.browser.setBrowserMode(mode)
            // Echo to the renderer so its cached value (used for the
            // address-bar affordances) stays fresh.
            this.nav.pushBrowserMode?.(mode)
            result = { mode }
          }
          break
        }
        case 'focus-pane': {
          // ENH-098 (Sprint 9) — CLI parity with the ⌘⌥L/;/' chord
          // set. Same `focusPane()` core in App.tsx; the IPC channel
          // is PANE_FOCUS_JUMP. No-op for target='aux' when neither
          // file aux nor browser aux is open (renderer reports back
          // via the bridge's return value).
          const target = args['target'] as string
          if (target !== 'terminal' && target !== 'main' && target !== 'aux') {
            throw new Error('focus-pane target must be terminal|main|aux')
          }
          const focusResult = this.nav.focusPane(target as 'terminal' | 'main' | 'aux')
          if (!focusResult.ok) throw new Error(focusResult.error ?? 'focus-pane failed')
          result = { target: focusResult.target ?? target }
          break
        }
        case 'inspect': {
          // ENH-156b — toggle / set element-inspect mode in the
          // active browser pane. No arg → toggle; `off=true` → force
          // off; `on=true` → force on. Returns the resulting state.
          // While active, hover renders an outline + click ships a
          // BrowserInspectSnapshot to the renderer, which formats it
          // and writes the payload to the active terminal — same
          // egress path as the Send → Duo pill.
          let next: boolean | 'toggle'
          if (args['off'] === true) next = false
          else if (args['on'] === true) next = true
          else next = 'toggle'
          const active = this.browser.setInspectMode(next)
          result = { active }
          break
        }
        case 'send': {
          const text = args['text'] as string
          if (typeof text !== 'string') throw new Error('send requires a text arg')
          result = this.nav.sendToActiveTerminal(text)
          break
        }
        case 'split': {
          // ENH-014 — `duo split <pct>` (0–100, clamped to 20–80).
          const pct = args['pct']
          if (typeof pct !== 'number' || !Number.isFinite(pct)) {
            throw new Error('split requires a numeric pct (0–100)')
          }
          const setResult = this.nav.setSplit(pct)
          if (!setResult.ok) throw new Error(setResult.error ?? 'split set failed')
          result = { pct: setResult.pct }
          break
        }
        case 'layout-3way-even': {
          // ENH-099 — `duo split 3way` / `⌘⌥4` chord. Renderer applies
          // the canonical 3-pane layout: outer 33/67 + inner aux 50/50.
          const setResult = this.nav.setLayout3wayEven()
          if (!setResult.ok) throw new Error(setResult.error ?? 'layout-3way-even failed')
          result = { ok: true }
          break
        }
        case 'split-view': {
          // ENH-041 / Sprint 3 — Split View aux pane.
          //   duo split-view open <path>  →  open path in aux
          //   duo split-view close        →  close aux
          //   duo split-view promote      →  move aux's tab to main, close aux
          //   duo split-view resize <pct> →  set splitPct (0.0–1.0)
          //   duo split-view              →  state snapshot (no op)
          const op = args['op'] as string | undefined
          if (op === undefined || op === 'state') {
            result = this.nav.getSplitViewState()
            break
          }
          if (op === 'open') {
            const p = args['path'] as string
            if (!p) throw new Error('split-view open requires a path arg')
            const r = this.nav.splitViewOpen(p)
            if (!r.ok) throw new Error(r.error ?? 'split-view open failed')
            result = { ok: true }
            break
          }
          if (op === 'open-browser') {
            // Phase 3c — pin a browser tab into the aux slot.
            const browserTabId = args['browserTabId']
            if (typeof browserTabId !== 'number' || !Number.isInteger(browserTabId) || browserTabId < 1) {
              throw new Error('split-view open-browser requires a positive integer browserTabId arg')
            }
            const r = this.nav.splitViewOpenBrowser(browserTabId)
            if (!r.ok) throw new Error(r.error ?? 'split-view open-browser failed')
            result = { ok: true }
            break
          }
          if (op === 'close') {
            const r = this.nav.splitViewClose()
            if (!r.ok) throw new Error(r.error ?? 'split-view close failed')
            result = { ok: true }
            break
          }
          if (op === 'promote') {
            const r = this.nav.splitViewPromote()
            if (!r.ok) throw new Error(r.error ?? 'split-view promote failed')
            result = { ok: true }
            break
          }
          if (op === 'resize') {
            const pct = args['pct']
            if (typeof pct !== 'number' || !Number.isFinite(pct)) {
              throw new Error('split-view resize requires a numeric pct (0.0–1.0)')
            }
            const r = this.nav.splitViewResize(pct)
            if (!r.ok) throw new Error(r.error ?? 'split-view resize failed')
            result = { pct: r.pct }
            break
          }
          throw new Error(`split-view: unknown op '${op}' (expected open|open-browser|close|promote|resize|state)`)
        }
        case 'selection-format': {
          const format = args['format'] as string | undefined
          if (format === undefined) {
            // Read-only.
            result = this.nav.getSelectionFormat()
          } else {
            if (format !== 'a' && format !== 'b' && format !== 'c') {
              throw new Error('selection-format must be a|b|c')
            }
            const setResult = this.nav.setSelectionFormat(format as SelectionFormat)
            if (!setResult.ok) throw new Error(setResult.error ?? 'selection-format set failed')
            result = { format }
          }
          break
        }
        case 'external': {
          const url = args['url'] as string
          if (!url) throw new Error('external requires a url arg')
          result = await this.nav.openExternal(url)
          break
        }
        case 'html-new': {
          const p = args['path'] as string
          if (!p) throw new Error('html-new requires a path arg')
          if (!/\.html?$/i.test(p)) {
            throw new Error('html-new: path must end in .html or .htm')
          }
          const title = args['title'] as string | undefined
          result = await this.nav.htmlNew(p, title)
          break
        }
        case 'html-op': {
          // Stage 17b Phase C — request shape comes through `args` as the
          // discriminated HtmlOpRequest minus `reqId` (main mints that).
          // We dispatch via NavBridge → main → renderer → PageTab.
          const op = args['op'] as HtmlOpRequest['op'] | undefined
          if (!op) throw new Error('html-op requires an `op` field')
          const validOps: HtmlOpRequest['op'][] = [
            'query', 'get', 'set', 'replace', 'append', 'remove', 'attr'
          ]
          if (!validOps.includes(op)) {
            throw new Error(`html-op: unknown op "${op}"`)
          }
          // Pass-through: trust the CLI to have validated the op-specific
          // fields. The renderer-side executor will surface field errors.
          const reply = await this.nav.htmlOp(args as Omit<HtmlOpRequest, 'reqId'>)
          if (!reply.ok) throw new Error(reply.error ?? 'html-op failed')
          result = reply.result
          break
        }
        case 'html-comment': {
          // Stage 17d — `duo html comment`. Anchor resolution + sidecar
          // append happens in the renderer (which knows the live DOM).
          const body = args['body'] as string | undefined
          if (!body) throw new Error('html-comment requires --body')
          const id = args['id'] as string | undefined
          const selector = args['selector'] as string | undefined
          const text = args['text'] as string | undefined
          if (!id && !selector && !text) {
            throw new Error('html-comment requires --id <duo-id>, --selector <css>, or --text "<substring>"')
          }
          const path = args['path'] as string | undefined
          const reply = await this.nav.htmlComment({ id, selector, text, body, path })
          if (!reply.ok) throw new Error(reply.error ?? 'html-comment failed')
          result = { ok: true, commentId: reply.commentId, anchorId: reply.anchorId }
          break
        }
        case 'html-comments': {
          // Stage 17d — `duo html comments`. Read-only listing. The
          // filter is one of all|open|resolved (default 'all').
          const filterRaw = args['filter'] as string | undefined
          const filter = (filterRaw ?? 'all') as 'all' | 'open' | 'resolved'
          if (filter !== 'all' && filter !== 'open' && filter !== 'resolved') {
            throw new Error("html-comments filter must be 'all', 'open', or 'resolved'")
          }
          const path = args['path'] as string | undefined
          const reply = await this.nav.htmlCommentsList({ path, filter })
          if (!reply.ok) throw new Error(reply.error ?? 'html-comments failed')
          result = reply.threads ?? []
          break
        }
        case 'reveal': {
          const p = args['path'] as string
          if (!p) throw new Error('reveal requires a path arg')
          result = this.nav.reveal(p)
          break
        }
        case 'ls': {
          const p = (args['path'] as string | undefined) ?? this.nav.getState().cwd
          result = await this.files.list(p)
          break
        }
        case 'nav-state': {
          result = this.nav.getState()
          break
        }
        case 'file': {
          // Stage 26 item 6 — `duo file rename <old> <new>` and
          // `duo file trash <path>`. Single command with a discriminated
          // `op` arg, so the Duo verb table stays small.
          const op = args['op'] as string | undefined
          if (op === 'trash') {
            const p = args['path'] as string | undefined
            if (!p) throw new Error('file trash requires a path arg')
            await this.files.trash(p)
            result = { ok: true, path: p }
          } else if (op === 'rename') {
            const oldPath = args['oldPath'] as string | undefined
            const newPath = args['newPath'] as string | undefined
            if (!oldPath || !newPath) throw new Error('file rename requires oldPath + newPath args')
            await this.files.rename(oldPath, newPath)
            result = { ok: true, oldPath, newPath }
          } else {
            throw new Error(`file op must be 'rename' or 'trash' (got '${op ?? '<missing>'}')`)
          }
          break
        }
        case 'nav-pin': {
          // Stage 26 PR 2 (ENH-010) — `duo nav pin <path>`,
          // `duo nav unpin <path>`, `duo nav pins [--json]`.
          // Single command with a discriminated `op` arg.
          const op = args['op'] as string | undefined
          if (op === 'list') {
            result = await this.navPins.list()
          } else if (op === 'pin' || op === 'unpin' || op === 'toggle') {
            const p = args['path'] as string | undefined
            const kind = args['kind'] as string | undefined
            if (!p) throw new Error('nav-pin requires a path arg')
            if (kind !== 'file' && kind !== 'folder') {
              throw new Error(`nav-pin kind must be 'file' or 'folder' (got '${kind ?? '<missing>'}')`)
            }
            const title = (args['title'] as string | undefined) ?? p.split('/').filter(Boolean).pop()
            const entry: import('../shared/types').NavPinEntry = { path: p, kind, title }
            const current = await this.navPins.list()
            const exists = current.some(e => e.path === p)
            // op='pin' → add iff missing; op='unpin' → remove iff present;
            // op='toggle' → flip. Toggle's the agent-friendly default.
            if ((op === 'pin' && exists) || (op === 'unpin' && !exists)) {
              result = { ok: true, pinned: exists, pins: current }
            } else {
              const next = await this.navPins.toggle(entry)
              const isPinned = next.some(e => e.path === p)
              // BUG-030 — push the new list so renderer subscribers
              // (useNavPins) see the change without a relaunch.
              this.nav.pushNavPinsChanged(next)
              result = { ok: true, pinned: isPinned, pins: next }
            }
          } else {
            throw new Error(`nav-pin op must be 'pin', 'unpin', 'toggle', or 'list' (got '${op ?? '<missing>'}')`)
          }
          break
        }
        case 'new-tab': {
          // Stage 19c D27 — open a new terminal tab. All args optional;
          // renderer fills in defaults (last-kind, navigator pending CWD).
          // Validate kind early so a typo'd flag fails fast at the socket
          // boundary rather than getting silently ignored downstream.
          const kindRaw = args['kind'] as string | undefined
          if (kindRaw !== undefined && kindRaw !== 'shell' && kindRaw !== 'claude') {
            throw new Error(`new-tab kind must be 'shell' or 'claude' (got '${kindRaw}')`)
          }
          const cwd = args['cwd'] as string | undefined
          const cmd = args['cmd'] as string | undefined
          const ntResult = await this.nav.newTab({
            kind: kindRaw as TerminalTabKind | undefined,
            cwd,
            cmd
          })
          if (!ntResult.ok) throw new Error(ntResult.error ?? 'new-tab failed')
          result = {
            id: ntResult.id,
            kind: ntResult.kind,
            cwd: ntResult.cwd,
            title: ntResult.title
          }
          break
        }
        case 'events': {
          // Stage 27 — snapshot mode. `--follow` is handled in
          // attachConnection BEFORE we land here (streaming response
          // doesn't fit the {id, ok, result} envelope). This case
          // covers `duo events [--since <cursor>] [--limit N]`.
          const since = typeof args['since'] === 'string' ? (args['since'] as string) : undefined
          const limitRaw = args['limit']
          let limit: number | undefined
          if (typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0) {
            limit = Math.floor(limitRaw)
          }
          result = { events: this.events.listSince(since, limit) }
          break
        }
        case 'packs': {
          // Stage 18b — list every distro pack discovered at app
          // boot. Returns the cached registry without re-scanning;
          // hot-reload is out of scope for v1. Errors per pack are
          // surfaced so authoring agents can see manifest validation
          // failures without crawling the filesystem.
          const registry = this.packs.get()
          result = {
            packs: registry.packs.map(p => ({
              dirName: p.dirName,
              rootDir: p.rootDir,
              manifest: p.manifest,
              errors: p.errors,
            })),
          }
          break
        }
        case 'pack-list': {
          // Stage 21d-iii — list installed distro packs.
          const { listInstalledPacks } = await import('../electron/distro-pack-service')
          result = await listInstalledPacks()
          break
        }
        case 'pack-uninstall': {
          // Stage 21d-iii — uninstall a distro pack by name. Removes
          // the pack's tracked files (skills, agents) and its
          // CLAUDE.md managed block. With --remove-folder, also
          // deletes the source pack folder under extra-packs/.
          const name = args['name'] as string
          const removeFolder = !!args['removeFolder']
          if (!name) throw new Error('pack-uninstall requires a name arg')
          const { uninstallPack } = await import('../electron/distro-pack-service')
          result = await uninstallPack(name, { removePackFolder: removeFolder })
          break
        }
        case 'git-status': {
          // ENH-152a — git status probe for the Navigator root chip.
          // Returns the full GitStatusSnapshot; renderer's
          // formatGitStatusChip gates the display ("clean stays invisible").
          const cwd = (args['cwd'] as string) || process.env.HOME || process.cwd()
          const { getGitStatus } = await import('./git/status')
          result = await getGitStatus(cwd)
          break
        }
        case 'clone': {
          // ENH-151 — wraps `gh repo clone` (preferred) or `git clone`.
          // Failure-mode shape lets the renderer distinguish bad-url
          // (retry input) from auth-missing (bounce to gh auth login)
          // from clone-failed (generic).
          const url = args['url'] as string
          const targetDir = args['targetDir'] as string | undefined
          const cwd = args['cwd'] as string | undefined
          if (!url) throw new Error('clone requires a url arg')
          const { runClone } = await import('./git/clone')
          result = await runClone({ url, targetDir, cwd })
          break
        }
        case 'gh-auth': {
          // ENH-151 — probe `gh auth status`. Used by the renderer
          // Clone modal to pre-flight the auth UX + by `duo doctor`
          // when it lands GitHub integrations.
          const { probeGhAuth } = await import('./git/auth')
          result = await probeGhAuth()
          break
        }
        case 'close-tab': {
          // FOLLOWUP-020 — close the focused working-pane tab. Mirrors
          // ⌘W on the working strip. Renderer applies the pinned-tab
          // gate (dialog.confirm) so a CLI close of a pinned tab still
          // surfaces the same confirmation.
          result = this.nav.closeActiveWorkingTab()
          break
        }
        case 'close-terminal-tab': {
          // FOLLOWUP-020 — close a terminal tab. `n` omitted closes the
          // focused terminal tab; `n` provided (1-indexed) closes the
          // specific tab.
          const n = args['n'] as number | undefined
          result = this.nav.closeTerminalTab(n)
          break
        }
        case 'workspace': {
          // ENH-167 — workspace-as-file. Discriminated op union:
          //   save [path] [--name <name>] — write current state to path
          //     (or to the active workspace's path if omitted); explicit
          //     --save-as forces the path argument.
          //   open <path> — load + in-place reset.
          //   list-recent — list the Open Recent entries (pruned).
          //   current — { path, name } of the active workspace, or null.
          //   new — clear the active-workspace pointer + reset workspace.
          const op = args['op'] as string | undefined
          if (op === 'save') {
            const path = args['path'] as string | undefined
            const name = args['name'] as string | undefined
            const saveAs = args['save-as'] === true
            // CLI save without an explicit --path AND no active workspace
            // is ambiguous (we'd otherwise pop the GUI Save dialog from
            // a headless agent context). Require either an active
            // workspace OR an explicit path.
            const current = await this.nav.workspaceCurrent()
            if (!path && !current && !saveAs) {
              throw new Error('duo workspace save requires either a path or an active workspace. Use `duo workspace save <path> --name <name>` for first save.')
            }
            const saveRes = await this.nav.workspaceSave({ targetPath: path, name, saveAs })
            if (!saveRes.ok) throw new Error(saveRes.error ?? 'save failed')
            result = { path: saveRes.path, name: saveRes.name }
          } else if (op === 'open') {
            const path = args['path'] as string | undefined
            if (!path) throw new Error('duo workspace open requires a path')
            const openRes = await this.nav.workspaceOpen(path)
            if (!openRes.ok) throw new Error(openRes.error ?? 'open failed')
            // Note: in-place reset means the response generally
            // reaches the client cleanly; flagged `switching: true`
            // so CLI consumers know workspace state is being
            // replaced.
            result = { path: openRes.path, name: openRes.name, switching: true }
          } else if (op === 'list-recent') {
            result = await this.nav.workspaceListRecent()
          } else if (op === 'current') {
            result = await this.nav.workspaceCurrent()
          } else if (op === 'new') {
            const newRes = await this.nav.workspaceNew()
            if (!newRes.ok) throw new Error('workspace new failed')
            result = { ok: true }
          } else {
            throw new Error(`Unknown workspace op: ${op}. Expected save|open|list-recent|current|new.`)
          }
          break
        }
        case 'session': {
          // ENH-183 C12 — Claude session lifecycle CLI verbs. Discriminated
          // op union:
          //   list [--cwd <path>] — list prior sessions in the CWD.
          //     Defaults to the active terminal's cwd (from nav state).
          //   resume <tabId> <uuid> — spawn `claude --resume <uuid>` in
          //     the named tab's PTY.
          //   rename <tabId> "<title>" — inject `\r/rename <title>\n`.
          //     User-driven counterpart to the C8 hydrator's auto path.
          //   hydrate <tabId> — force-attempt Duo-driven hydration on
          //     the tab. Goes through the same maybeHydrate gates as
          //     the autosave-triggered path (T3); returns the decision.
          const op = args['op'] as string | undefined
          if (op === 'list') {
            const cwd = args['cwd'] as string | undefined
            const targetCwd = cwd ?? this.nav.getState().cwd
            if (!targetCwd) throw new Error('duo session list: no cwd available (pass --cwd <path>)')
            result = await this.nav.sessionList(targetCwd)
          } else if (op === 'resume') {
            const tabId = args['tabId'] as string | undefined
            const uuid = args['uuid'] as string | undefined
            if (!tabId) throw new Error('duo session resume requires <tabId>')
            if (!uuid) throw new Error('duo session resume requires <uuid>')
            const r = this.nav.sessionResume(tabId, uuid)
            if (!r.ok) throw new Error(r.error ?? 'resume failed')
            result = { ok: true }
          } else {
            // ENH-183 pared 2026-05-25 (Option A): rename + hydrate ops removed.
            throw new Error(`Unknown session op: ${op}. Expected list|resume.`)
          }
          break
        }

        case 'project': {
          // ENH-182 Phase 4 — CLI parity for the rail. Subcommands:
          //   list                 — JSON snapshot of derived projects
          //                          + focused root + per-project counts.
          //   focus <name|root>    — push setFocusedProject to renderer.
          //   focus --all          — push setFocusedProject(null).
          //   pin <name|root>      — toggle pin via ProjectsService;
          //                          PROJECTS_CHANGED broadcast re-derives.
          //   unpin <name|root>    — same toggle, no-op when not pinned.
          //   close <name|root>    — push the bulk-close request; the
          //                          renderer fires dialog.confirm when any
          //                          member terminal is kind:'claude'.
          const op = args['op'] as string | undefined
          const ref = args['ref'] as string | undefined
          if (!op) {
            throw new Error('duo project requires a subcommand. Expected list|focus|pin|unpin|close.')
          }
          if (op === 'list') {
            result = this.nav.getProjectsState()
            break
          }
          // All other subcommands need a target.
          if (op === 'focus' && ref === '--all') {
            const r = this.nav.setProjectFocus(null)
            if (!r.ok) throw new Error(r.error ?? 'focus --all failed')
            result = { ok: true, focused: null }
            break
          }
          if (!ref) {
            throw new Error(`duo project ${op} requires a <name|root> argument (or --all for focus).`)
          }
          const resolved = this.nav.resolveProjectRef(ref)
          if (!resolved) {
            throw new Error(
              `No project matched "${ref}". Run \`duo project list\` to see available projects. Match is by exact root path or unique name.`
            )
          }
          if ('ambiguous' in resolved) {
            throw new Error(
              `Ambiguous name "${ref}" matches ${resolved.ambiguous.length} projects: ${resolved.ambiguous.join(', ')}. Pass the full root path to disambiguate.`
            )
          }
          const root = resolved.root
          if (op === 'focus') {
            const r = this.nav.setProjectFocus(root)
            if (!r.ok) throw new Error(r.error ?? 'focus failed')
            result = { ok: true, focused: root }
          } else if (op === 'pin' || op === 'unpin') {
            // Toggle is idempotent in user-intent terms: `pin` only adds
            // if absent, `unpin` only removes if present. The underlying
            // ProjectsService.togglePin is a pure flip — we read current
            // state first to honor the verb's semantics.
            const current = this.nav.getProjectsState().projects.find((p) => p.root === root)
            const currentlyPinned = !!current?.pinned
            const shouldBePinned = op === 'pin'
            if (currentlyPinned !== shouldBePinned) {
              const file = await this.nav.projectsTogglePin(root)
              result = { ok: true, root, pinned: shouldBePinned, file }
            } else {
              result = { ok: true, root, pinned: currentlyPinned, noop: true }
            }
          } else if (op === 'close') {
            const r = this.nav.requestProjectClose(root)
            if (!r.ok) throw new Error(r.error ?? 'close failed')
            result = { ok: true, root }
          } else {
            throw new Error(`Unknown project op: ${op}. Expected list|focus|pin|unpin|close.`)
          }
          break
        }

        case 'workspace-pill-menu': {
          // ENH-184 (Sprint 23 / v0.8.0) — read or write the
          // workspace-pill click-to-open-menu localStorage flag.
          // Bare reads cached state; arg writes (on|off|toggle).
          const mode = args['mode'] as string | undefined
          if (mode === undefined) {
            result = { enabled: this.nav.getWorkspacePillMenuEnabled() }
          } else {
            let next: boolean
            if (mode === 'on') next = true
            else if (mode === 'off') next = false
            else if (mode === 'toggle') next = !this.nav.getWorkspacePillMenuEnabled()
            else throw new Error('workspace-pill-menu mode must be on|off|toggle')
            const setResult = this.nav.setWorkspacePillMenuEnabled(next)
            if (!setResult.ok) throw new Error(setResult.error ?? 'workspace-pill-menu set failed')
            result = { enabled: next }
          }
          break
        }

        default:
          return { id, ok: false, error: `Unknown command: ${cmd}` }
      }

      return { id, ok: true, result }
    } catch (err) {
      return { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

export function ensureSocketDir(): void {
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true })
}
