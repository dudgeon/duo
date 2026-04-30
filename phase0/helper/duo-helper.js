#!/usr/bin/env node

// Duo Phase 0/1/2 — Native Messaging host.
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
  else {
    log(`recv unknown: ${msg.type}`)
    send({ type: 'unknown', pid: process.pid, original: msg.type })
  }
}

setInterval(() => log(`alive heartbeat — messages=${messageCount}, ptys=${ptySessions.size}`), 30_000)
