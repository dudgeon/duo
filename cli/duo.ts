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
        out(await send('screenshot', { outputPath, selector }))
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
      default:
        die(`Unknown command: ${cmd}\nRun duo --help for usage`)
    }
  } catch (err) {
    die(err instanceof Error ? err.message : String(err))
  }
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
  click <selector>                Click element by CSS selector
  fill <selector> <value>         Fill an input
  eval <js>                       Execute JS and return result
  screenshot [--out <path>] [--selector <css>]   Take a screenshot
  tabs                            List open browser tabs (JSON)
  tab <n>                         Switch to browser tab N
  wait <selector> [--timeout ms]  Wait for element to appear

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
