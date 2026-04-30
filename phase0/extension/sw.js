// Duo Phase 0 — service worker.
//
// Connects to the Native Messaging helper, sets a chrome.alarms keep-
// alive at 25-second cadence (just under the SW idle timeout of 30s),
// relays pings from the popup, and logs everything so the user can see
// what's happening from chrome://extensions → "service worker".
//
// Test pass criteria (per phase0/README.md):
//   * After 30+ minutes of zero user interaction, a popup ping still
//     round-trips in <100ms.
//   * Helper PID stays constant the whole time (helper not respawned).
//   * No "port disconnected" events while the SW is supposed to be
//     warm.

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
    console.log(`[sw] msg from helper #${messageCount}:`, msg)
    if (msg.pid) helperPid = msg.pid
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
