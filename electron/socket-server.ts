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
import type { CdpBridge } from './cdp-bridge'
import type { BrowserManager } from './browser-manager'
import type { FilesService } from './files-service'
import type {
  DuoRequest,
  DuoResponse,
  ConsoleLevel,
  NavStateSnapshot,
  EditorSelectionSnapshot,
  DocWriteRequest,
  DocWriteResult,
  DocReadRequest,
  DocReadResult,
  DuoSelection,
  ThemeMode,
  ThemeStateSnapshot
} from '../shared/types'
import { SOCKET_PATH } from './constants'

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
  /** Stage 11 § D27 — apply a doc-write to the active editor. */
  docWrite: (req: Omit<DocWriteRequest, 'reqId'>) => Promise<DocWriteResult>
  /** Read the live editor buffer (active or specified path). */
  docRead: (req: Omit<DocReadRequest, 'reqId'>) => Promise<DocReadResult>
  /** Stage 11 § D33d — current theme state (renderer \u2192 main cache). */
  getTheme: () => ThemeStateSnapshot
  /** Stage 11 § D33d — CLI-driven theme override. */
  setTheme: (mode: ThemeMode) => { ok: boolean; error?: string }
}

export class SocketServer {
  private server: net.Server | null = null

  constructor(
    private readonly cdp: CdpBridge,
    private readonly browser: BrowserManager,
    private readonly files: FilesService,
    private readonly nav: NavBridge
  ) {}

  start(): void {
    // Remove stale socket from a previous run
    try { fs.unlinkSync(SOCKET_PATH) } catch { /* doesn't exist — fine */ }

    this.server = net.createServer((socket) => {
      let buf = ''

      socket.on('data', (chunk) => {
        buf += chunk.toString()
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
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
    })

    this.server.listen(SOCKET_PATH, () => {
      // Restrict to owner only — prevents other local users from driving the browser
      try { fs.chmodSync(SOCKET_PATH, 0o700) } catch { /* non-fatal */ }
    })

    this.server.on('error', (err) => {
      console.error('[SocketServer] error:', err.message)
    })
  }

  stop(): void {
    this.server?.close()
    try { fs.unlinkSync(SOCKET_PATH) } catch { /* already gone */ }
    this.server = null
  }

  private async handle(req: DuoRequest): Promise<DuoResponse> {
    const { id, cmd, args } = req
    try {
      let result: unknown

      switch (cmd) {
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
          // Stage 15g unified shape: try the requested pane (or auto-pick
          // browser when it has a non-empty highlight, falling back to the
          // editor's cached selection — which is informative even when
          // collapsed).
          const pane = (args['pane'] as string | undefined) ?? 'auto'
          if (pane !== 'auto' && pane !== 'editor' && pane !== 'browser') {
            throw new Error('selection pane must be auto|editor|browser')
          }
          let resolved: DuoSelection = null
          if (pane === 'editor') {
            const ed = this.nav.getSelection()
            resolved = ed ? { kind: 'editor', ...ed } : null
          } else if (pane === 'browser') {
            resolved = await this.cdp.getBrowserSelection().catch(() => null)
          } else {
            const browser = await this.cdp.getBrowserSelection().catch(() => null)
            if (browser && browser.text) {
              resolved = browser
            } else {
              const ed = this.nav.getSelection()
              resolved = ed ? { kind: 'editor', ...ed } : null
            }
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
