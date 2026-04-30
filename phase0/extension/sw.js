// Duo Phase 0/1 — service worker.
//
// Connects to the Native Messaging helper, sets a chrome.alarms keep-
// alive at 25-second cadence (just under the SW idle timeout of 30s),
// relays pings from the side panel, and routes the action click to the
// side panel.
//
// Phase 0 test pass criteria (validated 2026-04-29):
//   * After 30+ minutes of zero user interaction, a ping still round-
//     trips in <100ms.
//   * Helper PID stays constant the whole time (helper not respawned).
//   * No "port disconnected" events while the SW is supposed to be
//     warm.

// Phase 1 — clicking the action icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.warn('[sw] setPanelBehavior failed:', e))

const HELPER_NAME = 'com.duo.phase0'
const KEEP_ALIVE_NAME = 'duo-phase0-keepalive'
const KEEP_ALIVE_PERIOD_MIN = 25 / 60 // 25s expressed in minutes

let port = null
let helperPid = null
let messageCount = 0
let portConnectAttempts = 0

function connectHelper() {
  if (port) return
  portConnectAttempts++
  console.log(`[sw] connecting to native helper (attempt #${portConnectAttempts})`)
  try {
    port = chrome.runtime.connectNative(HELPER_NAME)
  } catch (e) {
    console.error('[sw] connectNative threw:', e)
    port = null
    return
  }

  port.onMessage.addListener((msg) => {
    messageCount++
    if (msg.pid) helperPid = msg.pid
    // Phase 2/3/4a — relay pty:* and files:* events back to all
    // connected client ports (sidepanel + canvas). Anything else
    // (hello-ack, pong, keep-alive-ack) stays SW-internal. Fanout is
    // safe because pty messages are keyed by id and files messages by
    // reqId; non-matching clients ignore them.
    if (msg.type && (msg.type.startsWith('pty:') || msg.type.startsWith('files:'))) {
      for (const cp of clientPorts) {
        try { cp.postMessage(msg) } catch (e) { console.warn('[sw] client post failed:', e) }
      }
    } else {
      console.log(`[sw] msg from helper #${messageCount}:`, msg)
    }
  })

  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError
    console.warn('[sw] port disconnected.', err ? err.message : '(no error info)')
    port = null
  })

  // Greeting so the helper logs an "I am alive" entry on connect.
  try {
    port.postMessage({ type: 'hello', ts: Date.now() })
  } catch (e) {
    console.error('[sw] hello post failed:', e)
    port = null
  }
}

function ensureKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_NAME, { periodInMinutes: KEEP_ALIVE_PERIOD_MIN })
  console.log(`[sw] keep-alive alarm set (every ${(KEEP_ALIVE_PERIOD_MIN * 60).toFixed(0)}s)`)
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[sw] onInstalled')
  ensureKeepAlive()
  connectHelper()
})

chrome.runtime.onStartup.addListener(() => {
  console.log('[sw] onStartup')
  ensureKeepAlive()
  connectHelper()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEP_ALIVE_NAME) return
  console.log(`[sw] keep-alive tick @ ${new Date().toISOString()} (port=${port ? 'open' : 'closed'}, helperPid=${helperPid})`)
  if (!port) connectHelper()
  if (port) {
    try {
      port.postMessage({ type: 'keep-alive', ts: Date.now() })
    } catch (e) {
      console.error('[sw] keep-alive post failed:', e)
      port = null
    }
  }
})

// Popup pings come through here. Reply asynchronously.
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.type !== 'ping-helper') return false
  handlePing(req, sendResponse)
  return true // keep sendResponse alive
})

// ── Phase 2/4a — client-port ↔ helper relay ──────────────────────────
// Side panel and canvas tabs each open a long-lived port via
// chrome.runtime.connect({name: 'sidepanel' | 'canvas'}). Any pty:*
// or files:* message from a client forwards to the native helper port;
// helper replies fan out to all connected client ports (above).
// Single-window for now; multi-window adds a Map<windowId, port>.

const clientPorts = new Set()
const ACCEPTED_PORT_NAMES = new Set(['sidepanel', 'canvas'])

chrome.runtime.onConnect.addListener((port) => {
  if (!ACCEPTED_PORT_NAMES.has(port.name)) return
  console.log(`[sw] ${port.name} port connected`)
  clientPorts.add(port)
  port.onDisconnect.addListener(() => {
    console.log(`[sw] ${port.name} port disconnected`)
    clientPorts.delete(port)
  })
  port.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return
    const isPty = msg.type.startsWith('pty:')
    const isFiles = msg.type.startsWith('files:')
    if (!isPty && !isFiles) return
    if (!nativePortOk()) connectHelper()
    if (!nativePortOk()) {
      port.postMessage(buildHelperError(msg, 'native helper unavailable'))
      return
    }
    try { port_to_helper().postMessage(msg) }
    catch (e) {
      port.postMessage(buildHelperError(msg, e.message))
    }
  })
})

// files:list / files:read / files:write all use { reqId } and reply
// with `:result`. PTY uses { id } and replies with pty:error.
function buildHelperError(req, errorMessage) {
  if (req.type.startsWith('pty:')) {
    return { type: 'pty:error', id: req.id, error: errorMessage }
  }
  return { type: req.type + ':result', reqId: req.reqId, ok: false, error: errorMessage }
}

// Tiny helpers so the sidepanel-port handler stays readable.
// (`port` is the Native Messaging port declared at the top of this file.)
function nativePortOk() { return !!port }
function port_to_helper() { return port }  // eslint-disable-line camelcase

function handlePing(req, sendResponse) {
  const t0 = performance.now()
  if (!port) {
    connectHelper()
    if (!port) {
      sendResponse({ ok: false, error: 'no port', helperPid, messageCount })
      return
    }
  }

  let responded = false
  const listener = (msg) => {
    if (responded) return
    if (msg.type === 'pong' && msg.echo === req.nonce) {
      port.onMessage.removeListener(listener)
      responded = true
      const elapsed = +(performance.now() - t0).toFixed(2)
      sendResponse({ ok: true, elapsedMs: elapsed, helperPid, messageCount })
    }
  }
  port.onMessage.addListener(listener)

  setTimeout(() => {
    if (responded) return
    if (port) port.onMessage.removeListener(listener)
    responded = true
    sendResponse({ ok: false, error: 'timeout (5s)', helperPid, messageCount })
  }, 5000)

  try {
    port.postMessage({ type: 'ping', nonce: req.nonce })
  } catch (e) {
    if (port) port.onMessage.removeListener(listener)
    responded = true
    sendResponse({ ok: false, error: 'post failed: ' + e.message, helperPid, messageCount })
  }
}
