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
      case 'open': {
        const target = rest[0] ?? die('Usage: duo open <path-or-url>')
        const resolved = resolveOpenTarget(target)
        out(await send('open', { url: resolved }))
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
        const target = rest[0] ?? die('Usage: duo view <path>')
        const resolved = resolveFilePath(target)
        out(await send('view', { path: resolved }))
        break
      }
      case 'edit': {
        const target = rest[0] ?? die('Usage: duo edit <path>')
        const resolved = resolveFilePath(target)
        out(await send('edit', { path: resolved }))
        break
      }
      case 'selection': {
        const paneIdx = rest.indexOf('--pane')
        const pane = paneIdx !== -1 ? rest[paneIdx + 1] : 'auto'
        if (pane !== 'auto' && pane !== 'editor' && pane !== 'browser') {
          die('Usage: duo selection [--pane auto|editor|browser]')
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
        } else {
          die('Usage: duo doc <write|read> [...]')
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
      case 'nav-state':
      case 'nav': {
        // `duo nav state` and `duo nav-state` are equivalent spellings.
        if (cmd === 'nav' && rest[0] !== 'state') {
          die('Usage: duo nav state')
        }
        out(await send('nav-state'))
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
  navigate <url>                  Navigate active tab to URL
  open <path-or-url>              Open a local file or URL in a NEW browser
                                  tab and activate it. Useful for showing the
                                  user generated HTML artifacts or
                                  prototypes.
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

  view <path>                     Open a file in the working pane (new tab,
                                  type inferred from extension). Distinct
                                  from \`open\` (which opens a URL/HTML in
                                  a browser tab).
  edit <path>                     Open a markdown file in the rich editor
                                  (Stage 11). For .md files this gives the
                                  Google-Docs-style editing surface; for
                                  other types behaves like \`view\`.
  selection [--pane auto|editor|browser]
                                  Print the active surface's selection as
                                  JSON. Default --pane auto prefers a
                                  non-empty browser highlight, falling
                                  back to the editor's cached selection
                                  (which is informative even when
                                  collapsed — it carries the caret's
                                  paragraph + heading trail). Returns
                                  \`null\` when nothing is active.
                                  - editor: { kind: 'editor', path, text,
                                    paragraph, heading_trail, start, end }
                                  - browser: { kind: 'browser', url, text,
                                    surrounding, selector_path }
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
  theme [system|light|dark]       Print the current theme (mode +
                                  effective), or set it if a mode is
                                  provided. Persists across relaunches.
  reveal <path>                   Move the file navigator to <path> and
                                  surface a dismissible chip so the user
                                  knows you moved their tree.
  ls [path]                       List directory contents (JSON). Defaults
                                  to the navigator's current folder.
  nav state                       Print navigator state (cwd, selection,
                                  expanded folders, pinned flag).

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
