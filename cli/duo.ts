#!/usr/bin/env node
/**
 * duo CLI — the agent's API surface into the running Duo app.
 * Called by Claude Code like any shell command; communicates with the Electron
 * main process over a Unix socket at ~/Library/Application Support/duo/duo.sock
 *
 * See §9 of duo-brief.md for the full command reference.
 */

import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import type { DuoRequest, DuoResponse } from '../shared/types'

const VERSION = '0.1.0'
// Stage 18 Phase 18a (D4) — when running inside a Duo PTY, the
// DUO_SOCKET env var is exported by PtyManager and points at the live
// socket. Prefer it over the hard-coded path so that future install-
// path changes flow through one knob.
const SOCKET_PATH =
  process.env.DUO_SOCKET ??
  path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.sock')
// Stage 20 — TCP fallback published by the Electron app at startup.
// Format: { port: number, token: string }. Read by `send()` when the
// Unix socket fails to connect (sandboxed Claude Code). See
// docs/DECISIONS.md → *Sandbox-tolerant transport*.
const PORT_FILE =
  process.env.DUO_PORT_FILE ??
  path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.port')
const TIMEOUT_MS = 10_000
// Stage 13b — `doc write` can sit on the renderer for a long time when the
// buffer is dirty: the editor surfaces a <WriteWarningBanner> and waits
// for the human to accept or decline. The CLI must outlast that human-
// in-the-loop window or the agent gets a misleading "Timeout" error
// when the user is mid-decision. 5 minutes mirrors the renderer-side
// `dispatchDocWrite` budget in electron/main.ts.
const PER_CMD_TIMEOUT_MS: Record<string, number> = {
  'doc-write': 5 * 60 * 1000
}

// ── Socket transport ─────────────────────────────────────────────────────────

interface PortInfo { port: number; token: string }

function readPortFile(): PortInfo | null {
  try {
    const raw = fs.readFileSync(PORT_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PortInfo>
    if (typeof parsed.port === 'number' && typeof parsed.token === 'string') {
      return { port: parsed.port, token: parsed.token }
    }
  } catch { /* missing or malformed — caller falls through */ }
  return null
}

type TransportFactory = () => { socket: net.Socket; preamble?: string }

/**
 * One round-trip over a freshly-opened socket. Promise resolves with
 * the response result, or rejects with an Error whose `code` field
 * distinguishes connect-time failures (`ETIMEDOUT_CONNECT`,
 * `EPERM`, `ECONNREFUSED`, `ENOENT`) from response-side failures.
 * Stage 20 uses the connect-time codes to decide whether to retry
 * against the TCP fallback.
 */
function sendOver(
  factory: TransportFactory,
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { socket, preamble } = factory()
    const id = randomUUID()
    let buf = ''
    let done = false
    let connected = false

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      connected = true
      if (preamble) socket.write(preamble)
      const req: DuoRequest = { id, cmd: cmd as DuoRequest['cmd'], args }
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const res: DuoResponse = JSON.parse(line)
          if (res.id === id) {
            done = true
            socket.destroy()
            if (res.ok) resolve(res.result)
            else reject(new Error(res.error ?? 'Unknown error'))
          }
        } catch { /* partial line */ }
      }
    })

    socket.on('timeout', () => {
      if (done) return
      const err = new Error(`Timeout waiting for response to "${cmd}"`)
      ;(err as NodeJS.ErrnoException).code = connected ? 'ETIMEDOUT_RESPONSE' : 'ETIMEDOUT_CONNECT'
      socket.destroy()
      reject(err)
    })

    socket.on('error', (err) => {
      reject(err)
    })
  })
}

const FALLBACK_CONNECT_CODES = new Set([
  'EPERM',          // sandbox blocks Unix sockets
  'ECONNREFUSED',   // app down, or stale socket file
  'ENOENT',         // socket file vanished
  'EAGAIN',
  'ETIMEDOUT_CONNECT'
])

async function send(
  cmd: string,
  args: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {}
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? PER_CMD_TIMEOUT_MS[cmd] ?? TIMEOUT_MS

  // Try the Unix socket first. DUO_TCP_ONLY=1 forces TCP for testing.
  if (process.env.DUO_TCP_ONLY !== '1' && fs.existsSync(SOCKET_PATH)) {
    try {
      return await sendOver(
        () => ({ socket: net.createConnection(SOCKET_PATH) }),
        cmd, args, timeoutMs
      )
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (!code || !FALLBACK_CONNECT_CODES.has(code)) throw err
      // Fall through to TCP.
    }
  }

  // Stage 20 — TCP fallback. Read the port file the Electron app
  // published at startup, connect to 127.0.0.1, and send the auth
  // token as the first NDJSON line of the handshake.
  const portInfo = readPortFile()
  if (!portInfo) {
    if (!fs.existsSync(SOCKET_PATH)) {
      die('Cannot connect: Duo app is not running.\nLaunch Duo.app first.')
    }
    die('Cannot connect: Unix socket failed and no TCP fallback available.\nRun `duo doctor` for details.')
  }
  return await sendOver(
    () => {
      const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
      return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
    },
    cmd, args, timeoutMs
  )
}

/**
 * Stage 27 — streaming variant of `send()` for `duo events --follow`.
 * Same transport logic (Unix first, TCP fallback with auth). The
 * server protocol: first line back is `{id, ok:true, result:{...}}`
 * (the ack); each subsequent line is `{event: DuoEvent}` until the
 * socket closes. `onAck` fires once when the ack lands; `onEvent`
 * fires per streamed event. Returns a Promise that resolves on clean
 * socket close, rejects on unrecoverable error or non-ok ack.
 */
function sendStreamed(
  cmd: string,
  args: Record<string, unknown>,
  onAck: (result: unknown) => void,
  onEvent: (event: unknown) => void
): Promise<void> {
  const factory: TransportFactory = () => {
    if (process.env.DUO_TCP_ONLY !== '1' && fs.existsSync(SOCKET_PATH)) {
      return { socket: net.createConnection(SOCKET_PATH) }
    }
    const portInfo = readPortFile()
    if (!portInfo) {
      throw new Error('Cannot connect: Unix socket failed and no TCP fallback available.')
    }
    const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
    return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
  }

  return new Promise((resolve, reject) => {
    let socket: net.Socket
    let preamble: string | undefined
    try {
      const made = factory()
      socket = made.socket
      preamble = made.preamble
    } catch (err) {
      reject(err)
      return
    }
    const id = randomUUID()
    let buf = ''
    let acked = false

    socket.on('connect', () => {
      if (preamble) socket.write(preamble)
      const req: DuoRequest = { id, cmd: cmd as DuoRequest['cmd'], args }
      socket.write(JSON.stringify(req) + '\n')
    })

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let parsed: unknown
        try { parsed = JSON.parse(line) } catch { continue }
        // Streamed event line: { event: DuoEvent }.
        if (parsed && typeof parsed === 'object' && 'event' in parsed) {
          onEvent((parsed as { event: unknown }).event)
          continue
        }
        // Ack line: { id, ok, result }.
        if (parsed && typeof parsed === 'object' && 'id' in parsed) {
          const res = parsed as DuoResponse
          if (res.id !== id) continue
          if (!res.ok) {
            socket.destroy()
            reject(new Error(res.error ?? 'Unknown error'))
            return
          }
          acked = true
          onAck(res.result)
        }
      }
    })

    socket.on('close', () => {
      if (acked) resolve()
      else reject(new Error('Socket closed before ack'))
    })
    socket.on('error', (err) => {
      reject(err)
    })
  })
}

// ── Output helpers ────────────────────────────────────────────────────────────

// BUG-114 (Sprint 14 walk-1) — `duo dom | head -3` (and any other
// `duo <verb> | head/grep/awk`) crashed with `Error: write EPIPE`
// when the pipe consumer closed its stdin before the CLI finished
// writing. Standard Node fix: swallow EPIPE on stdout/stderr so the
// process exits cleanly. `head -3` is canonical agent-debugging
// usage; the crash made the CLI feel broken even when it had
// successfully delivered the requested bytes.
process.stdout.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
})
process.stderr.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exit(0)
})

function out(value: unknown): void {
  if (typeof value === 'string') process.stdout.write(value + '\n')
  else console.log(JSON.stringify(value, null, 2))
}

function die(msg: string, code = 1): never {
  process.stderr.write(`duo: ${msg}\n`)
  process.exit(code)
}

/**
 * ENH-022 follow-up — module-scope `flagValue(args, name)` so subcommand
 * handlers across `case 'doc'`, `case 'html'`, etc. can share a single
 * argv-flag lookup. Returns the value following `--name` in `args`, or
 * `undefined` if the flag isn't present. Bug fixed: the original helper
 * lived inside `case 'html'` only, so `case 'doc'`'s `flagValue(...)`
 * calls hit `flagValue is not defined` at runtime.
 */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : undefined
}

/**
 * BUG-005 fix — translate cross-platform navigation combos to Mac
 * equivalents. Used by `duo key` so agents reaching for Cmd+End /
 * Cmd+Home / Cmd+PageDown / Cmd+PageUp from cross-platform muscle
 * memory don't accidentally trigger the Electron application-menu
 * chrome on macOS.
 */
function translateNavKeysForMac(key: string, modifiers: string[]): { key: string; modifiers: string[] } {
  if (process.platform !== 'darwin') return { key, modifiers }
  const lowered = modifiers.map(m => m.toLowerCase())
  const hasCmd = lowered.includes('cmd') || lowered.includes('meta')
  if (!hasCmd) return { key, modifiers }
  const k = key.toLowerCase()
  if (k === 'end') return { key: 'ArrowDown', modifiers }
  if (k === 'home') return { key: 'ArrowUp', modifiers }
  if (k === 'pagedown' || k === 'pageup') {
    // Drop the Cmd modifier; PageDown / PageUp page-scroll natively
    // on macOS without it, and Cmd is what would trigger the menu
    // fall-through.
    return { key, modifiers: modifiers.filter(m => m.toLowerCase() !== 'cmd' && m.toLowerCase() !== 'meta') }
  }
  return { key, modifiers }
}

