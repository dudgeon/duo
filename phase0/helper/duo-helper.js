#!/usr/bin/env node

// Duo Phase 0 — Native Messaging host.
//
// Reads framed JSON from stdin (4-byte length prefix + JSON bytes),
// writes framed JSON to stdout. Logs receipts + a 30-second
// "still alive" heartbeat to ~/.claude/duo/phase0-helper.log so the
// user can confirm the helper survived idle without watching stdout
// (Chrome owns it).
//
// Test interpretation:
//   * heartbeat lines appear every 30s while alive — gaps = death
//   * "recv #N" lines show all ping/keep-alive activity
//   * pid stays constant across the whole run; new pid = SW killed
//     the helper and reconnected, which IS the failure mode

const fs = require('fs')
const path = require('path')
const os = require('os')

const LOG_PATH = path.join(os.homedir(), '.claude', 'duo', 'phase0-helper.log')
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })

function log(msg) {
  const line = `[${new Date().toISOString()}] [pid=${process.pid}] ${msg}\n`
  fs.appendFileSync(LOG_PATH, line)
}

log('helper started')

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
    try {
      msg = JSON.parse(payload.toString('utf8'))
    } catch (e) {
      log(`parse error: ${e.message}`)
      continue
    }
    messageCount++
    handleMessage(msg)
  }
})

process.stdin.on('end', () => {
  log('stdin ended; helper exiting')
  process.exit(0)
})

process.on('uncaughtException', (err) => {
  log(`uncaught: ${err.message}\n${err.stack}`)
  process.exit(1)
})

function send(msg) {
  const json = JSON.stringify(msg)
  const payload = Buffer.from(json, 'utf8')
  const out = Buffer.alloc(4 + payload.length)
  out.writeUInt32LE(payload.length, 0)
  payload.copy(out, 4)
  process.stdout.write(out)
}

function handleMessage(msg) {
  log(`recv #${messageCount}: ${JSON.stringify(msg)}`)
  if (msg.type === 'hello') {
    send({ type: 'hello-ack', pid: process.pid, ts: Date.now() })
  } else if (msg.type === 'ping') {
    send({ type: 'pong', echo: msg.nonce, pid: process.pid, ts: Date.now() })
  } else if (msg.type === 'keep-alive') {
    send({ type: 'keep-alive-ack', pid: process.pid, ts: Date.now() })
  } else {
    send({ type: 'unknown', pid: process.pid, original: msg.type })
  }
}

setInterval(() => {
  log(`alive heartbeat — messages received so far: ${messageCount}`)
}, 30_000)
