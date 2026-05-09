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
        const url = rest[0] ?? die('Usage: duo navigate <url>')
        out(await send('navigate', { url }))
        break
      }
      case 'open': {
        const target = rest[0] ?? die('Usage: duo open <path-or-url>')
        const resolved = resolveOpenTarget(target)
        out(await send('open', { url: resolved }))
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
      case 'dom':
        out(await send('dom'))
        break
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
        const canvasFlagIdx = rest.indexOf('--canvas')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo view <path> [--canvas]')
        const resolved = resolveFilePath(target)
        const overrideMode = canvasFlagIdx !== -1 ? 'canvas' : undefined
        out(await send('view', overrideMode ? { path: resolved, mode: overrideMode } : { path: resolved }))
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
        // ENH-097 — `--canvas` forces canvas-mode mount, overriding the
        // file's `<meta name="duo-open-in" content="browser">` if present.
        // Useful for editing playground source after the modality lock
        // routes the file to browser mode by default.
        const canvasFlagIdx = rest.indexOf('--canvas')
        const target = rest.find(a => !a.startsWith('--')) ?? die('Usage: duo edit <path> [--canvas]')
        const resolved = resolveFilePath(target)
        const overrideMode = canvasFlagIdx !== -1 ? 'canvas' : undefined
        out(await send('edit', overrideMode ? { path: resolved, mode: overrideMode } : { path: resolved }))
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
        const arg = rest[0]
        if (arg === undefined) {
          die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy>')
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
            die('Usage: duo split <pct|even|terminal|canvas|terminal-heavy|canvas-heavy>')
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
        } else {
          die('Usage: duo doc <write|read|goto|find> [...]')
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
// Stage 20 — install path order is now sandbox-aware:
//   1. ~/.claude/bin/duo  (default; Claude Code's macOS sandbox can
//                          write under ~/.claude/, so this stays
//                          functional inside a `claude` PTY)
//   2. ~/.local/bin/duo   (common community alt)
//   3. /usr/local/bin/duo (only with --system; needs sudo + outside
//                          the sandbox; not recommended)
// See docs/DECISIONS.md → *Sandbox-tolerant transport and install
// paths*.
function runInstall(opts: { system?: boolean } = {}): void {
  // process.argv[1] is the script that was invoked (cli/duo), not the Node
  // binary at process.execPath. fs.realpathSync resolves any already-existing
  // symlinks so we always point at the real file.
  const self = fs.realpathSync(process.argv[1])
  const targets: string[] = []
  if (opts.system) {
    targets.push('/usr/local/bin/duo')
  } else {
    targets.push(path.join(os.homedir(), '.claude', 'bin', 'duo'))
    targets.push(path.join(os.homedir(), '.local', 'bin', 'duo'))
  }

  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      try { fs.unlinkSync(target) } catch { /* doesn't exist */ }
      fs.symlinkSync(self, target)
      out(`Installed: ${target} → ${self}`)
      const dir = path.dirname(target)
      const userPath = (process.env.PATH ?? '').split(':')
      if (!userPath.includes(dir)) {
        out('')
        out('Add this to your shell rc to put `duo` on PATH:')
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
  die('Could not install duo. Try: ln -sf ' + self + ' ~/.claude/bin/duo')
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
  // LC_ALL=C. Diagnostic-only (we can't fix the user's shell rc); a
  // warning here points to the FAQ entry with the fix.
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
    lines.push('    Then open a fresh terminal. See FAQ → "Why do special')
    lines.push('    characters look broken when I paste into the terminal?"')
  }

  process.stdout.write(lines.join('\n') + '\n')
  // Exit non-zero only when neither transport works; surface to scripts.
  process.exit(unixOk || tcpOk ? 0 : 1)
}

function printHelp(): void {
  console.log(`
duo ${VERSION} — CLI bridge to the Duo desktop app

USAGE
  duo <command> [options]

COMMANDS
  navigate <url>                  Navigate active tab to URL
  open <path-or-url>              Open a local file or URL in a NEW browser
                                  tab and activate it. Useful for showing the
                                  user generated HTML artifacts or
                                  prototypes.
  reload                          Reload the active browser tab in place
                                  (no URL needed). Pair for "duo navigate"
                                  in the agent's iteration loop.
  url                             Print current URL
  title                           Print current page title
  dom                             Print full page HTML
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
  edit <path> [--canvas]          Open a markdown file in the rich editor
                                  (Stage 11). For .md files this gives the
                                  Google-Docs-style editing surface; for
                                  other types behaves like \`view\`.
                                  \`--canvas\` forces canvas-mode mount
                                  for HTML files (override for editing
                                  playground source — see make-playground).
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
  theme [system|light|dark]       Print the current theme (mode +
                                  effective), or set it if a mode is
                                  provided. Persists across relaunches.
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
                                  (20, full-canvas). Mirrors View →
                                  Pane size menu and ⌘⌥1/2/3/0/9.
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
