#!/usr/bin/env node

// Duo Phase 0/1/2/3/4a/6.5 — Native Messaging host.
//
// Phase 0: keep-alive helper for the SW idle-survival proof.
//   recv: hello / ping / keep-alive  →  send: hello-ack / pong / keep-alive-ack
//
// Phase 2: PTY bridge — spawns node-pty processes and pipes stdin/
// stdout through Native Messaging frames. The helper's launcher.sh
// resolves to /Users/.../node which finds node-pty by walking up to
// the project's node_modules.
//   recv: pty:create / pty:write / pty:resize / pty:kill
//   send: pty:created / pty:data / pty:exit / pty:error
//
// Phase 3: filesystem listing (no chokidar watching yet; Phase 3.5
// adds it). Defaults to $HOME when path is omitted so the side panel
// can boot to a useful tree without hardcoding the user's machine
// layout.
//   recv: files:list { reqId, path? }
//   send: files:list:result { reqId, ok, entries?, resolvedPath?, error? }
//
// Phase 4a: filesystem read/write — backs the canvas-tab editor. UTF-8
// text only for now; binary handling can come later.
//   recv: files:read  { reqId, path }
//   send: files:read:result  { reqId, ok, content?, mtimeMs?, error? }
//   recv: files:write { reqId, path, content }
//   send: files:write:result { reqId, ok, mtimeMs?, error? }
//
// Phase 6.5: CLI bridge — exposes BOTH a Unix domain socket and a
// localhost TCP listener so the `duo-ext` CLI can reach the helper
// from inside a terminal tab regardless of sandboxing. Background:
// Claude Code's bash tool runs in a Seatbelt sandbox that gates
// outbound Unix-socket connections behind explicit allowUnixSockets
// (off by default). The Electron-app duo CLI hit the same wall and
// shipped a TCP fallback in Stage 20 (see docs/DECISIONS.md → Stage 20
// addendum). Same pattern applies here.
//
// Wire:
//   socket recv: { reqId, verb, args? }
//   socket send: { reqId, ok, result?, error? }
//   first TCP line: auth token (raw, no JSON)
//   NM send to SW: { type: 'cli:request', cliReqId, verb, args? }
//   NM recv from SW: { type: 'cli:response', cliReqId, ok, result?, error? }
//
// Port-file: ~/Library/Application Support/Duo/duo-helper.port
//   { port: number, token: string, sock: string }
// The sandboxed CLI reads this file (reads outside cwd are allowed
// in Claude Code's sandbox) to learn the TCP port + auth token.

const fs = require('fs')
const path = require('path')
const os = require('os')

