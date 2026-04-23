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
import type { DuoRequest, DuoResponse, ConsoleLevel } from '../shared/types'
import { SOCKET_PATH } from './constants'

export class SocketServer {
  private server: net.Server | null = null

  constructor(
    private readonly cdp: CdpBridge,
    private readonly browser: BrowserManager
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
        case 'wait': {
          const selector = args['selector'] as string
          const timeout = args['timeout'] as number | undefined
          if (!selector) throw new Error('wait requires a selector arg')
          result = await this.cdp.waitForSelector(selector, timeout)
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
