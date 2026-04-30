// Duo Phase 4a — canvas tab logic.
//
// Plain textarea editor backed by the helper's files:read/write
// handlers. Phase 4b will swap this surface for the real
// MarkdownEditor (TipTap) once the Vite + React build is in place.
//
// Lifecycle:
//   * URL `?path=…` selects the file
//   * On load, send files:read; populate textarea with reply content
//   * Track dirty state on input; ⌘S or button click → files:write
//   * Reload the mtime on each successful read/write so Phase 4b can
//     do conflict detection later

const params = new URLSearchParams(location.search)
const filePath = params.get('path') || ''

const pathEl = document.getElementById('path')
const statusEl = document.getElementById('status')
const saveBtn = document.getElementById('save-btn')
const editor = document.getElementById('editor')

pathEl.textContent = filePath || '(no path)'
pathEl.title = filePath
document.title = filePath ? `Duo — ${filePath.split('/').pop()}` : 'Duo Canvas'

// ── State ─────────────────────────────────────────────────────────────

let lastSaved = ''      // text as of last successful read/write
let savedMtimeMs = 0    // mtime as of last successful read/write
let port = null
const pending = new Map() // reqId → { resolve, reject, timer }

function setStatus(text, cls) {
  statusEl.textContent = text || ''
  statusEl.classList.remove('ok', 'err', 'dirty')
  if (cls) statusEl.classList.add(cls)
}

function isDirty() {
  return editor.value !== lastSaved
}

function updateSaveButton() {
  saveBtn.disabled = !isDirty() || !filePath
  if (filePath && isDirty()) {
    setStatus('unsaved', 'dirty')
  } else if (filePath && lastSaved !== '') {
    setStatus('saved', 'ok')
  }
}

// ── SW port + request/response ────────────────────────────────────────

function connect() {
  if (port) return
  port = chrome.runtime.connect({ name: 'canvas' })
  port.onMessage.addListener((msg) => {
    if (!msg || !msg.reqId) return
    const entry = pending.get(msg.reqId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(msg.reqId)
    if (msg.ok) entry.resolve(msg)
    else entry.reject(new Error(msg.error || 'request failed'))
  })
  port.onDisconnect.addListener(() => {
    console.warn('[canvas] sw port disconnected')
    port = null
    // Reject anything still in flight so the UI doesn't hang.
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('sw port disconnected'))
    }
    pending.clear()
  })
}

function request(type, body) {
  return new Promise((resolve, reject) => {
    if (!port) connect()
    if (!port) { reject(new Error('no sw port')); return }
    const reqId = type + '-' + Math.random().toString(36).slice(2, 10)
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new Error(`${type} timeout`))
    }, 10_000)
    pending.set(reqId, { resolve, reject, timer })
    port.postMessage({ type, reqId, ...body })
  })
}

// ── Operations ────────────────────────────────────────────────────────

async function loadFile() {
  if (!filePath) {
    setStatus('no path', 'err')
    editor.placeholder = '(no file path in URL)'
    editor.disabled = true
    return
  }
  setStatus('loading…')
  try {
    const res = await request('files:read', { path: filePath })
    editor.value = res.content || ''
    lastSaved = editor.value
    savedMtimeMs = res.mtimeMs || 0
    editor.placeholder = ''
    setStatus('loaded', 'ok')
    updateSaveButton()
  } catch (e) {
    console.error('[canvas] load failed:', e)
    setStatus(`load failed: ${e.message}`, 'err')
  }
}

async function saveFile() {
  if (!filePath || !isDirty()) return
  setStatus('saving…')
  saveBtn.disabled = true
  const snapshot = editor.value
  try {
    const res = await request('files:write', { path: filePath, content: snapshot })
    lastSaved = snapshot
    savedMtimeMs = res.mtimeMs || 0
    setStatus('saved', 'ok')
    updateSaveButton()
  } catch (e) {
    console.error('[canvas] save failed:', e)
    setStatus(`save failed: ${e.message}`, 'err')
    saveBtn.disabled = false
  }
}

// ── Events ────────────────────────────────────────────────────────────

editor.addEventListener('input', updateSaveButton)
saveBtn.addEventListener('click', saveFile)

window.addEventListener('keydown', (e) => {
  if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    saveFile()
  }
})

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault()
    e.returnValue = ''
  }
})

// ── Boot ──────────────────────────────────────────────────────────────

connect()
loadFile()
