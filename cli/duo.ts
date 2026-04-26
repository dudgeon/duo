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
// path changes (or a TCP fallback) flow through one knob.
const SOCKET_PATH =
  process.env.DUO_SOCKET ??
  path.join(os.homedir(), 'Library', 'Application Support', 'duo', 'duo.sock')
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

async function send(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!fs.existsSync(SOCKET_PATH)) {
    die('Cannot connect: Duo app is not running.\nLaunch Duo.app first.')
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH)
    const id = randomUUID()
    let buf = ''
    let done = false

    socket.setTimeout(PER_CMD_TIMEOUT_MS[cmd] ?? TIMEOUT_MS)

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
        // No Enter appended (Stage 15 G11 — user confirms).
        const textIdx = rest.indexOf('--text')
        let text: string
        if (textIdx !== -1) {
          text = rest.slice(textIdx + 1).join(' ')
        } else {
          text = await readStdin()
        }
        if (text === '') die('Usage: duo send --text "…"  |  echo … | duo send')
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
        // Common flag parsing.
        const flagValue = (name: string): string | undefined => {
          const i = subRest.indexOf(name)
          return i !== -1 ? subRest[i + 1] : undefined
        }
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
          const id = flagValue('--id')
          const selector = flagValue('--selector')
          if (!id && !selector) die('Usage: duo html get --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'get', id, selector }))
        } else if (sub === 'set') {
          const id = flagValue('--id')
          const selector = flagValue('--selector')
          if (!id && !selector) die('Usage: duo html set --id <duo-id> --content "…"')
          let html = flagValue('--content') ?? flagValue('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html set: content required (use --content "…" or pipe via stdin)')
          out(await send('html-op', { op: 'set', id, selector, html }))
        } else if (sub === 'replace') {
          const id = flagValue('--id')
          const selector = flagValue('--selector')
          if (!id && !selector) die('Usage: duo html replace --id <duo-id> --html "…"')
          let html = flagValue('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html replace: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'replace', id, selector, html }))
        } else if (sub === 'append') {
          const parentId = flagValue('--parent') ?? flagValue('--parent-id')
          const parentSelector = flagValue('--parent-selector')
          if (!parentId && !parentSelector) die('Usage: duo html append --parent <duo-id> --html "…"')
          let html = flagValue('--html')
          if (html === undefined) html = await readStdin()
          if (html === '') die('duo html append: html required (use --html "…" or pipe via stdin)')
          out(await send('html-op', { op: 'append', parentId, parentSelector, html }))
        } else if (sub === 'remove') {
          const id = flagValue('--id')
          const selector = flagValue('--selector')
          if (!id && !selector) die('Usage: duo html remove --id <duo-id> | --selector <css>')
          out(await send('html-op', { op: 'remove', id, selector }))
        } else if (sub === 'attr') {
          const id = flagValue('--id')
          const selector = flagValue('--selector')
          if (!id && !selector) die('Usage: duo html attr --id <duo-id> [--set k=v ...] [--remove k ...]')
          const ops = collectAttrs()
          if (!ops.set && !ops.remove) die('duo html attr: at least one --set k=v or --remove k required')
          out(await send('html-op', { op: 'attr', id, selector, ...ops }))
        } else {
          die('Usage: duo html <new|query|get|set|replace|append|remove|attr> [...]')
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

  send [--text "..."]             Write a payload into the active
                                  terminal's PTY (no Enter appended —
                                  user confirms). Without --text, reads
                                  from stdin. Stage 15 G17: agent-
                                  facing inverse of the Send → Duo
                                  button. Use to plant context for
                                  the user.

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
