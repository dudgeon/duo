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
const SOCKET_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.sock')
const TIMEOUT_MS = 10_000

// ── Socket transport ─────────────────────────────────────────────────────────

async function send(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!fs.existsSync(SOCKET_PATH)) {
    die('Cannot connect: Duo app is not running.\nLaunch Duo.app first.')
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH)
    const id = randomUUID()
    let buf = ''
    let done = false

    socket.setTimeout(TIMEOUT_MS)

    socket.on('connect', () => {
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
      if (!done) reject(new Error(`Timeout waiting for response to "${cmd}"`))
      socket.destroy()
    })

    socket.on('error', (err) => {
      reject(new Error(`Socket error: ${err.message}`))
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
        const key = rest[0] ?? die('Usage: duo key <keyname> [--modifiers cmd,shift,...]')
        const modIdx = rest.indexOf('--modifiers')
        const modifiers = modIdx !== -1
          ? (rest[modIdx + 1] ?? '').split(',').map(s => s.trim()).filter(Boolean)
          : []
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
      case 'wait': {
        const selector = rest[0] ?? die('Usage: duo wait <selector> [--timeout ms]')
        const timeoutIdx = rest.indexOf('--timeout')
        const timeout = timeoutIdx !== -1 ? parseInt(rest[timeoutIdx + 1], 10) : undefined
        out(await send('wait', { selector, timeout }))
        break
      }
      case 'install':
        runInstall()
        break

      default:
        die(`Unknown command: ${cmd}\nRun duo --help for usage`)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
}

// Symlinks this binary to /usr/local/bin/duo (or ~/.local/bin/duo as fallback).
// Called automatically on first launch by Duo.app; can also be run manually.
function runInstall(): void {
  // process.argv[1] is the script that was invoked (cli/duo), not the Node
  // binary at process.execPath. fs.realpathSync resolves any already-existing
  // symlinks so we always point at the real file.
  const self = fs.realpathSync(process.argv[1])
  const targets = ['/usr/local/bin/duo', path.join(os.homedir(), '.local', 'bin', 'duo')]

  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      try { fs.unlinkSync(target) } catch { /* doesn't exist */ }
      fs.symlinkSync(self, target)
      out(`Installed: ${target} → ${self}`)
      return
    } catch {
      // Try next target (e.g. /usr/local/bin might need sudo)
    }
  }
  die('Could not install duo. Try: sudo ln -sf ' + self + ' /usr/local/bin/duo')
}

function printHelp(): void {
  console.log(`
duo ${VERSION} — CLI bridge to the Duo desktop app

USAGE
  duo <command> [options]

COMMANDS
  navigate <url>                  Navigate to URL
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
  tabs                            List open browser tabs (JSON)
  tab <n>                         Switch to browser tab N
  wait <selector> [--timeout ms]  Wait for element to appear
  install                         Symlink duo to /usr/local/bin/duo

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