// ── Command dispatch ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelp()
    process.exit(0)
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    out(VERSION)
    process.exit(0)
  }

  const [cmd, ...rest] = argv

  try {
    switch (cmd) {
      case 'navigate': {
        // BUG-149 (Sprint 20 / v0.7.7) — `duo navigate` is a BROWSER-
        // PANE verb (URLs only). The verb name reads like a navigator-
        // pane move, so users + agents sometimes pass a path. Catch
        // that here with a helpful redirect — same message the socket
        // would emit, but the CLI catches it before a round-trip.
        const url = rest[0] ?? die('Usage: duo navigate <url>\n\nNote: \'duo navigate\' is a BROWSER-PANE verb (URLs only). To move the file navigator to a path, use \'duo reveal <path>\'. To open a local file, use \'duo open <path>\' or \'duo edit <path>\'.')
        if (url.startsWith('/') || url.startsWith('~') || url.startsWith('./') || url.startsWith('../')) {
          die(`'duo navigate' expects a URL (this is a BROWSER-PANE verb). To move the file navigator to '${url}', use 'duo reveal ${url}'. To open it as a file, use 'duo open ${url}' (browser-mode) or 'duo edit ${url}' (canvas-/editor-mode).`)
        }
        out(await send('navigate', { url }))
        break
      }
      case 'open': {
        // ENH-130 — `--reveal` expands the working pane (if collapsed)
        // and focuses main after the open lands. Use this when the
        // agent just created an artifact for the user to see.
        // ENH-159 — `duo open <html>` defaults to the browser pane
        // (interactive, scripts run). `--canvas` is an override that
        // forces canvas-mode mount (source-editable, scripts blocked).
        // For non-HTML files (.md, images, etc.), `mode` is ignored by
        // the renderer's natural router. The legacy `<meta name="duo-
        // open-in" content="browser">` declaration is no longer
        // consulted by this verb — verb name decides surface.
        const reveal = rest.includes('--reveal')
        const canvasOverride = rest.includes('--canvas')
        const positional = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo open <path-or-url> [--canvas] [--reveal]')
        const resolved = resolveOpenTarget(positional)
        const payload: Record<string, unknown> = {
          url: resolved,
          mode: canvasOverride ? 'canvas' : 'browser'
        }
        if (reveal) payload['reveal'] = true
        out(await send('open', payload))
        break
      }
      case 'reload': {
        // Stage 20 — pair for `duo navigate` that doesn't require a
        // URL; reloads the active browser tab in place. Useful for
        // the Stage 8 iteration flow (agent emits HTML → user clicks
        // → agent edits → user runs `duo reload`).
        out(await send('reload'))
        break
      }
      case 'url':
        out(await send('url'))
        break
      case 'title':
        out(await send('title'))
        break
      case 'dom': {
        // ENH-122 — `duo dom <selector> [...]` queries the main renderer
        // (the React shell). Bare `duo dom` keeps the legacy browser-pane
        // HTML dump (CDP). Disambiguation key: any args at all → renderer.
        //
        //   duo dom                                 # browser-pane HTML (legacy)
        //   duo dom 'img'                           # outerHTML of first match
        //   duo dom '.ProseMirror' --attr class     # one attribute
        //   duo dom '.ProseMirror' --text           # textContent
        //   duo dom 'img' --computed width,height   # getComputedStyle props
        //   duo dom 'li' --all                      # array of outerHTMLs
        //   duo dom --js '1 + 1'                    # arbitrary expression
        if (rest.length === 0) {
          out(await send('dom'))
          break
        }
        const jsIdx = rest.indexOf('--js')
        const payload: Record<string, unknown> = {}
        if (jsIdx !== -1) {
          // --js consumes the rest of argv as a single expression so
          // shell-quoted blobs with spaces / parens / object literals
          // survive intact. Anything before --js is rejected (mixing
          // selector + js makes no sense).
          if (jsIdx !== 0) {
            die('Usage: duo dom --js "<expr>"  (no other positional args)')
          }
          const js = rest.slice(jsIdx + 1).join(' ')
          if (!js) die('Usage: duo dom --js "<expression>"')
          payload['js'] = js
        } else {
          // Selector path. First non-flag arg = selector; flags AFTER it
          // configure the projection (--attr / --text / --computed / --all).
          // Walk argv manually so flag VALUES (--attr <name>, --computed
          // <list>) don't get caught up in the positional scan.
          const flagsWithValue = new Set(['--attr', '--computed'])
          const skipNext = new Set<number>()
          for (let i = 0; i < rest.length; i++) {
            if (flagsWithValue.has(rest[i])) skipNext.add(i + 1)
          }
          const positionals = rest.filter((a, i) => !a.startsWith('--') && !skipNext.has(i))
          if (positionals.length === 0) {
            die('Usage: duo dom <selector> [--attr <n>] [--text] [--all] [--computed p1,p2]')
          }
          payload['selector'] = positionals[0]
          const attrIdx = rest.indexOf('--attr')
          if (attrIdx !== -1) {
            const v = rest[attrIdx + 1]
            if (!v) die('Usage: duo dom <selector> --attr <name>')
            payload['attr'] = v
          }
          if (rest.includes('--text')) payload['text'] = true
          const computedIdx = rest.indexOf('--computed')
          if (computedIdx !== -1) {
            const v = rest[computedIdx + 1]
            if (!v) die('Usage: duo dom <selector> --computed <prop1,prop2,...>')
            payload['computed'] = v.split(',').map(s => s.trim()).filter(Boolean)
          }
          if (rest.includes('--all')) payload['all'] = true
        }
        out(await send('dom', payload))
        break
      }
      case 'text': {
        const selectorIdx = rest.indexOf('--selector')
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        out(await send('text', selector ? { selector } : {}))
        break
      }
      case 'ax': {
        const selectorIdx = rest.indexOf('--selector')
        const formatIdx = rest.indexOf('--format')
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        const format = formatIdx !== -1 ? rest[formatIdx + 1] : 'md'
        if (format !== 'md' && format !== 'json') die('--format must be md or json')
        out(await send('ax', { selector, format }))
        break
      }
      case 'focus': {
        const selector = rest[0] ?? die('Usage: duo focus <selector>')
        out(await send('focus', { selector }))
        break
      }
      case 'type': {
        // Everything after `type` that isn't a flag is treated as the text.
        if (rest.length === 0) die('Usage: duo type <text>')
        const text = rest.join(' ')
        out(await send('type', { text }))
        break
      }
      case 'key': {
        const rawKey = rest[0] ?? die('Usage: duo key <keyname> [--modifiers cmd,shift,...]')
        const modIdx = rest.indexOf('--modifiers')
        const rawModifiers = modIdx !== -1
          ? (rest[modIdx + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
          : []
        // BUG-005 fix (v0.3.1) — translate cross-platform navigation
        // combos to Mac-native equivalents on darwin. On macOS,
        // Cmd+End / Cmd+Home / Cmd+PageDown / Cmd+PageUp aren't bound
        // to caret navigation; they fall through to Electron's
        // application-menu chrome (Cmd+End in particular surfaces the
        // About panel). The Mac-native equivalents are:
        //   Cmd+End  → Cmd+Down  (caret to end of document)
        //   Cmd+Home → Cmd+Up    (caret to start of document)
        //   Cmd+PageDown / Cmd+PageUp → drop Cmd; PageDown/PageUp
        //                                page-scroll natively without it
        // Translation is silent: the agent gets the navigation it
        // expected, the user doesn't see disruptive UI, and the wire
        // format stays consistent for main.
        const { key, modifiers } = translateNavKeysForMac(rawKey, rawModifiers)
        out(await send('key', { key, modifiers }))
        break
      }
      case 'console': {
        const sinceIdx = rest.indexOf('--since')
        const levelIdx = rest.indexOf('--level')
        const limitIdx = rest.indexOf('--limit')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const level = levelIdx !== -1
          ? rest[levelIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
          : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const entries = await send('console', { since, level, limit }) as unknown[]
        // NDJSON: one event per line (brief §9)
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'errors': {
        const sinceIdx = rest.indexOf('--since')
        const limitIdx = rest.indexOf('--limit')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const entries = await send('errors', { since, limit }) as unknown[]
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'network': {
        const sinceIdx = rest.indexOf('--since')
        const limitIdx = rest.indexOf('--limit')
        const filterIdx = rest.indexOf('--filter')
        const since = sinceIdx !== -1 ? parseInt(rest[sinceIdx + 1], 10) : undefined
        const limit = limitIdx !== -1 ? parseInt(rest[limitIdx + 1], 10) : undefined
        const filter = filterIdx !== -1 ? rest[filterIdx + 1] : undefined
        const entries = await send('network', { since, limit, filter }) as unknown[]
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n')
        break
      }
      case 'click': {
        const selector = rest[0] ?? die('Usage: duo click <selector>')
        out(await send('click', { selector }))
        break
      }
      case 'fill': {
        const [selector, value] = rest
        if (!selector || !value) die('Usage: duo fill <selector> <value>')
        out(await send('fill', { selector, value }))
        break
      }
      case 'eval': {
        const js = rest.join(' ') || die('Usage: duo eval <js>')
        out(await send('eval', { js }))
        break
      }
      case 'screenshot': {
        const outIdx = rest.indexOf('--out')
        const selectorIdx = rest.indexOf('--selector')
        const outputPath = outIdx !== -1 ? rest[outIdx + 1] : undefined
        const selector = selectorIdx !== -1 ? rest[selectorIdx + 1] : undefined
        const b64 = await send('screenshot', { selector }) as string
        if (outputPath) {
          const abs = path.resolve(outputPath)
          fs.writeFileSync(abs, Buffer.from(b64, 'base64'))
          out(`Saved to ${abs}`)
        } else {
          out(b64)
        }
        break
      }
      case 'tabs':
        out(await send('tabs'))
        break
      case 'tab': {
        const n = parseInt(rest[0] ?? '', 10)
        if (isNaN(n)) die('Usage: duo tab <n>')
        out(await send('tab', { n }))
        break
      }
      case 'close': {
        const n = parseInt(rest[0] ?? '', 10)
        if (isNaN(n)) die('Usage: duo close <n>  (where <n> is a tab id from `duo tabs`)')
        out(await send('close', { n }))
        break
      }
      case 'view': {
        // ENH-097 — `--canvas` forces canvas-mode mount, overriding the
        // file's `<meta name="duo-open-in" content="browser">` if present.
        // Routing precedence: explicit flag > meta tag > kind default.
        // ENH-130 — `--reveal` auto-expands the working pane and
        // focuses main after the open. Use when creating artifacts.
        const canvasFlagIdx = rest.indexOf('--canvas')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo view <path> [--canvas] [--reveal]')
        const resolved = resolveFilePath(target)
        const payload: Record<string, unknown> = { path: resolved }
        if (canvasFlagIdx !== -1) payload['mode'] = 'canvas'
        if (rest.includes('--reveal')) payload['reveal'] = true
        out(await send('view', payload))
        break
      }
      case 'image': {
        // ENH-108 — `duo image insert <path>` saves the image alongside
        // the active markdown editor's doc + inserts at caret. v1
        // markdown only — canvas (PageTab) gets the same treatment in
        // a follow-up. Optional `--alt "…"`.
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'insert') {
          const target = subRest.find(a => !a.startsWith('--')) ?? die('Usage: duo image insert <path> [--alt "alt text"]')
          const resolved = resolveFilePath(target)
          const altIdx = subRest.indexOf('--alt')
          const alt = altIdx !== -1 ? subRest[altIdx + 1] : undefined
          out(await send('image-insert', alt !== undefined ? { path: resolved, alt } : { path: resolved }))
          break
        }
        die('Usage: duo image insert <path> [--alt "alt text"]')
        break
      }
      case 'edit': {
        // ENH-159 — `duo edit <html>` defaults to canvas mode (source-
        // editable, scripts blocked, buttons inert). `--browser`
        // forces browser mode (interactive) for symmetry with
        // `duo open --canvas`. For non-HTML files, `mode` is ignored
        // by the renderer's natural router (e.g. .md → TipTap
        // editor; image → viewer). The legacy `<meta name="duo-
        // open-in" content="browser">` is no longer consulted —
        // verb name decides surface.
        // `--canvas` is accepted as a deprecated no-op (it's the
        // default for HTML now) for backwards compat with pre-
        // ENH-159 scripts.
        // ENH-130 — `--reveal` auto-expands the working pane and
        // focuses main after the open. Use when creating artifacts.
        const browserOverride = rest.includes('--browser')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo edit <path> [--browser] [--reveal]')
        const resolved = resolveFilePath(target)
        const payload: Record<string, unknown> = { path: resolved, mode: browserOverride ? 'browser' : 'canvas' }
        if (rest.includes('--reveal')) payload['reveal'] = true
        out(await send('edit', payload))
        break
      }
      case 'selection': {
        const paneIdx = rest.indexOf('--pane')
        const pane = paneIdx !== -1 ? rest[paneIdx + 1] : 'auto'
        if (pane !== 'auto' && pane !== 'editor' && pane !== 'browser' && pane !== 'canvas') {
          die('Usage: duo selection [--pane auto|editor|browser|canvas]')
        }
        const sel = await send('selection', { pane }) as unknown
        if (sel === null || sel === undefined) {
          out('null')
        } else {
          out(sel)
        }
        break
      }
      case 'theme': {
        // `duo theme`          \u2192 print current state (JSON)
        // `duo theme <mode>`   \u2192 override (system|light|dark) and print new state
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('theme'))
        } else {
          if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
            die('Usage: duo theme [system|light|dark]')
          }
          out(await send('theme', { mode }))
        }
        break
      }
      case 'author': {
        // BUG-138 Phase 2 \u2014 `duo author` reads the current author
        // identity; `duo author "<name>"` sets it (persisted in
        // renderer localStorage). Agents set their own attribution via
        // the DUO_AUTHOR env var on per-op verbs (Phase 3); this verb
        // is for the human user's identity only.
        const author = rest[0]
        if (author === undefined) {
          out(await send('author'))
        } else {
          if (author.length === 0) {
            die('Usage: duo author [<name>]')
          }
          out(await send('author', { author }))
        }
        break
      }
      case 'claude-return': {
        // Sprint 16 / v0.6.15 \u2014 `duo claude-return [submit|newline]`.
        // Toggles Claude-tab plain Return behavior. Default: 'submit'
        // (matches universal terminal expectation). 'newline' restores
        // ENH-127 v2 default (writes \x1b\r; Claude reads as multi-line
        // newline; user must use \u2318Return to submit).
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('claude-return'))
        } else {
          if (mode !== 'submit' && mode !== 'newline') {
            die('Usage: duo claude-return [submit|newline]')
          }
          out(await send('claude-return', { mode }))
        }
        break
      }
      case 'shift-return': {
        // Sprint 16 / v0.6.15 \u2014 `duo shift-return [submit|newline]`.
        // Toggles Claude-tab Shift+Return behavior. Default: 'newline'
        // (matches Slack/Discord/claude.ai-web "shift+enter = newline
        // within composition" convention). 'submit' disables the
        // override.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('shift-return'))
        } else {
          if (mode !== 'submit' && mode !== 'newline') {
            die('Usage: duo shift-return [submit|newline]')
          }
          out(await send('shift-return', { mode }))
        }
        break
      }
      case 'hidden-files': {
        // ENH-172 (Sprint 20 / v0.7.7) \u2014 `duo hidden-files [show|hide|toggle]`.
        // Surfaces the navigator's showDotfiles flag for agent control.
        // Bare reads; arg writes. The View menu checkbox + \u2318\u21e7. chord
        // are the GUI counterparts. The `.claude` / `.obsidian` carve-outs
        // in FileTree's shouldShow() are NOT controlled by this flag.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('hidden-files'))
        } else {
          if (mode !== 'show' && mode !== 'hide' && mode !== 'toggle') {
            die('Usage: duo hidden-files [show|hide|toggle]')
          }
          out(await send('hidden-files', { mode }))
        }
        break
      }
      case 'browser-mode': {
        // ENH-178 (Sprint 20 / v0.7.7) — `duo browser-mode [unfiltered|filtered|local-only]`.
        // Bare reads current value; arg writes. `unfiltered` mode
        // (debug-only) requires explicit IT-warning confirmation via
        // an `--i-understand` flag — typing the literal string is the
        // gate so a casual or accidental invocation can't silently
        // turn off URL filtering.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('browser-mode'))
        } else if (mode !== 'unfiltered' && mode !== 'filtered' && mode !== 'local-only') {
          die("Usage: duo browser-mode [unfiltered|filtered|local-only]\n\nModes:\n  local-only  (default) — only file:// + localhost + 127.0.0.1 render in Duo; everything else opens in the system browser.\n  filtered    — Duo renders most URLs; hostnames in ~/.claude/duo/external-domains.json pop the system browser.\n  unfiltered  — DEBUG ONLY. All URLs render in Duo. Requires --i-understand.")
        } else if (mode === 'unfiltered' && !rest.includes('--i-understand')) {
          die(`⚠️  WARNING: 'unfiltered' mode lets Duo's embedded browser render any URL.\n\nSome IT departments disallow agent-driven browsing on the open internet.\nConsult your IT department before proceeding.\n\nTo confirm, re-run:\n  duo browser-mode unfiltered --i-understand`)
        } else {
          out(await send('browser-mode', { mode }))
        }
        break
      }
      case 'focus-pane': {
        // ENH-098 (Sprint 9) \u2014 CLI parity with the \u2318\u2325L/;/' chord set.
        // Distinct from `duo focus <selector>` (CDP focus on a CSS
        // selector inside the active browser pane).
        const target = rest[0]
        if (target !== 'terminal' && target !== 'main' && target !== 'aux') {
          die('Usage: duo focus-pane <terminal|main|aux>')
        }
        out(await send('focus-pane', { target }))
        break
      }
      case 'packs': {
        // Stage 18b \u2014 `duo packs` lists every discovered distro pack
        // as JSON. Pretty-prints by default (single-shot output, not
        // a stream). Pack registry is cached at boot; restart Duo
        // to refresh after installing a new pack.
        const result = await send('packs', {}) as {
          packs: Array<{ dirName: string; rootDir: string; manifest: unknown; errors: string[] }>
        }
        out(result)
        break
      }
      case 'events': {
        // Stage 27 \u2014 `duo events [--follow] [--since <cursor>] [--limit N]`
        // streams structured events from the bus. Pulls in issue #19.
        // Snapshot mode: prints one JSON line per event from the ring.
        // Follow mode: prints the snapshot first, then each new event
        // as it lands; runs until interrupted (^C).
        const follow = rest.includes('--follow')
        const since = flagValue(rest, '--since')
        const limitRaw = flagValue(rest, '--limit')
        let limit: number | undefined
        if (limitRaw !== undefined) {
          const parsed = Number(limitRaw)
          if (!Number.isFinite(parsed) || parsed < 1) {
            die('Usage: duo events [--follow] [--since <cursor>] [--limit N]')
          }
          limit = Math.floor(parsed)
        }
        const args: Record<string, unknown> = {}
        if (since !== undefined) args['since'] = since
        if (limit !== undefined) args['limit'] = limit
        const printEventLine = (event: unknown): void => {
          process.stdout.write(JSON.stringify(event) + '\n')
        }
        if (!follow) {
          // Snapshot \u2014 single response.
          const result = await send('events', args) as { events: unknown[] }
          for (const event of result.events ?? []) printEventLine(event)
        } else {
          // Follow \u2014 streaming. Server emits the replay (events with
          // cursor > since) BEFORE attaching the live subscriber, so
          // we print every line we receive in order.
          args['follow'] = true
          await sendStreamed('events', args,
            () => { /* ack \u2014 nothing to print */ },
            (event) => printEventLine(event)
          )
        }
        break
      }
      case 'split-view': {
        // ENH-041 / Sprint 3 \u2014 Split View aux pane. User-facing label
        // matches the right-click menu items ("Move to Split View",
        // "Open in Split View"). Sub-verbs:
        //   duo split-view open <path>            \u2014 open path in aux (file)
        //   duo split-view open-browser <id>      \u2014 pin browser tab id into aux
        //                                          (Sprint 7 Phase 3c)
        //   duo split-view close                   \u2014 close aux (file or browser)
        //   duo split-view promote                 \u2014 move aux's tab back to main
        //   duo split-view resize <pct>            \u2014 set splitPct (0.0\u20131.0)
        //   duo split-view                         \u2014 print current state
        const sub = rest[0]
        if (sub === undefined || sub === 'state') {
          out(await send('split-view', {}))
          break
        }
        if (sub === 'open') {
          const p = rest[1]
          if (!p) die('Usage: duo split-view open <path>')
          const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
          out(await send('split-view', { op: 'open', path: resolved }))
          break
        }
        if (sub === 'open-browser') {
          // Phase 3c \u2014 pin a browser tab (numeric id from `duo tab`)
          // into the aux slot. Mirrors the right-click "Move to Split
          // View" gesture on a browser tab.
          const idArg = rest[1]
          if (idArg === undefined) die('Usage: duo split-view open-browser <browser-tab-id>')
          const browserTabId = Number(idArg)
          if (!Number.isInteger(browserTabId) || browserTabId < 1) {
            die('Usage: duo split-view open-browser <browser-tab-id>  (positive integer; from `duo tab` listing)')
          }
          out(await send('split-view', { op: 'open-browser', browserTabId }))
          break
        }
        if (sub === 'close') {
          out(await send('split-view', { op: 'close' }))
          break
        }
        if (sub === 'promote') {
          out(await send('split-view', { op: 'promote' }))
          break
        }
        if (sub === 'resize') {
          const pctArg = rest[1]
          if (pctArg === undefined) die('Usage: duo split-view resize <pct>')
          const parsed = Number(pctArg)
          if (!Number.isFinite(parsed)) die('Usage: duo split-view resize <pct>')
          out(await send('split-view', { op: 'resize', pct: parsed }))
          break
        }
        die(`Unknown split-view sub-verb: ${sub}. Expected: open|open-browser|close|promote|resize|state`)
      }
      case 'split': {
        // ENH-014 \u2014 `duo split <pct>` sets the split-pane percentage
        // (terminal column width as % of the split container). Clamps
        // to 20\u201380 server-side. Also accepts named presets to mirror
        // the View \u2192 Pane size menu shortcuts.
        // ENH-099 \u2014 `3way` preset is special: snaps to outer 33/67
        // PLUS inner aux 50/50 (when aux is open). Routes through the
        // dedicated `layout-3way-even` socket verb instead of `split`.
        const arg = rest[0]
        if (arg === undefined) {
          die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy|3way>')
        }
        if (arg === '3way' || arg === '3-way' || arg === 'even-3way') {
          out(await send('layout-3way-even', {}))
          break
        }
        const presets: Record<string, number> = {
          even: 50,
          'terminal-heavy': 67,
          'canvas-heavy': 33,
          terminal: 80,
          canvas: 20
        }
        let pct: number
        if (arg in presets) {
          pct = presets[arg]
        } else {
          const parsed = Number(arg)
          if (!Number.isFinite(parsed)) {
            die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy|3way>')
          }
          pct = parsed
        }
        out(await send('split', { pct }))
        break
      }
      case 'doc': {
        // `duo doc <subcmd>` for editor doc operations.
        const sub = rest[0]
        const subRest = rest.slice(1)
        // BUG-145 — focused per-verb help so the agent doesn't have to
        // page through the ~200-line global --help. `duo doc --help` or
        // `duo doc <subcmd> --help` returns just the doc-verb section.
        if (sub === '--help' || sub === '-h' || !sub) {
          if (!sub && rest.length === 0) {
            // Original behavior: bare `duo doc` falls through to the
            // usage error below. Preserve that.
          } else {
            printDocHelp(undefined)
            break
          }
        }
        if (subRest.includes('--help') || subRest.includes('-h')) {
          printDocHelp(sub)
          break
        }
        if (sub === 'write') {
          const replaceAll = subRest.includes('--replace-all')
          const textIdx = subRest.indexOf('--text')
          let text: string
          if (textIdx !== -1) {
            text = subRest.slice(textIdx + 1).join(' ')
          } else {
            text = await readStdin()
          }
          const mode = replaceAll ? 'replace-all' : 'replace-selection'
          out(await send('doc-write', { text, mode }))
        } else if (sub === 'read') {
          // Optional path arg: `duo doc read [path]`. Without a path, the
          // active editor responds. With a path, the active editor only
          // responds if it matches; otherwise an error.
          const target = subRest[0]
          const resolved = target ? resolveFilePath(target) : undefined
          const res = await send('doc-read', resolved ? { path: resolved } : {}) as {
            ok: boolean; text?: string; path?: string; dirty?: boolean; error?: string
          }
          if (!res.ok) die(res.error ?? 'doc read failed')
          // Print the live buffer text directly to stdout. Path + dirty
          // status go to stderr so the body remains pipe-friendly.
          if (res.path !== undefined) {
            process.stderr.write(`# ${res.path}${res.dirty ? ' (unsaved changes)' : ''}\n`)
          }
          process.stdout.write(res.text ?? '')
          if (res.text && !res.text.endsWith('\n')) process.stdout.write('\n')
        } else if (sub === 'goto') {
          // ENH-022 — `duo doc goto [<path>] --heading X | --line N | --anchor Y`.
          // Optional positional path; one of three flags required.
          const heading = flagValue(subRest, '--heading')
          const lineStr = flagValue(subRest, '--line')
          const anchor = flagValue(subRest, '--anchor')
          // First positional that isn't a flag value = path. Walk subRest
          // skipping --flag <value> pairs.
          let target: string | undefined
          for (let i = 0; i < subRest.length; i++) {
            const token = subRest[i]
            if (token === '--heading' || token === '--line' || token === '--anchor') {
              i += 1 // skip the value
              continue
            }
            if (token.startsWith('--')) continue
            target = token
            break
          }
          if (heading === undefined && lineStr === undefined && anchor === undefined) {
            die('Usage: duo doc goto [<path>] --heading "X" | --line N | --anchor "Y"')
          }
          const resolved = target ? resolveFilePath(target) : undefined
          const payload: Record<string, unknown> = {}
          if (resolved !== undefined) payload.path = resolved
          if (heading !== undefined) payload.heading = heading
          if (lineStr !== undefined) {
            const n = Number(lineStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--line requires a positive integer')
            }
            payload.line = n
          }
          if (anchor !== undefined) payload.anchor = anchor
          out(await send('doc-goto', payload))
        } else if (sub === 'find') {
          // ENH-023 — `duo doc find <query> [<path>] [--case-sensitive]`.
          const caseSensitive = subRest.includes('--case-sensitive')
          const positionals = subRest.filter(t => !t.startsWith('--'))
          const query = positionals[0]
          if (!query) die('Usage: duo doc find <query> [<path>] [--case-sensitive]')
          const target = positionals[1]
          const resolved = target ? resolveFilePath(target) : undefined
          const payload: Record<string, unknown> = { query }
          if (resolved !== undefined) payload.path = resolved
          if (caseSensitive) payload['case-sensitive'] = true
          out(await send('doc-find', payload))
        } else if (sub === 'conflict-log') {
          // BUG-122 — print the last-recorded conflict diagnostic.
          // Read-only file dump; no IPC. The renderer's
          // writeConflictLog (renderer/utils/conflictDiagnostic.ts)
          // writes `~/.claude/duo/logs/last-conflict.log` on every
          // banner-surfacing event (watcher-dirty + save-pre-
          // reconcile). One-file, latest-only — new conflicts
          // overwrite the prior log.
          const logPath = path.join(os.homedir(), '.claude', 'duo', 'logs', 'last-conflict.log')
          try {
            const raw = fs.readFileSync(logPath, 'utf8')
            process.stdout.write(raw)
            if (!raw.endsWith('\n')) process.stdout.write('\n')
          } catch (err: any) {
            if (err?.code === 'ENOENT') {
              process.stderr.write(`No conflict log yet at ${logPath}\n`)
              process.stderr.write('(One will be written the next time the save-conflict banner surfaces.)\n')
              process.exit(0)
            }
            die(`Could not read ${logPath}: ${err?.message ?? err}`)
          }
        } else if (sub === 'edit') {
          // ENH-195 — `duo doc edit <file> --find "X" --replace "Y"
          // [--occurrence N | --all] [--at-line N]`. Surgical PLAIN-text
          // markdown replace (literal, non-CriticMarkup — a direct
          // accepted edit). Echo-safe when the file is open in the
          // editor (buffer-routed through the editor's save), disk-direct
          // when closed. Distinct from the CriticMarkup verbs above
          // (insert/delete/substitute), which wrap the change as a
          // tracked suggestion.
          const target = subRest.find(a => !a.startsWith('--')) ??
            die('Usage: duo doc edit <file> --find "X" --replace "Y" [--occurrence N | --all] [--at-line N]')
          const find = flagValue(subRest, '--find')
          const replace = flagValue(subRest, '--replace')
          if (find === undefined) die('duo doc edit requires --find "<text>"')
          if (replace === undefined) die('duo doc edit requires --replace "<text>" (may be empty to delete the match)')
          const all = subRest.includes('--all')
          const occStr = flagValue(subRest, '--occurrence')
          if (all && occStr !== undefined) {
            die('duo doc edit: pass --occurrence N OR --all, not both')
          }
          const resolved = resolveFilePath(target)
          const payload: Record<string, unknown> = { path: resolved, find, replace }
          if (all) payload.all = true
          if (occStr !== undefined) {
            const n = Number(occStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--occurrence requires a positive integer')
            }
            payload.occurrence = n
          }
          const atLineStr = flagValue(subRest, '--at-line')
          if (atLineStr !== undefined) {
            const n = Number(atLineStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--at-line requires a positive integer')
            }
            payload.atLine = n
          }
          out(await send('doc-edit-plain', payload))
        } else if (
          sub === 'insert' || sub === 'delete' || sub === 'substitute' ||
          sub === 'highlight' ||
          sub === 'comment' || sub === 'accept' || sub === 'reject'
        ) {
          // BUG-138 Phase 3 — agent CriticMarkup verbs. Each subcommand
          // parses its own flag set, then routes through the single
          // `doc-edit` socket command with a discriminated `op` arg.
          // The file path is the first positional that isn't a flag value.
          //
          // Author is passed via the DUO_AUTHOR env var (defaults to
          // 'agent' on the receiver side). The CLI doesn't read it
          // here — the socket-server resolves the value to keep all
          // attribution decisions in one place.
          const positionals: string[] = []
          for (let i = 0; i < subRest.length; i++) {
            const t = subRest[i]
            if (t === '--after' || t === '--before' || t === '--text' ||
                t === '--with' || t === '--anchor' || t === '--body' ||
                t === '--reply-to' || t === '--match' || t === '--id' ||
                t === '--occurrence' || t === '--at-line') {
              i += 1 // skip the value
              continue
            }
            if (t.startsWith('--')) continue
            positionals.push(t)
          }
          const target = positionals[0]
          if (!target) die(`Usage: duo doc ${sub} <file> [flags] — see duo --help`)
          const resolved = resolveFilePath(target)
          const payload: Record<string, unknown> = { path: resolved, op: sub }

          const dupAuthor = process.env.DUO_AUTHOR
          if (dupAuthor) payload.author = dupAuthor
          const occStr = flagValue(subRest, '--occurrence')
          if (occStr !== undefined) {
            const n = Number(occStr)
            if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
              die('--occurrence requires a positive integer')
            }
            payload.occurrence = n
          }

          if (sub === 'insert') {
            const after = flagValue(subRest, '--after')
            const before = flagValue(subRest, '--before')
            const atLine = flagValue(subRest, '--at-line')
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc insert <file> --text "…" (--after "X" | --before "X" | --at-line N)')
            if ([after, before, atLine].filter(v => v !== undefined).length !== 1) {
              die('duo doc insert requires exactly one of --after / --before / --at-line')
            }
            payload.text = text
            if (after !== undefined) payload.after = after
            if (before !== undefined) payload.before = before
            if (atLine !== undefined) {
              const n = Number(atLine)
              if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
                die('--at-line requires a positive integer')
              }
              payload.atLine = n
            }
          } else if (sub === 'delete') {
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc delete <file> --text "<target>"')
            payload.text = text
          } else if (sub === 'highlight') {
            // BUG-138 family — `{==X==}` highlight, CLI-parity sibling
            // to delete. Same flag shape.
            const text = flagValue(subRest, '--text')
            if (!text) die('Usage: duo doc highlight <file> --text "<target>"')
            payload.text = text
          } else if (sub === 'substitute') {
            const text = flagValue(subRest, '--text')
            const withText = flagValue(subRest, '--with')
            if (!text || withText === undefined) {
              die('Usage: duo doc substitute <file> --text "<old>" --with "<new>"')
            }
            payload.text = text
            payload.with = withText
          } else if (sub === 'comment') {
            const anchor = flagValue(subRest, '--anchor')
            const body = flagValue(subRest, '--body')
            const replyTo = flagValue(subRest, '--reply-to')
            // BUG-143 — --anchor is required for NEW comments only.
            // For replies (--reply-to <c-id>), --anchor is optional; the
            // server appends `↪ @author ts: body` to the parent token.
            if (!body) {
              die('Usage:\n  Add comment:  duo doc comment <file> --anchor "<text>" --body "<comment>"\n  Reply to:     duo doc comment <file> --reply-to <c-id> --body "<reply>"')
            }
            if (!anchor && !replyTo) {
              die('Usage:\n  Add comment:  duo doc comment <file> --anchor "<text>" --body "<comment>"\n  Reply to:     duo doc comment <file> --reply-to <c-id> --body "<reply>"')
            }
            if (anchor) payload.anchor = anchor
            payload.body = body
            if (replyTo !== undefined) payload.replyTo = replyTo
          } else if (sub === 'accept' || sub === 'reject') {
            const match = flagValue(subRest, '--match')
            const id = flagValue(subRest, '--id')
            if (!match && !id) {
              die(`Usage: duo doc ${sub} <file> (--id <c-id> | --match "<text>")`)
            }
            if (match) payload.match = match
            if (id) payload.id = id
          }

          out(await send('doc-edit', payload))
        } else {
          die('Usage: duo doc <write|read|goto|find|edit|conflict-log|insert|delete|substitute|highlight|comment|accept|reject> [...]')
        }
        break
      }
      case 'reveal': {
        const target = rest[0] ?? die('Usage: duo reveal <path>')
        const resolved = resolveFilePath(target)
        out(await send('reveal', { path: resolved }))
        break
      }
      case 'ls': {
        const target = rest[0]
        const resolved = target ? resolveFilePath(target) : undefined
        out(await send('ls', resolved ? { path: resolved } : {}))
        break
      }
      case 'nav-state': {
        out(await send('nav-state'))
        break
      }
      case 'nav': {
        // Stage 26 PR 2 (ENH-010) — `duo nav state | pin | unpin | pins`.
        // 'state' echoes the navigator snapshot (cwd, selected, expanded).
        // 'pin' / 'unpin' / 'pins' manage the navigator pin list at
        // ~/.claude/duo/nav-pins.json (separate from Stage 24's tab pins).
        const sub = rest[0]
        if (!sub || sub === 'state') {
          out(await send('nav-state'))
        } else if (sub === 'pin' || sub === 'unpin') {
          const pathArg = rest[1] ?? die(`Usage: duo nav ${sub} <path>`)
          const resolved = resolveFilePath(pathArg)
          // Stat the resolved path so we can record the right kind.
          // resolveFilePath already exists checks; if the path doesn't
          // exist, the agent gets a clear error from the renderer.
          let kind: 'file' | 'folder' = 'file'
          try {
            const st = await import('fs').then(m => m.promises.stat(resolved))
            kind = st.isDirectory() ? 'folder' : 'file'
          } catch {
            // Pin a non-existent path? Default to 'file'; the renderer
            // surfaces the missing file in the section with a faint
            // "missing" treatment.
          }
          out(await send('nav-pin', { op: sub, path: resolved, kind }))
        } else if (sub === 'pins') {
          out(await send('nav-pin', { op: 'list' }))
        } else {
          die('Usage: duo nav <state|pin|unpin|pins> ...')
        }
        break
      }
      case 'wait': {
        const selector = rest[0] ?? die('Usage: duo wait <selector> [--timeout ms]')
        const timeoutIdx = rest.indexOf('--timeout')
        const timeout = timeoutIdx !== -1 ? parseInt(rest[timeoutIdx + 1], 10) : undefined
        // Stage 20 — keep the socket alive past the agent-requested wait
        // timeout, otherwise `duo wait --timeout 30000` hits the default
        // 10s socket cap and rejects with "Timeout" while the renderer
        // is still waiting. 5s buffer covers serialization + RTT.
        const socketTimeoutMs = timeout
          ? Math.max(timeout + 5_000, TIMEOUT_MS)
          : undefined
        out(await send('wait', { selector, timeout }, { timeoutMs: socketTimeoutMs }))
        break
      }
      case 'external': {
        const url = rest[0] ?? die('Usage: duo external <url>')
        out(await send('external', { url }))
        break
      }
      case 'selection-format': {
        // `duo selection-format`           → print current state (JSON)
        // `duo selection-format <a|b|c>`   → set + print new state
        const format = rest[0]
        if (format === undefined) {
          out(await send('selection-format'))
        } else {
          if (format !== 'a' && format !== 'b' && format !== 'c') {
            die('Usage: duo selection-format [a|b|c]')
          }
          out(await send('selection-format', { format }))
        }
        break
      }
      case 'send': {
        // `duo send --text "…"`            → write the literal arg
        // `cat foo | duo send`             → write stdin
        // No Enter appended by default (Stage 15 G11 — user confirms).
        // Stage 23b — `--enter` appends a newline so the agent (or a
        // canvas action) can submit a command without two round-trips.
        // Strip --enter from rest BEFORE we slurp the rest into the
        // text payload so it isn't accidentally written to the PTY.
        const enterIdx = rest.indexOf('--enter')
        const enter = enterIdx !== -1
        const argv = enter ? [...rest.slice(0, enterIdx), ...rest.slice(enterIdx + 1)] : rest
        const textIdx = argv.indexOf('--text')
        let text: string
        if (textIdx !== -1) {
          text = argv.slice(textIdx + 1).join(' ')
        } else {
          text = await readStdin()
        }
        if (text === '') die('Usage: duo send [--enter] --text "…"  |  echo … | duo send [--enter]')
        if (enter) text = `${text}\n`
        out(await send('send', { text }))
        break
      }
      case 'html': {
        // Stage 17a — `duo html <subcmd>`. `new` ships in 17a;
        // query / get / set / replace / append / remove / attr ship in
        // 17b Phase C. `comment` / `changes` / `allow-scripts` land in
        // 17d/e per the Stage 17 PRD § 7.
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'new') {
          const target = subRest[0] ?? die('Usage: duo html new <path.html> [--title "…"]')
          if (!/\.html?$/i.test(target)) {
            die('duo html new: path must end in .html or .htm')
          }
          const titleIdx = subRest.indexOf('--title')
          const title = titleIdx !== -1 ? subRest.slice(titleIdx + 1).join(' ') : undefined
          const resolved = resolveFilePath(target)
          out(await send('html-new', title ? { path: resolved, title } : { path: resolved }))
          break
        }

        // Stage 17b Phase C — agent ops against the active canvas.
        // Common flag parsing. Local one-arg shim wraps the module-scope
        // two-arg `flagValue` so the dense html-op handlers stay legible
        // without re-passing `subRest` on every call.
        const flag = (name: string): string | undefined => flagValue(subRest, name)
        const collectAttrs = (): { set?: Record<string, string>; remove?: string[] } => {
          // --set k=v can repeat; --remove k can repeat.
          const set: Record<string, string> = {}
          const remove: string[] = []
          for (let i = 0; i < subRest.length; i++) {
            if (subRest[i] === '--set') {
              const kv = subRest[i + 1] ?? ''
              const eq = kv.indexOf('=')
              if (eq === -1) die(`duo html attr: --set expects key=value (got "${kv}")`)
              set[kv.slice(0, eq)] = kv.slice(eq + 1)
              i++
            } else if (subRest[i] === '--remove') {
              if (!subRest[i + 1]) die('duo html attr: --remove expects an attribute name')
              remove.push(subRest[i + 1])
              i++
            }
          }
          const out: { set?: Record<string, string>; remove?: string[] } = {}
          if (Object.keys(set).length > 0) out.set = set
          if (remove.length > 0) out.remove = remove
          return out
        }

        if (sub === 'query') {
          const selector = subRest[0]
          if (!selector) die('Usage: duo html query <css-selector>')
          out(await send('html-op', { op: 'query', selector }))
        } else if (sub === 'get') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html get --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'get', id, selector }))
        } else if (sub === 'set') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html set --id <duo-id> --content "…"')
          let html = flag('--content') ?? flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html set: content required (use --content "…" or pipe via stdin)')
          out(await send('html-op', { op: 'set', id, selector, html }))
        } else if (sub === 'replace') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html replace --id <duo-id> --html "…"')
          let html = flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html replace: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'replace', id, selector, html }))
        } else if (sub === 'append') {
          const parentId = flag('--parent') ?? flag('--parent-id')
          const parentSelector = flag('--parent-selector')
          if (!parentId && !parentSelector) die('Usage: duo html append --parent <duo-id> --html "…"')
          let html = flag('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html append: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'append', parentId, parentSelector, html }))
        } else if (sub === 'remove') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html remove --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'remove', id, selector }))
        } else if (sub === 'attr') {
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]')
          const ops = collectAttrs()
          if (!ops.set && !ops.remove) die('duo html attr: at least one --set k=v or --remove k required')
          out(await send('html-op', { op: 'attr', id, selector, ...ops }))
        } else if (sub === 'click') {
          // ENH-055 — programmatic click. Resolves the target via
          // --id (preferred) or --selector, calls element.click().
          // Triggers the canvas-action delegated dispatcher just
          // like a real user click — `data-duo-action` verbs fire,
          // events emit, etc. Used by lesson fly-through harnesses.
          const id = flag('--id')
          const selector = flag('--selector')
          if (!id && !selector) die('Usage: duo html click --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'click', id, selector }))
        } else if (sub === 'comment') {
          // Stage 17d — `duo html comment`. Anchor via --id, --selector,
          // or --text; --body is required (or via stdin).
          const id = flag('--id')
          const selector = flag('--selector')
          const text = flag('--text')
          if (!id && !selector && !text) {
            die('Usage: duo html comment --id <duo-id> | --selector <css> | --text "<substring>" --body "…"')
          }
          let body = flag('--body')
          if (body === undefined) body = await readStdin()
          if (!body || body.trim() === '') {
            die('duo html comment: --body required (use --body "…" or pipe via stdin)')
          }
          out(await send('html-comment', { id, selector, text, body }))
        } else if (sub === 'comments') {
          // Stage 17d — `duo html comments` lists threads on the active
          // canvas. Optional --filter all|open|resolved (default 'all').
          const filterRaw = flag('--filter')
          const filter = filterRaw ?? 'all'
          if (filter !== 'all' && filter !== 'open' && filter !== 'resolved') {
            die("duo html comments: --filter must be 'all', 'open', or 'resolved'")
          }
          out(await send('html-comments', { filter }))
        } else {
          die('Usage: duo html <new|query|get|set|replace|append|remove|attr|comment|comments> [...]')
        }
        break
      }
      case 'file': {
        // Stage 26 item 6 — file-mutation actions matching the navigator's
        // right-click menu. Recoverable trash + same-fs rename:
        //   duo file rename <old> <new>     → fs.rename
        //   duo file trash <path>           → shell.trashItem (macOS Trash)
        const sub = rest[0]
        if (sub === 'rename') {
          const oldArg = rest[1] ?? die('Usage: duo file rename <old> <new>')
          const newArg = rest[2] ?? die('Usage: duo file rename <old> <new>')
          const oldPath = resolveFilePath(oldArg)
          const newPath = resolveFilePath(newArg)
          out(await send('file', { op: 'rename', oldPath, newPath }))
        } else if (sub === 'trash') {
          const pathArg = rest[1] ?? die('Usage: duo file trash <path>')
          const resolved = resolveFilePath(pathArg)
          out(await send('file', { op: 'trash', path: resolved }))
        } else {
          die('Usage: duo file <rename|trash> ...')
        }
        break
      }
      case 'new-tab': {
        // Stage 19c D27 — open a new terminal tab.
        //   duo new-tab                        → persisted last-kind, navigator pending CWD
        //   duo new-tab --shell                → vanilla shell
        //   duo new-tab --claude               → auto-launches `claude`
        //   duo new-tab --cwd <path>           → explicit CWD (overrides navigator)
        //   duo new-tab --cmd "<text>"         → pre-typed payload (no trailing newline)
        // Returns {id, kind, cwd, title}.
        const args: { kind?: 'shell' | 'claude'; cwd?: string; cmd?: string } = {}
        if (rest.includes('--shell') && rest.includes('--claude')) {
          die('Usage: duo new-tab [--shell|--claude] — pick at most one')
        }
        if (rest.includes('--shell')) args.kind = 'shell'
        if (rest.includes('--claude')) args.kind = 'claude'
        const cwdIdx = rest.indexOf('--cwd')
        if (cwdIdx !== -1) {
          const v = rest[cwdIdx + 1]
          if (!v) die('Usage: duo new-tab --cwd <path>')
          args.cwd = resolveFilePath(v)
        }
        const cmdIdx = rest.indexOf('--cmd')
        if (cmdIdx !== -1) {
          const v = rest[cmdIdx + 1]
          if (v === undefined) die('Usage: duo new-tab --cmd "<text>"')
          args.cmd = v
        }
        out(await send('new-tab', args as Record<string, unknown>))
        break
      }
      case 'devtools': {
        // ENH-123 — open DevTools on the main renderer (default) or
        // the active browser pane. --close closes any open instance
        // for the chosen target.
        //
        //   duo devtools                    # main renderer DevTools
        //   duo devtools --browser-pane     # active browser tab DevTools
        //   duo devtools --close            # close renderer DevTools
        //   duo devtools --browser-pane --close  # close browser DevTools
        const target = rest.includes('--browser-pane') ? 'browser-pane' : 'renderer'
        const close = rest.includes('--close')
        out(await send('devtools', { target, close }))
        break
      }
      case 'layout': {
        // ENH-124 — JSON snapshot of WorkingPane / terminal /
        // navigator state. Pairs with `duo nav-state` (file tree) and
        // `duo dom` (renderer DOM) as the third visibility verb.
        out(await send('layout', {}))
        break
      }
      case 'status': {
        // ENH-195 — high-level app snapshot: open file/browser tabs
        // (with per-tab dirty / active / pinned), the active working
        // tab, focused column, theme, terminal-tab count. The keystone
        // orientation verb — run it first to see what the user is
        // looking at. Read live from the renderer (no cache).
        out(await send('status', {}))
        break
      }
      case 'json': {
        // ENH-195 — structured edits to a JSON / YAML file.
        //   duo json set <file> <dotpath> <value>   # set value at path
        //   duo json merge <file> <patch.json>      # deep-merge object
        // Echo-safe when the file is open in the JSON viewer (buffer-
        // routed through its save); disk-direct (JSON.parse / js-yaml)
        // when closed. <value> is parsed as JSON if it parses, else
        // treated as a literal string. <dotpath> is dotted with `[n]`
        // array indices; empty string or '.' targets the root. YAML
        // round-trips lose comments (noted in the reply reason).
        const sub = rest[0]
        const subRest = rest.slice(1)
        if (sub === 'set') {
          const file = subRest[0]
          const pointer = subRest[1]
          // Everything after the pointer is the value (so unquoted
          // multi-word strings survive); pointer may be '' or '.'.
          if (file === undefined || pointer === undefined || subRest.length < 3) {
            die('Usage: duo json set <file> <dotpath> <value>\n  <dotpath>: dotted with [n] indices; "" or "." = root.\n  <value>: parsed as JSON if valid, else treated as a literal string.')
          }
          const rawValue = subRest.slice(2).join(' ')
          // Try to parse as JSON (number / bool / null / object / array /
          // quoted string); on failure, treat it as a literal string and
          // JSON-encode that so the wire payload is always valid JSON.
          let valueJson: string
          try {
            JSON.parse(rawValue)
            valueJson = rawValue
          } catch {
            valueJson = JSON.stringify(rawValue)
          }
          const resolved = resolveFilePath(file)
          out(await send('json-op', { path: resolved, op: 'set', pointer, valueJson }))
        } else if (sub === 'merge') {
          const file = subRest[0]
          const patchPath = subRest[1]
          if (file === undefined || patchPath === undefined) {
            die('Usage: duo json merge <file> <patch.json>')
          }
          const resolvedPatch = resolveFilePath(patchPath)
          let mergeJson: string
          try {
            mergeJson = fs.readFileSync(resolvedPatch, 'utf8')
          } catch (err: any) {
            die(`Could not read patch file ${resolvedPatch}: ${err?.message ?? err}`)
          }
          // Validate it parses as JSON before sending (friendlier than a
          // server-side parse error).
          try {
            JSON.parse(mergeJson)
          } catch (e) {
            die(`Patch file ${resolvedPatch} is not valid JSON: ${(e as Error).message}`)
          }
          const resolved = resolveFilePath(file)
          out(await send('json-op', { path: resolved, op: 'merge', mergeJson }))
        } else {
          die('Usage:\n  duo json set <file> <dotpath> <value>\n  duo json merge <file> <patch.json>')
        }
        break
      }
      case 'inspect': {
        // ENH-159b — toggle element-inspect mode in the active
        // browser pane. No arg → toggle; --on / --off force a state.
        // Mirrors Chrome devtools' Inspect Element (⌘⇧C inside Duo
        // also fires this from the WCV via the keystroke forwarder).
        //
        //   duo inspect              # toggle
        //   duo inspect --on         # force on
        //   duo inspect --off        # force off
        //
        // While active, hover an element to outline it; click to ship
        // its tag + selector + heading trail + innerText + key attrs
        // to the active terminal as a structured paste. ESC exits
        // without picking.
        const on = rest.includes('--on')
        const off = rest.includes('--off')
        if (on && off) die('Usage: duo inspect [--on|--off]')
        out(await send('inspect', { on, off }))
        break
      }
      case 'doctor':
        await runDoctor()
        break
      case 'install': {
        const system = rest.includes('--system')
        runInstall({ system })
        break
      }
      case 'pack': {
        // Stage 21d-iii — distro pack management.
        //   duo pack list                — JSON list of installed packs
        //   duo pack uninstall <name>    — remove a pack
        // Future: duo pack install <url> (FOLLOWUP-010)
        const sub = rest[0]
        if (sub === 'list') {
          out(await send('pack-list', {}))
          break
        }
        if (sub === 'uninstall') {
          const name = rest[1]
          if (!name) die('Usage: duo pack uninstall <distro-name>')
          const removeFolder = rest.includes('--remove-folder')
          out(await send('pack-uninstall', { name, removeFolder }))
          break
        }
        die('Usage: duo pack list  |  duo pack uninstall <name> [--remove-folder]')
      }
      case 'git-status': {
        // ENH-152a — git status probe for the Navigator root chip.
        //   duo git-status [<path>]   — defaults to $HOME.
        // Returns the full GitStatusSnapshot JSON; the renderer
        // filters down to the chip via formatGitStatusChip.
        const cwd = rest[0]
        out(await send('git-status', cwd ? { cwd } : {}))
        break
      }
      case 'clone': {
        // ENH-151 — `gh repo clone` (preferred) / `git clone` fallback.
        //   duo clone <url> [<target-dir>]
        // Probes `gh auth status` first; falls back to git for public
        // repos. Non-zero exit on failure; --json outputs the structured
        // result so agents can branch on errorKind (bad-url / auth-missing
        // / clone-failed).
        const url = rest[0]
        if (!url) die('Usage: duo clone <url> [<target-dir>]')
        const targetDir = rest[1] && !rest[1].startsWith('--') ? rest[1] : undefined
        const result = (await send('clone', { url, targetDir })) as {
          ok: boolean
          clonedTo?: string
          errorKind?: string
          error?: string
          via?: string
        }
        if (rest.includes('--json')) {
          out(JSON.stringify(result, null, 2))
        } else if (result.ok) {
          out(`Cloned via ${result.via} → ${result.clonedTo}`)
        } else {
          die(`clone failed (${result.errorKind ?? 'unknown'}): ${result.error ?? 'no detail'}`)
        }
        break
      }
      case 'gh-auth': {
        // ENH-151 — `gh auth status` probe. JSON-only output; used by
        // the Clone modal + future Doctor panel.
        //   duo gh-auth
        out(await send('gh-auth', {}))
        break
      }
      case 'close-tab': {
        // FOLLOWUP-020 — close the focused working-pane file/canvas/
        // viewer tab. CLI parity for the ⌘W chord on the working strip.
        // Pinned-tab gating is the renderer's job (dialog.confirm); a
        // CLI close of a pinned tab still surfaces the confirmation.
        out(await send('close-tab', {}))
        break
      }
      case 'close-terminal-tab': {
        // FOLLOWUP-020 — close a terminal tab.
        //   duo close-terminal-tab       → close the focused terminal tab
        //   duo close-terminal-tab <n>   → close the Nth terminal tab (1-indexed)
        const arg = rest[0]
        const n = arg ? Number.parseInt(arg, 10) : undefined
        if (arg && (Number.isNaN(n) || n! < 1)) {
          die('Usage: duo close-terminal-tab [<n>]   (n is 1-indexed)')
        }
        out(await send('close-terminal-tab', n !== undefined ? { n } : {}))
        break
      }
      case 'workspace': {
        // ENH-167 — workspace-as-file.
        //   duo workspace save [<path>] [--name <name>] [--save-as]
        //   duo workspace open <path>
        //   duo workspace list-recent [--json]
        //   duo workspace current [--json]
        //   duo workspace new
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo workspace <save|open|list-recent|current|new> [args]')
        }
        if (sub === 'save') {
          const subRest = rest.slice(1)
          // First non-flag positional = path (optional).
          const path = subRest.find(a => !a.startsWith('-'))
          const name = flagValue(subRest, '--name')
          const saveAs = subRest.includes('--save-as')
          const payload: Record<string, unknown> = { op: 'save' }
          if (path) payload.path = path
          if (name) payload.name = name
          if (saveAs) payload['save-as'] = true
          out(await send('workspace', payload))
        } else if (sub === 'open') {
          const path = rest[1]
          if (!path) die('Usage: duo workspace open <path>')
          out(await send('workspace', { op: 'open', path }))
        } else if (sub === 'list-recent') {
          out(await send('workspace', { op: 'list-recent' }))
        } else if (sub === 'current') {
          out(await send('workspace', { op: 'current' }))
        } else if (sub === 'new') {
          out(await send('workspace', { op: 'new' }))
        } else {
          die(`Unknown workspace sub-op: ${sub}. Expected save|open|list-recent|current|new.`)
        }
        break
      }
      case 'session': {
        // ENH-183 pared 2026-05-25 (Option A) — rename + hydrate dropped.
        //   duo session list [--cwd <path>]
        //   duo session resume <tabId> <uuid>
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo session <list|resume> [args]')
        }
        if (sub === 'list') {
          const cwd = flagValue(rest, '--cwd')
          const payload: Record<string, unknown> = { op: 'list' }
          if (cwd) payload.cwd = cwd
          out(await send('session', payload))
        } else if (sub === 'resume') {
          const tabId = rest[1]
          const uuid = rest[2]
          if (!tabId || !uuid) die('Usage: duo session resume <tabId> <uuid>')
          out(await send('session', { op: 'resume', tabId, uuid }))
        } else {
          die(`Unknown session sub-op: ${sub}. Expected list|resume.`)
        }
        break
      }

      case 'workspace-pill-menu': {
        // ENH-184 (Sprint 23 / v0.8.0) — toggle the workspace-pill
        // click-to-open-menu localStorage flag (default OFF). Bare
        // command reads cached state; arg writes.
        const mode = rest[0]
        if (mode === undefined) {
          out(await send('workspace-pill-menu'))
        } else {
          if (mode !== 'on' && mode !== 'off' && mode !== 'toggle') {
            die('Usage: duo workspace-pill-menu [on|off|toggle]')
          }
          out(await send('workspace-pill-menu', { mode }))
        }
        break
      }

      case 'project': {
        // ENH-182 Phase 4 (Sprint 23 / v0.8.0) — project rail CLI parity.
        //   duo project list
        //   duo project focus <name|root>
        //   duo project focus --all
        //   duo project pin <name|root>
        //   duo project unpin <name|root>
        //   duo project close <name|root>
        // Name resolution is case-insensitive against the cached rail
        // snapshot (renderer pushes via PROJECTS_STATE_PUSH); exact root
        // path match wins, then unique name match.
        const sub = rest[0]
        if (!sub) {
          die('Usage: duo project <list|focus|pin|unpin|close> [args]')
        }
        if (sub === 'list') {
          out(await send('project', { op: 'list' }))
        } else if (sub === 'focus' || sub === 'pin' || sub === 'unpin' || sub === 'close') {
          const ref = rest[1]
          if (!ref) {
            if (sub === 'focus') die('Usage: duo project focus <name|root> | --all')
            die(`Usage: duo project ${sub} <name|root>`)
          }
          out(await send('project', { op: sub, ref }))
        } else {
          die(`Unknown project sub-op: ${sub}. Expected list|focus|pin|unpin|close.`)
        }
        break
      }

      default:
        die(`Unknown command: ${cmd}\nRun duo --help for usage`)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

