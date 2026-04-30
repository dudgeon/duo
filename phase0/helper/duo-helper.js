#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOG_PATH = path.join(os.homedir(), '.claude', 'duo', 'phase0-helper.log')
fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
function log(msg) {
  fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [pid=${process.pid}] ${msg}\n`)
}

log('=== helper boot ===')

let buf = Buffer.alloc(0)
let messageCount = 0

process.stdin.on('data', (chunk) => {
  log(`recv chunk: ${chunk.length} bytes`)
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
process.stdin.on('end', () => { log('stdin: end event; exiting'); process.exit(0) })
process.stdin.on('error', (e) => log(`stdin: error ${e.message}`))
process.on('uncaughtException', (e) => { log(`uncaught: ${e.message}`); process.exit(1) })

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
  if (msg.type === 'hello') send({ type: 'hello-ack', pid: process.pid, ts: Date.now() })
  else if (msg.type === 'ping') send({ type: 'pong', echo: msg.nonce, pid: process.pid, ts: Date.now() })
  else if (msg.type === 'keep-alive') send({ type: 'keep-alive-ack', pid: process.pid, ts: Date.now() })
  else send({ type: 'unknown', pid: process.pid, original: msg.type })
}

setInterval(() => log(`alive heartbeat — messages=${messageCount}`), 30_000)