const LOG_PATH = path.join(os.homedir(), '.claude', 'duo', 'phase0-helper.log')
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
function log(msg) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [pid=${process.pid}] ${msg}\n`)
}

let pty = null
try {
  pty = require('node-pty')
  log('=== helper boot (node-pty available) ===')
} catch (e) {
  log(`=== helper boot (node-pty UNAVAILABLE: ${e.message}) ===`)
}

// ── Native Messaging framing ─────────────────────────────────────────

let buf = Buffer.alloc(0)
let messageCount = 0

process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0)
    if (buf.length < 4 + len) break
    const payload = buf.slice(4, 4 + len)
    buf = buf.slice(4 + len)
    let msg
    try { msg = JSON.parse(payload.toString('utf8')) }
    catch (e) { log(`parse error: ${e.message}`); continue }
    messageCount++
    handleMessage(msg)
  }
})
process.stdin.on('end', () => { log('stdin: end event; exiting'); cleanupAndExit(0) })
process.stdin.on('error', (e) => log(`stdin: error ${e.message}`))
process.on('uncaughtException', (e) => { log(`uncaught: ${e.message}\n${e.stack}`); cleanupAndExit(1) })

function send(msg) {
  const json = JSON.stringify(msg)
  const payload = Buffer.from(json, 'utf8')
  const out = Buffer.alloc(4 + payload.length)
  out.writeUInt32LE(payload.length, 0)
  payload.copy(out, 4)
  process.stdout.write(out)
}

// ── PTY sessions ─────────────────────────────────────────────────────

const ptySessions = new Map() // id → pty.IPty

function ptyCreate(req) {
  if (!pty) {
    send({ type: 'pty:error', id: req.id, error: 'node-pty not available in helper' })
    return
  }
  if (ptySessions.has(req.id)) {
    send({ type: 'pty:error', id: req.id, error: 'session id already exists' })
    return
  }
  const shell = req.shell || process.env.SHELL || '/bin/zsh'
  const cwd = req.cwd || process.env.HOME || '/tmp'
  const cols = req.cols || 80
  const rows = req.rows || 24
  log(`pty:create id=${req.id} shell=${shell} cwd=${cwd} ${cols}x${rows}`)
  let proc
  try {
    proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows, cwd,
      env: {
        ...process.env,
        TERM_PROGRAM: 'Duo',
        DUO_SESSION: '1',
      }
    })
  } catch (e) {
    send({ type: 'pty:error', id: req.id, error: `spawn failed: ${e.message}` })
    return
  }
  proc.onData((data) => send({ type: 'pty:data', id: req.id, data }))
  proc.onExit(({ exitCode, signal }) => {
    log(`pty:exit id=${req.id} code=${exitCode} signal=${signal ?? 'none'}`)
    ptySessions.delete(req.id)
    send({ type: 'pty:exit', id: req.id, exitCode, signal: signal ?? null })
  })
  ptySessions.set(req.id, proc)
  send({ type: 'pty:created', id: req.id, pid: proc.pid })
}

function ptyWrite(req) {
  const proc = ptySessions.get(req.id)
  if (!proc) {
    send({ type: 'pty:error', id: req.id, error: 'no such pty session' })
    return
  }
  proc.write(req.data ?? '')
}

function ptyResize(req) {
  const proc = ptySessions.get(req.id)
  if (!proc) return
  try { proc.resize(req.cols, req.rows) }
  catch (e) { log(`resize error: ${e.message}`) }
}

function ptyKill(req) {
  const proc = ptySessions.get(req.id)
  if (!proc) return
  try { proc.kill() } catch (e) { log(`kill error: ${e.message}`) }
  ptySessions.delete(req.id)
}

function cleanupAndExit(code) {
  for (const [, proc] of ptySessions) {
    try { proc.kill() } catch {}
  }
  ptySessions.clear()
  process.exit(code)
}

// ── Files / fs (Phase 3) ─────────────────────────────────────────────

async function filesList(req) {
  const target = req.path && req.path !== '~' && req.path !== ''
    ? req.path
    : (process.env.HOME || '/tmp')
  try {
    const dirents = await fs.promises.readdir(target, { withFileTypes: true })
    const entries = []
    for (const d of dirents) {
      // skip dotfiles by default — Phase 3 keeps the tree readable; agent
      // verbs can ask for hidden=true later
      if (d.name.startsWith('.') && !req.includeHidden) continue
      const full = path.join(target, d.name)
      let size, mtimeMs
      const kind = d.isDirectory() ? 'directory' : (d.isFile() ? 'file' : 'other')
      if (kind === 'file') {
        try {
          const st = await fs.promises.stat(full)
          size = st.size
          mtimeMs = st.mtimeMs
        } catch { /* permission / dangling symlink — list anyway */ }
      }
      entries.push({ name: d.name, path: full, kind, size, mtimeMs })
    }
    // Folders first, then files; case-fold alpha within each group.
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    send({
      type: 'files:list:result',
      reqId: req.reqId,
      ok: true,
      resolvedPath: target,
      entries
    })
  } catch (e) {
    send({
      type: 'files:list:result',
      reqId: req.reqId,
      ok: false,
      error: e.message
    })
  }
}

async function filesRead(req) {
  if (!req.path) {
    send({ type: 'files:read:result', reqId: req.reqId, ok: false, error: 'path required' })
    return
  }
  try {
    const [content, st] = await Promise.all([
      fs.promises.readFile(req.path, 'utf8'),
      fs.promises.stat(req.path),
    ])
    send({
      type: 'files:read:result',
      reqId: req.reqId,
      ok: true,
      content,
      mtimeMs: st.mtimeMs,
    })
  } catch (e) {
    send({ type: 'files:read:result', reqId: req.reqId, ok: false, error: e.message })
  }
}

// ── CLI bridge (Phase 6.5) ───────────────────────────────────────────
//
// Unix domain socket at ~/Library/Application Support/Duo/duo-helper.sock.
// The path lives next to the helper itself (per install.sh) so the CLI
// can find it deterministically without env vars.
//
// Protocol (each direction): one JSON object per newline. The CLI
// generates a reqId; the helper passes it through to the SW as
// `cliReqId`; the SW echoes it on the response, the helper looks up
// the originating socket connection, replies on it.
//
// Multi-client safe: a Map<cliReqId, socket> tracks in-flight
// requests; closed sockets remove their entries on connection end.

const net = require('net')
const crypto = require('crypto')
const DUO_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'Duo')
const SOCKET_PATH = path.join(DUO_DIR, 'duo-helper.sock')
const PORT_FILE = path.join(DUO_DIR, 'duo-helper.port')

const cliPending = new Map() // cliReqId → socket
let cliReqCounter = 0
const AUTH_TOKEN = crypto.randomBytes(32).toString('hex')

function startCliSocket() {
  try { fs.mkdirSync(DUO_DIR, { recursive: true }) } catch {}

  // Per-connection state — closed-over by handleConnection so the
  // Unix and TCP listeners can share the same code path.
  const handleConnection = ({ requireAuth }) => (socket) => {
    log(`cli: ${requireAuth ? 'tcp' : 'unix'} socket connected`)
    let authed = !requireAuth
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line) continue
        if (!authed) {
          // First TCP line is the auth token. Drop the connection on
          // mismatch; do not echo back anything that could leak whether
          // the line was even a token.
          if (line === AUTH_TOKEN) {
            authed = true
            continue
          }
          log(`cli: tcp auth failure`)
          try { socket.destroy() } catch {}
          return
        }
        let req
        try { req = JSON.parse(line) }
        catch (e) {
          socket.write(JSON.stringify({ ok: false, error: 'parse error: ' + e.message }) + '\n')
          continue
        }
        handleCliRequest(req, socket)
      }
    })
    socket.on('close', () => {
      log(`cli: ${requireAuth ? 'tcp' : 'unix'} socket closed`)
      for (const [id, s] of cliPending) {
        if (s === socket) cliPending.delete(id)
      }
    })
    socket.on('error', (e) => log(`cli: socket error ${e.message}`))
  }

  // ── Unix socket listener (fast path) ──────────────────────────────
  try { fs.unlinkSync(SOCKET_PATH) } catch { /* not present, fine */ }
  const unixServer = net.createServer(handleConnection({ requireAuth: false }))
  unixServer.on('error', (e) => log(`cli: unix server error ${e.message}`))
  unixServer.listen(SOCKET_PATH, () => {
    log(`cli: unix listening on ${SOCKET_PATH}`)
    try { fs.chmodSync(SOCKET_PATH, 0o600) } catch {}
  })

  // ── TCP fallback (sandbox-tolerant, see doc/DECISIONS.md ADR) ────
  const tcpServer = net.createServer(handleConnection({ requireAuth: true }))
  tcpServer.on('error', (e) => log(`cli: tcp server error ${e.message}`))
  tcpServer.listen(0, '127.0.0.1', () => {
    const { port } = tcpServer.address()
    log(`cli: tcp listening on 127.0.0.1:${port}`)
    // Write the port file atomically: write to .tmp then rename, so a
    // CLI reading the file mid-write never sees a partial JSON.
    const payload = JSON.stringify({ port, token: AUTH_TOKEN, sock: SOCKET_PATH }, null, 2)
    const tmp = PORT_FILE + '.tmp'
    try {
      fs.writeFileSync(tmp, payload)
      fs.renameSync(tmp, PORT_FILE)
      fs.chmodSync(PORT_FILE, 0o600)
      log(`cli: wrote ${PORT_FILE}`)
    } catch (e) {
      log(`cli: write port file failed: ${e.message}`)
    }
  })
}

function handleCliRequest(req, socket) {
  if (!req.verb || typeof req.verb !== 'string') {
    socket.write(JSON.stringify({ reqId: req.reqId, ok: false, error: 'verb required' }) + '\n')
    return
  }
  cliReqCounter++
  const cliReqId = `cli-${process.pid}-${cliReqCounter}`
  cliPending.set(cliReqId, socket)
  // Forward to SW. The hello-ack proves the SW is connected; if the SW
  // isn't currently listening (can happen briefly when the SW restarts),
  // the message is buffered in the NM port and delivered when the SW
  // re-attaches a listener.
  send({
    type: 'cli:request',
    cliReqId,
    verb: req.verb,
    args: req.args ?? {},
    cliRequestId: req.reqId, // echoed back to the CLI
  })
  // 30s safety timeout in case the SW never replies (extension reload,
  // permission revocation, etc.). Without this the CLI would hang.
  setTimeout(() => {
    if (cliPending.has(cliReqId)) {
      cliPending.delete(cliReqId)
      try {
        socket.write(JSON.stringify({ reqId: req.reqId, ok: false, error: 'sw timeout (30s)' }) + '\n')
      } catch {}
    }
  }, 30_000)
}

function handleCliResponse(msg) {
  const socket = cliPending.get(msg.cliReqId)
  if (!socket) {
    log(`cli: orphaned response cliReqId=${msg.cliReqId} (socket already closed?)`)
    return
  }
  cliPending.delete(msg.cliReqId)
  try {
    socket.write(JSON.stringify({
      reqId: msg.cliRequestId,
      ok: !!msg.ok,
      result: msg.result,
      error: msg.error,
    }) + '\n')
  } catch (e) {
    log(`cli: socket write failed: ${e.message}`)
  }
}

async function filesWrite(req) {
  if (!req.path) {
    send({ type: 'files:write:result', reqId: req.reqId, ok: false, error: 'path required' })
    return
  }
  if (typeof req.content !== 'string') {
    send({ type: 'files:write:result', reqId: req.reqId, ok: false, error: 'content must be a string' })
    return
  }
  try {
    await fs.promises.writeFile(req.path, req.content, 'utf8')
    const st = await fs.promises.stat(req.path)
    send({ type: 'files:write:result', reqId: req.reqId, ok: true, mtimeMs: st.mtimeMs })
  } catch (e) {
    send({ type: 'files:write:result', reqId: req.reqId, ok: false, error: e.message })
  }
}

// ── Message dispatch ─────────────────────────────────────────────────

function handleMessage(msg) {
  // Phase 0
  if (msg.type === 'hello') {
    log('recv hello')
    send({ type: 'hello-ack', pid: process.pid, ts: Date.now() })
  } else if (msg.type === 'ping') {
    send({ type: 'pong', echo: msg.nonce, pid: process.pid, ts: Date.now() })
  } else if (msg.type === 'keep-alive') {
    send({ type: 'keep-alive-ack', pid: process.pid, ts: Date.now() })
  }
  // Phase 2 — PTY
  else if (msg.type === 'pty:create') ptyCreate(msg)
  else if (msg.type === 'pty:write')  ptyWrite(msg)
  else if (msg.type === 'pty:resize') ptyResize(msg)
  else if (msg.type === 'pty:kill')   ptyKill(msg)
  // Phase 3 — files (list)
  else if (msg.type === 'files:list')  filesList(msg)
  // Phase 4a — files (read/write)
  else if (msg.type === 'files:read')  filesRead(msg)
  else if (msg.type === 'files:write') filesWrite(msg)
  // Phase 6.5 — CLI bridge response (helper-internal)
  else if (msg.type === 'cli:response') handleCliResponse(msg)
  else {
    log(`recv unknown: ${msg.type}`)
    send({ type: 'unknown', pid: process.pid, original: msg.type })
  }
}

setInterval(() => log(`alive heartbeat — messages=${messageCount}, ptys=${ptySessions.size}, cli-pending=${cliPending.size}`), 30_000)

// Phase 6.5 — open the CLI socket on boot. Best-effort: if it can't
// listen (port in use by another helper, permission denied, etc.) we
// log and keep going — PTY/files paths still work.
try { startCliSocket() } catch (e) { log(`cli: startCliSocket failed: ${e.message}`) }