// Read all stdin into a string. Used by `duo doc write` so agents can pipe
// content via shell heredocs / process substitution.
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      // No pipe — return empty rather than blocking forever on a terminal.
      resolve('')
      return
    }
    const chunks: Buffer[] = []
    process.stdin.on('data', (c) => chunks.push(Buffer.from(c)))
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', reject)
  })
}

// Resolves a filesystem path arg to an absolute path (no `file://` prefix),
// expanding `~` and making relative paths absolute against the CLI's CWD.
// Used by `duo view` / `duo reveal` / `duo ls` (they talk in raw paths;
// it's the working pane that translates to `file://` when needed).
function resolveFilePath(input: string): string {
  if (input.startsWith('~/') || input === '~') {
    return path.resolve(input.replace(/^~/, os.homedir()))
  }
  if (path.isAbsolute(input)) return input
  return path.resolve(process.cwd(), input)
}

// Resolves a `duo open` argument to a URL the browser can load:
//   - Anything with a URL scheme (http, https, file, about, chrome, data, duo-file)
//     passes through unchanged.
//   - `~/foo`, absolute paths, and relative paths all resolve to absolute
//     file paths, then become `file://` URLs with proper encoding.
function resolveOpenTarget(target: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target   // already a URL
  let absolute: string
  if (target.startsWith('~/') || target === '~') {
    absolute = path.resolve(target.replace(/^~/, os.homedir()))
  } else {
    absolute = path.resolve(process.cwd(), target)
  }
  // Use pathToFileURL via URL constructor pattern to get correct encoding
  // (spaces, utf-8, etc). Node's url.pathToFileURL would be cleaner, but
  // the bundled CLI avoids importing extra modules for portability.
  const encoded = absolute
    .split('/')
    .map(seg => encodeURIComponent(seg).replace(/%2F/g, '/'))
    .join('/')
  return 'file://' + encoded
}

