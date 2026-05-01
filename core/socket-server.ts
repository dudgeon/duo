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
import type {
  DuoRequest,
  DuoResponse,
  ConsoleLevel,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  HtmlCanvasSelectionSnapshot,
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
  SelectionFormat,
  SelectionFormatStateSnapshot,
  NewTabRequest,
  NewTabResult,
  TerminalTabKind,
  NavPinEntry
} from '../shared/types'
import { SOCKET_PATH, PORT_FILE, APP_VERSION } from './constants'

export interface NavBridge {
  /** Returns the most recent snapshot pushed by the renderer. */
  getState: () => NavStateSnapshot
  /** Ask the renderer to move the navigator to `path` + fire a chip. */
  reveal: (path: string) => { ok: boolean; error?: string }
  /** Ask the renderer to open `path` as a file tab in the WorkingPane. */
  view: (path: string) => { ok: boolean; error?: string }
  /** Stage 11 — open `path` in the rich markdown editor tab. */
  edit: (path: string) => { ok: boolean; error?: string }
  /** Stage 11 § D29a — return the active editor's selection snapshot. */
  getSelection: () => EditorSelectionSnapshot | null
  /** Stage 17c — return the active canvas's selection snapshot. */
  getCanvasSelection: () => HtmlCanvasSelectionSnapshot | null
  /** Stage 11 § D27 — apply a doc-write to the active editor. */
  docWrite: (req: Omit<DocWriteRequest, 'reqId'>) => Promise<DocWriteResult>
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
  /** ENH-014 — CLI-driven split-pane percentage (clamped 20–80). */
  setSplit: (pct: number) => { ok: boolean; pct?: number; error?: string }
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
   *  canvas. Single discriminated request shape; renderer's CanvasTab
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
  /** BUG-030 — broadcast nav-pin state change to renderer subscribers
   *  after a CLI-driven mutation (the IPC handler broadcasts itself;
   *  this is the socket-server's path to the same channel). */
  pushNavPinsChanged: (pins: NavPinEntry[]) => void
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
    private readonly navPins: NavPinsService
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
        this.handle(req)
          .then(res => { if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n') })
          .catch(err => {
            const res: DuoResponse = { id: req.id, ok: false, error: String(err) }
            if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n')
          })
      }
    })

    socket.on('error', () => { /* client disconnected mid-flight — ignore */ })
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
          result = { version: APP_VERSION }
          break
        }
        case 'navigate': {
          const url = args['url'] as string
          if (!url) throw new Error('navigate requires a url arg')
          result = await this.browser.navigate(url)
          break
        }
        case 'open': {
          const url = args['url'] as string
          if (!url) throw new Error('open requires a url arg')
          result = await this.browser.openTab(url)
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

        case 'dom':
          result = await this.cdp.getDOM()
          break

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
          result = this.nav.view(p)
          break
        }
        case 'edit': {
          const p = args['path'] as string
          if (!p) throw new Error('edit requires a path arg')
          result = this.nav.edit(p)
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
          // We dispatch via NavBridge → main → renderer → CanvasTab.
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