// Symlinks this binary to a sandbox-safe location.
//
// ENH-141 — install path order is now PTY-PATH-aware:
//   1. ~/.claude/duo/bin/duo  (default; this dir is prepended to PATH
//                              inside every Duo PTY by PtyManager, so
//                              the binary is immediately reachable by
//                              name without touching the user's shell
//                              rc. Critical for Claude Code sandboxes
//                              where modifying ~/.zshrc is blocked.)
//   2. ~/.local/bin/duo       (common community alt; needs ~/.local/bin
//                              on PATH — typically wired by the
//                              FirstLaunchBanner's install action which
//                              auto-appends a fenced block to ~/.zshrc.)
//   3. /usr/local/bin/duo     (only with --system; needs sudo + outside
//                              the sandbox; not recommended.)
//
// The previous tier-1 target `~/.claude/bin/duo` was retired in
// ENH-141: that dir was sandbox-writable but never on $PATH for Duo
// PTYs or external shells, so the symlink existed but `duo` was still
// "command not found." Reported by an enterprise user running
// Duo v0.6.13 inside a managed Claude Code install. See
// docs/DECISIONS.md → *Sandbox-tolerant transport and install paths*.
function runInstall(opts: { system?: boolean } = {}): void {
  // process.argv[1] is the script that was invoked (cli/duo), not the Node
  // binary at process.execPath. fs.realpathSync resolves any already-existing
  // symlinks so we always point at the real file.
  const self = fs.realpathSync(process.argv[1])
  const targets: string[] = []
  if (opts.system) {
    targets.push('/usr/local/bin/duo')
  } else {
    targets.push(path.join(os.homedir(), '.claude', 'duo', 'bin', 'duo'))
    targets.push(path.join(os.homedir(), '.local', 'bin', 'duo'))
  }

  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      try { fs.unlinkSync(target) } catch { /* doesn't exist */ }
      fs.symlinkSync(self, target)
      out(`Installed: ${target} → ${self}`)
      const dir = path.dirname(target)
      // The SHIM_DIR target (~/.claude/duo/bin) is on PATH only inside
      // Duo PTYs (PtyManager prepends it at spawn time). For external
      // shells, surface the same shell-rc hint the secondary
      // ~/.local/bin path would. Users running `duo install` from
      // Terminal/iTerm need to either add the dir to their rc OR run
      // Duo's banner-driven [Install] which auto-wires ~/.local/bin.
      const userPath = (process.env.PATH ?? '').split(':')
      if (!userPath.includes(dir)) {
        out('')
        out('Inside Duo PTYs this dir is already on PATH (no action needed).')
        out('For external terminals (Terminal/iTerm), add to your shell rc:')
        out(`  export PATH="${dir}:$PATH"`)
      }
      return
    } catch {
      // Try next target (e.g. mkdir /usr/local/bin without sudo)
    }
  }
  if (opts.system) {
    die('Could not install duo. Try: sudo ln -sf ' + self + ' /usr/local/bin/duo')
  }
  die('Could not install duo. Try: ln -sf ' + self + ' ~/.claude/duo/bin/duo')
}

// Stage 20 — `duo doctor`. CLI-side health check that names the
// failure mode when one transport works and the other doesn't, so a
// sandboxed Claude Code session no longer fails silently. Reports:
//   - Unix socket reachable? TCP fallback reachable?
//   - Running app version (via `ping`) vs. CLI version
//   - $DUO_SESSION presence (Stage 19 — running inside a Duo PTY)
//   - Install path: which `duo` binaries exist on disk
//   - Skill / agent file presence under ~/.claude/
async function runDoctor(): Promise<void> {
  const lines: string[] = []
  const probe = async (factory: TransportFactory) => {
    return await sendOver(factory, 'ping', {}, 3_000)
  }

  let unixOk = false
  let unixErr: string | null = null
  let appVersion: string | null = null
  if (fs.existsSync(SOCKET_PATH)) {
    try {
      const res = await probe(() => ({ socket: net.createConnection(SOCKET_PATH) }))
      unixOk = true
      appVersion = (res as { version?: string })?.version ?? null
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      unixErr = e.code ?? e.message ?? String(err)
    }
  } else {
    unixErr = 'socket file missing'
  }

  let tcpOk = false
  let tcpErr: string | null = null
  const portInfo = readPortFile()
  if (portInfo) {
    try {
      const res = await probe(() => {
        const socket = net.createConnection({ host: '127.0.0.1', port: portInfo.port })
        return { socket, preamble: JSON.stringify({ token: portInfo.token }) + '\n' }
      })
      tcpOk = true
      if (!appVersion) appVersion = (res as { version?: string })?.version ?? null
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      tcpErr = e.code ?? e.message ?? String(err)
    }
  }

  lines.push(`duo CLI version: ${VERSION}`)
  if (appVersion) {
    const match = appVersion === VERSION ? ' (matches)' : ' (⚠ mismatch — relink the binary)'
    lines.push(`Duo app version: ${appVersion}${match}`)
  } else {
    lines.push('Duo app version: unknown — could not reach app via either transport')
  }
  lines.push('')

  lines.push('Transport')
  lines.push(`  ${unixOk ? '✓' : '✗'} Unix socket — ${SOCKET_PATH}${unixErr ? `  (${unixErr})` : ''}`)
  if (portInfo) {
    lines.push(`  ${tcpOk ? '✓' : '✗'} TCP fallback — 127.0.0.1:${portInfo.port}${tcpErr ? `  (${tcpErr})` : ''}`)
  } else {
    lines.push(`  ✗ TCP fallback — no port file at ${PORT_FILE}`)
  }
  if (!unixOk && tcpOk) {
    lines.push('')
    lines.push('  → Claude Code sandbox detected (Unix socket blocked) — using TCP fallback.')
    lines.push("  → To enable the faster Unix-socket path, add this to .claude/settings.local.json:")
    lines.push('      { "permissions": { "allow": ["allowUnixSockets"] } }')
  } else if (!unixOk && !tcpOk) {
    lines.push('')
    lines.push('  → Both transports failed. Is Duo.app running?')
  }
  lines.push('')

  lines.push('Sandbox')
  if (process.env.DUO_SESSION) {
    lines.push(`  ✓ $DUO_SESSION = ${process.env.DUO_SESSION}  (running inside a Duo PTY)`)
  } else {
    lines.push('  · $DUO_SESSION not set  (not in a Duo PTY — fine outside Duo)')
  }
  lines.push('')

  lines.push('Install')
  const cliPath = process.argv[1]
  let cliReal: string | null = null
  try { cliReal = fs.realpathSync(cliPath) } catch { /* */ }
  lines.push(`  CLI invoked as: ${cliPath}${cliReal && cliReal !== cliPath ? ` → ${cliReal}` : ''}`)
  const knownInstallTargets = [
    // ENH-141 — SHIM_DIR (auto-prepended to PTY $PATH; primary target).
    path.join(os.homedir(), '.claude', 'duo', 'bin', 'duo'),
    // Pre-ENH-141 sandbox-writable target (still listed for diagnosing
    // stale installs — the dir was never on PATH so the symlink was
    // effectively dead).
    path.join(os.homedir(), '.claude', 'bin', 'duo'),
    path.join(os.homedir(), '.local', 'bin', 'duo'),
    '/usr/local/bin/duo'
  ]
  for (const t of knownInstallTargets) {
    if (!fs.existsSync(t)) continue
    let real: string | null = null
    try { real = fs.realpathSync(t) } catch { /* */ }
    const matches = real && cliReal && real === cliReal
    lines.push(`  ${matches ? '✓' : '·'} ${t}${real && real !== t ? ` → ${real}` : ''}`)
  }
  lines.push('')

  lines.push('Skill')
  const skillFile = path.join(os.homedir(), '.claude', 'skills', 'duo', 'SKILL.md')
  const agentFile = path.join(os.homedir(), '.claude', 'agents', 'duo.md')
  lines.push(`  ${fs.existsSync(skillFile) ? '✓' : '✗'} ${skillFile}`)
  lines.push(`  ${fs.existsSync(agentFile) ? '✓' : '✗'} ${agentFile}`)
  lines.push('')

  // ENH-032 — terminal locale check. Multi-byte UTF-8 paste into the
  // terminal renders as raw bytes when LC_ALL/LC_CTYPE/LANG aren't
  // UTF-8. Most common cause: conda's `(base)` activator setting
  // LC_ALL=C. Diagnostic-only (we can't fix the user's shell rc); the
  // warning emits the fix inline so users have everything they need.
  lines.push('Locale')
  const localeVars = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const
  const looksUtf8 = (v: string | undefined): boolean => {
    if (!v) return false
    return /utf-?8/i.test(v)
  }
  let utf8Found = false
  for (const v of localeVars) {
    const value = process.env[v]
    if (!value) {
      lines.push(`  · $${v} not set`)
      continue
    }
    if (looksUtf8(value)) {
      lines.push(`  ✓ $${v} = ${value}`)
      utf8Found = true
    } else {
      lines.push(`  ⚠ $${v} = ${value}  (not UTF-8 — multi-byte paste will render as raw bytes)`)
    }
  }
  if (!utf8Found) {
    lines.push('')
    lines.push('  → Pasting characters like em-dash, emoji, or accented letters')
    lines.push('    into this terminal will produce garbled output.')
    lines.push('    Fix: add to your ~/.zshrc (after any conda init block):')
    lines.push('      export LANG=en_US.UTF-8')
    lines.push('      export LC_ALL=en_US.UTF-8')
    lines.push('    Then open a fresh terminal.')
  }

  process.stdout.write(lines.join('\n') + '\n')
  // Exit non-zero only when neither transport works; surface to scripts.
  process.exit(unixOk || tcpOk ? 0 : 1)
}

// BUG-145 — focused help for the `doc` verb cluster. The global
// printHelp() lists every verb (~200 lines); on first encounter an
// agent had to page that to find `doc comment` ergonomics. This
// returns just the doc-subcommand section (or one specific subcommand
// when `sub` is set).
function printDocHelp(sub?: string): void {
  const sections: Record<string, string> = {
    read: `duo doc read [<file>]
  Read the markdown editor's current buffer (no <file> = active editor;
  <file> = match by path against any open editor tab).
  Output is the full file body including CriticMarkup tokens.`,
    write: `duo doc write [--text "X" | --replace-all] [--text "X"]
  Replace the editor's current selection (default) or its full body
  (--replace-all). Without --text the body is read from stdin.`,
    goto: `duo doc goto [<file>] (--heading "X" | --line N | --anchor "X")
  Scroll + place caret at the target. Buffer-staleness defense reads
  disk first when the editor's clean.`,
    find: `duo doc find [<file>] --query "X" [--case-sensitive]
  Count + locate matches in the editor's serialized body.`,
    edit: `duo doc edit <file> --find "X" --replace "Y" [--occurrence N | --all] [--at-line N]
  ENH-195 — surgical PLAIN-text markdown replace (literal, NOT CriticMarkup —
  a direct accepted edit). Echo-safe when the file is open in the editor;
  disk-direct when closed. --replace may be empty (= delete the match).
  Ambiguous multi-match without --occurrence / --all is refused. Use the
  CriticMarkup verbs (insert/delete/substitute) instead when you want the
  change to land as a tracked suggestion.`,
    insert: `duo doc insert <file> --text "X" (--after "Y" | --before "Y" | --at-line N) [--occurrence N]
  Wrap NEW text as a CriticMarkup insertion ({++X++}) at the chosen anchor.`,
    delete: `duo doc delete <file> --text "X" [--occurrence N]
  Wrap existing text as a CriticMarkup deletion ({--X--}).`,
    substitute: `duo doc substitute <file> --text "X" --with "Y" [--occurrence N]
  Wrap "X→Y" as a substitution ({~~X~>Y~~}). --with may be empty (= delete).`,
    highlight: `duo doc highlight <file> --text "X" [--occurrence N]
  Wrap "X" as a highlight ({==X==}). Refuses if target overlaps an existing
  CriticMarkup token.`,
    comment: `duo doc comment <file> --anchor "X" --body "B"           # add NEW comment
duo doc comment <file> --reply-to <c-id> --body "B"      # REPLY (BUG-143)
  Author = $DUO_AUTHOR ?? 'agent'. For replies, omit --anchor — the server
  appends '↪ @author ts: B' inside the parent token's body. The editor's
  chokidar watcher then refreshes the live buffer automatically.`,
    accept: `duo doc accept <file> (--id <c-id> | --match "X") [--occurrence N]
  Accept a CM op: insertion = keep text; deletion = drop text;
  substitution = keep new; comment = keep anchor.`,
    reject: `duo doc reject <file> (--id <c-id> | --match "X") [--occurrence N]
  Reject a CM op: insertion = drop; deletion = keep; substitution = keep
  old; comment = drop anchor wrapper (body untouched).`,
    'conflict-log': `duo doc conflict-log
  BUG-122 — print the latest save-conflict diagnostic
  (~/.claude/duo/logs/last-conflict.log).`
  }
  const lines: string[] = []
  if (sub && sections[sub]) {
    lines.push(sections[sub])
  } else {
    lines.push('duo doc <subcmd> — markdown editor doc operations.')
    lines.push('')
    lines.push('Subcommands:')
    for (const key of Object.keys(sections)) {
      const firstLine = sections[key].split('\n')[0]
      lines.push('  ' + firstLine.replace(/^duo /, ''))
    }
    lines.push('')
    lines.push('Use `duo doc <subcmd> --help` for the focused help on one subcommand.')
  }
  process.stdout.write(lines.join('\n') + '\n')
}

function printHelp(): void {
  console.log(`
duo ${VERSION} — CLI bridge to the Duo desktop app

USAGE
  duo <command> [options]

COMMANDS
  navigate <url>                  Open URL in a NEW browser tab, or focus
                                  an existing tab whose URL matches (ENH-
                                  175). URLs only — use 'duo reveal <path>'
                                  to move the file navigator, 'duo open
                                  <path>' to open a local file. Does NOT
                                  clobber the currently-active tab.
  open <path-or-url> [--canvas]   Open a local file or URL. HTML files
       [--reveal]                  default to the browser pane (scripts run,
                                   interactive) — use this when showing the
                                   user a generated explainer / playground.
                                   Non-HTML files route to their natural
                                   surface (.md → editor, image → viewer).
                                   --canvas (ENH-159) forces canvas-mode
                                   mount for HTML (source-editable, scripts
                                   blocked) — rare override for inspecting
                                   the playground's HTML source.
                                   --reveal expands the working pane if
                                   collapsed.
  reload                          Reload the active browser tab in place
                                  (no URL needed). Pair for "duo navigate"
                                  in the agent's iteration loop.
  url                             Print current URL
  title                           Print current page title
  dom [<selector>] [--attr <n>]   ENH-122 — bare \`duo dom\` prints the
       [--text] [--all]            browser pane's full HTML (CDP). With
       [--computed p1,p2]          a selector, queries the main RENDERER
       [--js "<expr>"]             instead (the React shell — useful when
                                   debugging editor / canvas / image-
                                   viewer state). --attr returns one
                                   attribute. --text returns
                                   textContent. --all returns an array
                                   of matches. --computed returns
                                   getComputedStyle props as a JSON
                                   object. --js evaluates an arbitrary
                                   expression in the renderer scope.
  devtools [--browser-pane]       ENH-123 — open DevTools on the main
       [--close]                   renderer (default) or the active
                                   browser pane. --close closes any
                                   open instance for the target. Sister
                                   to \`duo dom\` for the 5% of cases
                                   the targeted query isn't enough.
  layout                          ENH-124 — JSON snapshot of the
                                   WorkingPane / terminal / navigator
                                   state (active main tab kind+path,
                                   aux state, splitPct, focused
                                   column, navigator collapsed?).
                                   Pairs with \`duo nav-state\` and
                                   \`duo dom\` as the third visibility
                                   verb.
  status                          ENH-195 — high-level app snapshot:
                                   every open file + browser tab (with
                                   per-tab dirty / active / pinned), the
                                   active working tab, focused column,
                                   theme, terminal-tab count. The
                                   keystone orientation verb — run it
                                   first to see what the user is looking
                                   at. Coarser than \`duo layout\`; both
                                   read live from the renderer.
  inspect [--on|--off]            ENH-159b — element-inspect mode in the
                                   active browser pane. No arg toggles;
                                   --on / --off force. While active,
                                   hover any element → orange outline;
                                   click → ships tag + selector + heading
                                   trail + innerText + key attrs to the
                                   active terminal as a structured paste.
                                   ESC exits without picking. Chord ⌘⇧C
                                   inside the WCV is the keystroke
                                   equivalent.
  text [--selector <css>]         Print visible text (or matched element text)
  ax [--selector <css>] [--format md|json]
                                  Accessibility tree (required for Google Docs
                                  and other canvas-rendered apps)
  click <selector>                Click element by CSS selector
  fill <selector> <value>         Fill an input
  focus <selector>                Move focus to the matching element
  type <text>                     Synthesize text input into the focused element
  key <keyname> [--modifiers cmd,shift,...]
                                  Dispatch a named key (Enter, ArrowDown,
                                  Backspace, etc.) with optional modifiers
  eval <js>                       Execute JS and return result
  screenshot [--out <path>] [--selector <css>]   Take a screenshot
  console [--since <ts>] [--level log,warn,...] [--limit N]
                                  Dump buffered console messages (NDJSON)
  errors [--since <ts>] [--limit N]
                                  Uncaught browser exceptions (NDJSON,
                                  separate from \`console\` — populated
                                  by Runtime.exceptionThrown)
  network [--since <ts>] [--filter <regex>] [--limit N]
                                  HTTP requests stitched from Network.*
                                  events (NDJSON). \`--filter\` matches
                                  against URL.
  tabs                            List open browser tabs (JSON)
  tab <n>                         Switch to browser tab N
  close <n>                       Close browser tab N (cannot close the last)
  wait <selector> [--timeout ms]  Wait for element to appear

  view <path> [--canvas]          Open a file in the working pane (new tab,
                                  type inferred from extension). Distinct
                                  from \`open\` (which opens a URL/HTML in
                                  a browser tab). \`--canvas\` (ENH-097)
                                  forces canvas-mode mount even if the
                                  file declares <meta duo-open-in="browser">
                                  — useful when you want to view or edit
                                  a playground's source without firing
                                  its scripts.
  edit <path> [--browser]         Open a file for editing its source.
       [--reveal]                  HTML defaults to canvas mode (ENH-159)
                                   — buttons inert, scripts blocked, the
                                   document is editable. .md files open
                                   in the TipTap rich editor (Stage 11).
                                   Images / PDFs / JSON fall through to
                                   their natural viewers (no editor
                                   surface exists for those types).
                                   --browser forces browser mode for
                                   HTML (rare override; symmetric with
                                   \`duo open --canvas\`).
                                   --canvas accepted as deprecated
                                   no-op (the default for HTML now).
                                   --reveal expands the working pane.
  selection [--pane auto|editor|browser|canvas]
                                  Print the active surface's selection as
                                  JSON. Default --pane auto prefers a
                                  non-empty browser highlight, then a
                                  non-empty canvas selection, falling
                                  back to the editor's cached selection
                                  (which is informative even when
                                  collapsed — it carries the caret's
                                  paragraph + heading trail). Returns
                                  \`null\` when nothing is active.
                                  - editor: { kind: 'editor', path, text,
                                    paragraph, heading_trail, start, end }
                                  - browser: { kind: 'browser', url, text,
                                    surrounding, selector_path }
                                  - canvas: { kind: 'page', path,
                                    text, html, anchorId, anchorPath,
                                    range, surrounding }
  doc read [path]                 Print the active editor's live buffer
                                  (frontmatter + body, including unsaved
                                  edits). Path arg pins the read to a
                                  specific file; omit to target whatever
                                  editor is active.
  doc write [--replace-selection|--replace-all] [--text "..."]
                                  Apply text to the active editor. Without
                                  --text, reads from stdin. Default mode:
                                  --replace-selection (replaces the user's
                                  current selection, or inserts at caret
                                  if collapsed). --replace-all swaps the
                                  whole document body.
  doc goto [<path>] --heading "X" | --line N | --anchor "Y"
                                  Scroll the active editor (or specified
                                  file's editor) to a target. --heading
                                  is markdown-only (case-insensitive
                                  substring match on heading text).
                                  --line is 1-indexed (any text editor).
                                  --anchor is a markdown heading slug OR
                                  a canvas DOM element id /
                                  data-duo-id. Returns resolved {line,
                                  anchor}.
  doc find <query> [<path>] [--case-sensitive]
                                  Search the markdown editor's live
                                  buffer. Returns {matches, first:
                                  {line, col}}. Case-insensitive by
                                  default. (v1 markdown only; canvas /
                                  browser / terminal find variants
                                  deferred.)
  doc edit <file> --find "X" --replace "Y" [--occurrence N | --all] [--at-line N]
                                  ENH-195 — surgical PLAIN-text markdown
                                  replace (literal, NOT CriticMarkup —
                                  a direct accepted edit). Echo-safe when
                                  the file is open in the editor; disk-
                                  direct when closed. --replace may be ""
                                  (= delete the match). Multi-match
                                  without --occurrence / --all is refused
                                  as ambiguous. Use insert/delete/
                                  substitute instead for a tracked
                                  suggestion.
  doc conflict-log                BUG-122 — print the last save-
                                  conflict diagnostic at
                                  ~/.claude/duo/logs/last-conflict.log
                                  (written by both markdown editor and
                                  HTML canvas every time the "file
                                  changed on disk" banner surfaces).
                                  JSON payload with firstDiffOffset +
                                  head/tail excerpts; tells you which
                                  bytes diverged between baseline and
                                  disk without opening DevTools.
  theme [system|light|dark]       Print the current theme (mode +
                                  effective), or set it if a mode is
                                  provided. Persists across relaunches.
  author [<name>]                 BUG-138 Phase 2 — read or set the
                                  human author identity used for
                                  CriticMarkup mark attribution
                                  (insertions / deletions / comments).
                                  No arg = print state (JSON). With a
                                  name = persist + print. Agents set
                                  their own via the DUO_AUTHOR env var.
  json set <file> <dotpath> <value>
                                  ENH-195 — set a value at a dotted path
                                  in a JSON / YAML file. <dotpath> uses
                                  dots + [n] indices ("a.b[0].c"); "" or
                                  "." = root. <value> is parsed as JSON
                                  if valid (number / bool / null / object
                                  / array / quoted string), else treated
                                  as a literal string. Echo-safe when the
                                  file is open in the JSON viewer; disk-
                                  direct when closed. YAML round-trips
                                  lose comments (noted in the reply).
  json merge <file> <patch.json>  ENH-195 — deep-merge a JSON object
                                  (read from <patch.json>) into the root
                                  of a JSON / YAML file. Nested objects
                                  merge key-by-key; arrays + primitives
                                  in the patch replace. Same open/closed
                                  + YAML-comment-loss semantics as
                                  \`json set\`.
  doc insert <file> --text "X" (--after "Y" | --before "Y" | --at-line N)
                                  BUG-138 Phase 3 — insert "X" as a
                                  CriticMarkup insertion ({++X++}) at
                                  the anchor. --after/--before take a
                                  literal text anchor; --at-line takes
                                  a 1-indexed line number. Add
                                  --occurrence N to disambiguate
                                  duplicate anchors.
  doc delete <file> --text "X"    BUG-138 Phase 3 — wrap "X" as a
                                  CriticMarkup deletion ({--X--}). Use
                                  --occurrence N to disambiguate.
                                  Refuses if the target overlaps an
                                  existing CM token.
  doc substitute <file> --text "X" --with "Y"
                                  BUG-138 Phase 3 — wrap "X→Y" as a
                                  CriticMarkup substitution ({~~X~>Y~~}).
                                  --with may be empty (= delete).
  doc highlight <file> --text "X" v0.7.2 — wrap "X" as a CriticMarkup
                                  highlight ({==X==}). CLI parity for
                                  the existing HighlightMark; sibling
                                  to delete. --occurrence N supported.
                                  Refuses if target overlaps existing CM.
  doc comment <file> --anchor "X" --body "B"
                                  BUG-138 Phase 3 — anchor a comment
                                  ({==X==}{>>id|author|ts|B<<}) to the
                                  matched text. Author = $DUO_AUTHOR
                                  ?? 'agent'. Comment id auto-minted.
  doc comment <file> --reply-to <c-id> --body "B"
                                  BUG-143 — append a reply to an existing
                                  comment thread. Finds the parent token
                                  by id, appends '↪ @author ts: B' to its
                                  body. No --anchor required.
  doc accept <file> (--id <c-id> | --match "X")
                                  BUG-138 Phase 3 — accept a CM op:
                                  insertion = keep text; deletion =
                                  drop text; substitution = keep new;
                                  comment = keep anchor. Identify by
                                  --id (comments only) or by --match
                                  literal text.
  doc reject <file> (--id <c-id> | --match "X")
                                  BUG-138 Phase 3 — reject a CM op:
                                  insertion = drop text; deletion =
                                  keep text; substitution = keep old;
                                  comment = keep anchor.
  claude-return [submit|newline]  v0.6.15 — toggle Claude-tab plain
                                  Return behavior. Default 'submit'
                                  (xterm passthrough; Claude submits).
                                  'newline' restores ENH-127 v2 behavior
                                  (writes ESC+CR; Claude reads as multi-
                                  line newline; user types ⌘Return to
                                  submit). No arg = print state.
  shift-return [submit|newline]   v0.6.15 — toggle Claude-tab Shift+Return
                                  behavior. Default 'newline' (writes
                                  ESC+CR; matches Slack/Discord/claude.ai
                                  web). 'submit' disables the override
                                  (xterm passthrough). No arg = print
                                  state.
  hidden-files [show|hide|toggle] ENH-172 (Sprint 20 / v0.7.7) — show or
                                  hide dotfiles in the navigator. CLI
                                  parity with View → Show Hidden Files
                                  (⌘⇧.). Persists in localStorage.
                                  .claude + .obsidian are always
                                  visible regardless. No arg = print
                                  { showDotfiles: boolean }.
  browser-mode [unfiltered|       ENH-178 (Sprint 20 / v0.7.7) — three-
       filtered|local-only]        mode URL filter for the embedded
                                  browser. Default 'local-only': only
                                  file:// + localhost + 127.0.0.1 +
                                  [::1] render in Duo; everything else
                                  pops the system browser. 'filtered'
                                  is the legacy behavior (consult
                                  external-domains.json). 'unfiltered'
                                  is DEBUG ONLY and requires
                                  --i-understand (IT-policy warning).
                                  Persists in renderer localStorage.
                                  No arg = print { mode }.
  focus-pane <terminal|main|aux>  ENH-098 (Sprint 9) — jump keyboard
                                  focus to the named pane. CLI parity
                                  with the ⌘⌥L (terminal) / ⌘⌥;
                                  (main) / ⌘⌥' (aux) chord set. Aux
                                  is a no-op when split view is
                                  closed (renderer logs an info
                                  hint). Distinct from 'focus
                                  <selector>' which targets a CSS
                                  selector in the browser pane.
  split <pct|preset>              Set the split-pane percentage
                                  (terminal column as % of the split
                                  container). Numeric arg clamps to
                                  20–80. Presets: even (50), terminal-
                                  heavy (67), canvas-heavy (33),
                                  terminal (80, full-terminal), canvas
                                  (20, full-canvas), 3way (ENH-099 —
                                  outer 33/67 + inner aux 50/50;
                                  matches ⌘⌥4 chord; on-demand
                                  sibling of ENH-126's redistribute-
                                  on-aux-open). Mirrors View → Pane
                                  size menu and ⌘⌥1/2/3/4/0/9.
  split-view <op> [args]          ENH-041 / Sprint 3 + Phase 3c —
                                  Split View aux pane. Sub-verbs:
                                    open <path>           open file in aux
                                    open-browser <id>     pin browser tab
                                                          (id from 'duo tab')
                                                          into aux. Phase 3c.
                                    close                 close aux
                                    promote               move aux back to
                                                          main, close split
                                    resize <pct>          set splitPct (0.20–
                                                          0.80; pct or decimal)
                                    state (or no sub-verb) print snapshot
                                  See docs/prd/canvas-split-view-
                                  research.html for the locked spec.
  events [--follow] [--since      Stage 27 — stream structured events
    <cursor>] [--limit N]         from the bus. Snapshot mode prints
                                  one JSON line per event from the
                                  ring (most-recent N when --limit is
                                  supplied; entire ring when not).
                                  --follow keeps the connection open
                                  and prints each new event as it
                                  lands. --since <cursor> resumes from
                                  a known cursor (cursor format is
                                  \`<unix-ms>-<seq>\`; copy it from a
                                  prior event line). Producers: canvas
                                  \`duo:event\` action verb (Stage 27);
                                  more sources land as Stage 27.5.
  packs                           Stage 18b — list every discovered
                                  distro pack at
                                  \`~/.claude/duo/packs/<name>/\` as
                                  JSON. Each row carries the parsed
                                  PACK.json manifest (or null on
                                  parse failure) plus per-pack errors[].
                                  Registry is cached at app boot;
                                  restart Duo to refresh.
  reveal <path>                   Move the file navigator to <path> and
                                  surface a dismissible chip so the user
                                  knows you moved their tree.
  ls [path]                       List directory contents (JSON). Defaults
                                  to the navigator's current folder.
  nav pin <path>                  Stage 26 — pin a file or folder to
                                  the navigator's "Pinned" section.
                                  Mirrors the right-click "Pin to
                                  navigator" action. Stored at
                                  \`~/.claude/duo/nav-pins.json\`
                                  (separate from Stage 24's tab pins).
  nav unpin <path>                Remove the pin at <path>.
  nav pins                        List all navigator pins (JSON).
  nav state                       Print navigator state (cwd, selection,
                                  expanded folders, pinned flag).

  send [--text "..."] [--enter]   Write a payload into the active
                                  terminal's PTY. No Enter appended
                                  by default (user confirms); pass
                                  --enter to submit on their behalf
                                  (Stage 23b — pairs with canvas
                                  data-duo-action="terminal:send"
                                  data-enter="true"). Without --text,
                                  reads from stdin.

  selection-format [a|b|c]        Read or set the Send → Duo payload
                                  format (Stage 15 G19, agent-tunable
                                  runtime knob). a = quote + provenance
                                  (default), b = literal text only,
                                  c = opaque token. No arg → print
                                  current; with arg → set + persist.

  external <url>                  Open <url> in the macOS default browser
                                  (via Electron's shell.openExternal). Used
                                  by the duo subagent for hostnames listed
                                  in ~/.claude/duo/external-domains.json
                                  (sites that don't render well in Duo's
                                  embedded WebContentsView). http(s) and
                                  mailto schemes only.

  html new <path.html> [--title "…"]
                                  Stage 17a — create a new .html file
                                  from boilerplate and open it in the
                                  HTML canvas. \`duo edit foo.html\` /
                                  \`duo view foo.html\` already route to
                                  the canvas via the file classifier.

  Stage 17b agent ops against the active canvas. Targeting: --id <duo-id>
  (preferred) or --selector <css>. Write ops accept --html "…" / --content
  "…" or read from stdin (heredoc-friendly).

  html query <css-selector>       List elements matching selector. Returns
                                  JSON array of {id, tag, text, classes}.
  html get --id <duo-id>          Read outerHTML + textContent of a single
       --selector <css>           element. Returns {id, tag, html, text}.
  html set --id <duo-id> --content "..."
                                  Replace innerHTML of the matched element.
  html replace --id <duo-id> --html "..."
                                  Replace outerHTML of the matched element.
  html append --parent <duo-id> --html "..."
       --parent-selector <css>    Append a child to the matched parent.
  html remove --id <duo-id>       Delete the matched element.
       --selector <css>
  html attr --id <duo-id> [--set k=v ...] [--remove k ...]
                                  Modify attributes (--set / --remove
                                  can repeat).
  html click --id <duo-id>        Programmatically click the matched
       --selector <css>           element. Triggers the canvas-action
                                  dispatcher just like a user click —
                                  data-duo-action verbs fire, events
                                  emit, downstream paint ops execute.
                                  Used by lesson fly-through harnesses.

  Stage 17d — comments. Stored in <file>.duo.json § comments[]; never
  modify the .html itself.

  html comment --id <duo-id> --body "…"
       --selector <css>           Add a comment anchored to the matched
       --text "<substring>"       element (or its nearest data-duo-id
                                  ancestor). --body via flag or stdin.
                                  Returns {ok, commentId, anchorId}.
  html comments [--filter all|open|resolved]
                                  List comment threads on the active
                                  canvas, sorted in document order.
                                  Each thread: {id, number, excerpt,
                                  resolved, entries: [{id, author, ts,
                                  body}]}.

  file rename <old> <new>         Stage 26 — rename / move a file or
                                  folder within the same filesystem
                                  (fs.rename, atomic). Both paths
                                  resolve relative to the CLI's cwd.
                                  Mirrors the navigator's right-click
                                  Rename action.
  file trash <path>               Move a file or folder to the macOS
                                  Trash (recoverable from Finder).
                                  Mirrors the navigator's right-click
                                  Delete action; \`shell.trashItem\`
                                  under the hood.

  new-tab [--shell|--claude] [--cwd <path>] [--cmd "<text>"]
                                  Open a new terminal tab (Stage 19c).
                                  --claude (the split-button + default)
                                  auto-launches \`claude\` after the
                                  shell starts; --shell opens a vanilla
                                  shell. With no flag, follows the user's
                                  most recent manual choice. --cwd
                                  overrides the navigator's pending CWD;
                                  --cmd writes a pre-typed payload (no
                                  trailing newline) into the PTY after
                                  spawn — wins over kind-default if both
                                  apply. Returns {id, kind, cwd, title}.

  doctor                          Health-check both transports (Unix
                                  socket + TCP fallback), report the
                                  app/CLI version match, $DUO_SESSION
                                  presence, install path, and skill
                                  files. First move when a duo
                                  command fails — names the sandbox
                                  failure mode instead of dying
                                  silently. Exits 0 if either
                                  transport is reachable.

  install [--system]              Symlink duo into a sandbox-safe
                                  location: ~/.claude/bin/duo by
                                  default (writable from a sandboxed
                                  Claude Code PTY), with
                                  ~/.local/bin/duo as fallback. Pass
                                  --system to force /usr/local/bin
                                  (needs sudo; not recommended for
                                  Claude Code use).

  git-status [<path>]             ENH-152a — git status snapshot for
                                  a directory (defaults to $HOME).
                                  Returns JSON: { isRepo, branch,
                                  head, dirty, changedCount, ahead,
                                  behind, workTreeRoot }. Powers the
                                  Navigator root chip; agents can
                                  also use it to make decisions
                                  about a checkout's state before
                                  proposing edits.

  clone <url> [<dir>] [--json]    ENH-151 — clone a GitHub repo via
                                  \`gh repo clone\` when gh is
                                  authenticated, falling back to
                                  \`git clone\`. <url> accepts gh
                                  shorthand (owner/repo) when gh is
                                  available, otherwise needs the
                                  full HTTPS/SSH URL. --json prints
                                  the structured CloneResult so
                                  agents can branch on errorKind
                                  (bad-url / auth-missing /
                                  clone-failed).

  gh-auth                         ENH-151 — probe \`gh auth status\`.
                                  Prints JSON { ghInstalled,
                                  authenticated, host, user,
                                  ghNotFound } so agents can decide
                                  whether \`duo clone\` will work
                                  on private repos before they try.

  close-tab                       FOLLOWUP-020 — close the focused
                                  working-pane tab (file editor /
                                  canvas / image viewer / browser-
                                  mode HTML). CLI parity for ⌘W.
                                  Pinned tabs still surface the
                                  Cancel / Close-anyway confirm
                                  dialog before closing.

  close-terminal-tab [<n>]        FOLLOWUP-020 — close a terminal
                                  tab. No arg closes the focused
                                  one; <n> (1-indexed) closes that
                                  specific terminal tab.

  workspace <sub> [args]          ENH-167 — workspace-as-file. Round-
                                  trip the open tabs + terminals +
                                  browser tabs to a .duo-workspace
                                  file.
    workspace save [<path>]         Write current workspace to <path>
       [--name <name>] [--save-as]  (or the active workspace's path
                                    if omitted). --name overrides
                                    the name; --save-as forces
                                    dialog semantics. CLI without an
                                    active workspace requires <path>.
    workspace open <path>           Load <path> and in-place reset
                                    so the saved tabs/terminals
                                    replace the current ones. Wraps
                                    the File > Open Workspace menu
                                    flow, minus the GUI Save-current
                                    prompt (agent caller is presumed
                                    deliberate).
    workspace list-recent           JSON list of recent workspaces
                                    ({path, name, savedAt,
                                    lastOpenedAt}). Pruned for files
                                    that no longer exist.
    workspace current               JSON {path, name} of the active
                                    workspace, or null when untitled.
    workspace new                   Reset workspace in-place: one
                                    fresh shell terminal at the live
                                    CWD of the previously-frontmost
                                    terminal, every working-pane tab
                                    dropped except pinned (file +
                                    browser pins survive), active
                                    pointer cleared. CLI skips the
                                    GUI Save-current prompt.

  session <sub> [args]            ENH-183 — Claude session lifecycle.
                                  Read + drive the Claude session
                                  resume surfaces (S1 pills + S3
                                  restore offer). Each sub-verb mirrors
                                  a UI affordance.
    session list [--cwd <path>]     List prior '<uuid>.jsonl' sessions
                                    in the CWD (defaults to the active
                                    terminal's cwd). Each entry has
                                    {uuid, title, source, messageCount,
                                    modifiedAt}. Powers the S1 pills
                                    surface; useful for agents to find
                                    a session to resume.
    session resume <tabId> <uuid>   Spawn 'claude --resume <uuid>' in
                                    the named tab's PTY. Same wire as
                                    clicking an S1 pill or the S3
                                    'Resume' button.

  project <sub-op> [args]         ENH-182 Phase 4 (Sprint 23 / v0.8.0) —
                                  project rail CLI parity. Mirrors the
                                  left-rail tile interactions. Name
                                  resolution is case-insensitive against
                                  unique names; exact root paths always
                                  resolve.
    project list                    JSON snapshot: derived projects in
                                    rail order + focused root + per-
                                    project member counts (terminals,
                                    workingTabs, hasClaudeKindTerminal).
                                    Use this first to discover project
                                    names before subsequent verbs.
    project focus <name|root>       Set the focus lens to this project.
                                    Hides non-member terminals + working
                                    tabs; re-roots the navigator; shows
                                    the title-bar focus chip.
    project focus --all             Release focus (back to All).
    project pin <name|root>         Add this project to the persistent
                                    pin set so its tile survives close-all.
                                    No-op when already pinned.
    project unpin <name|root>       Remove from the pin set. No-op when
                                    not pinned.
    project close <name|root>       Bulk-close every member terminal +
                                    working tab. Fires the same confirm
                                    dialog as the right-click menu when
                                    any member terminal is kind:'claude'.

  workspace-pill-menu [on|off|toggle]
                                  ENH-184 (Sprint 23 / v0.8.0) — toggle
                                  the title-bar workspace pill's
                                  click-to-open-menu behavior. Default
                                  OFF: pill renders as a passive label
                                  + workspace operations route through
                                  the File menu. Bare command reads
                                  current state.

FLAGS
  --version, -v    Print version
  --help, -h       Print this help

EXIT CODES
  0   Success
  1   Error (human-readable message on stderr)
`.trim())
}

main().catch((err) => {
  process.stderr.write(`duo: unhandled error: ${err}\n`)
  process.exit(1)
})
