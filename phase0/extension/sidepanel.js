// Duo Phase 1/2 — side panel logic.
//
// Phase 1 (UI scaffolding):
//   * rail folder + ⌘B → toggle drawer
//   * rail clock → send Phase-0 diagnostic ping via SW
//   * Esc / outside-click / file-click → close drawer
//
// Phase 2 (real PTY):
//   * mount xterm.Terminal + FitAddon in #terminal-host
//   * open chrome.runtime.connect({name:'sidepanel'}) to the SW
//   * spawn a real PTY in the helper via pty:create
//   * forward keystrokes (term.onData) → SW → helper.write
//   * pipe pty:data from helper → SW → term.write
//   * fit on window resize, propagate cols/rows to helper

const root = document.getElementById('root')
const drawer = document.getElementById('nav-drawer')
const folderBtn = document.getElementById('rail-folder-btn')
const pingBtn = document.getElementById('rail-ping-btn')
const closeBtn = document.getElementById('drawer-close-btn')
const filetree = document.getElementById('filetree')
const banner = document.getElementById('ping-banner')
const termHost = document.getElementById('terminal-host')

// ── Drawer ────────────────────────────────────────────────────────────

function setDrawer(open) {
  drawer.classList.toggle('closed', !open)
  drawer.setAttribute('aria-hidden', String(!open))
  folderBtn.setAttribute('aria-expanded', String(open))
  folderBtn.classList.toggle('active', open)
  root.classList.toggle('drawer-open', open)
  // Phase 3 — first open triggers the real fs boot. Idempotent.
  if (open && typeof bootTree === 'function' && !treeBooted) {
    treeBooted = true
    bootTree()
  }
}

function toggleDrawer() {
  setDrawer(drawer.classList.contains('closed'))
}

folderBtn.addEventListener('click', toggleDrawer)
closeBtn.addEventListener('click', () => setDrawer(false))

window.addEventListener('keydown', (e) => {
  if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    toggleDrawer()
    return
  }
  if (e.key === 'Escape' && !drawer.classList.contains('closed')) {
    setDrawer(false)
  }
})

document.addEventListener('click', (e) => {
  if (drawer.classList.contains('closed')) return
  const t = e.target
  if (drawer.contains(t)) return
  if (folderBtn.contains(t)) return
  setDrawer(false)
})

// ── Real filetree (Phase 3) ───────────────────────────────────────────
//
// Lazy tree. We hold per-path state in `nodes` (kind, expanded,
// children). Children are loaded on first expand via `files:list`
// over the SW port. Re-render happens after every state change.

const nodes = new Map() // absPath → { kind, expanded, children? }
let rootPath = null
const pendingFilesRequests = new Map() // reqId → { resolve, reject }

function listDir(absPath) {
  return new Promise((resolve, reject) => {
    if (!swPort) connectSw()
    if (!swPort) { reject(new Error('no SW port')); return }
    const reqId = 'fl-' + Math.random().toString(36).slice(2, 10)
    const timer = setTimeout(() => {
      pendingFilesRequests.delete(reqId)
      reject(new Error('files:list timeout'))
    }, 5000)
    pendingFilesRequests.set(reqId, { resolve, reject, timer })
    swPort.postMessage({ type: 'files:list', reqId, path: absPath ?? '' })
  })
}

function handleFilesResult(msg) {
  const pending = pendingFilesRequests.get(msg.reqId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingFilesRequests.delete(msg.reqId)
  if (msg.ok) pending.resolve(msg)
  else pending.reject(new Error(msg.error || 'files:list failed'))
}

async function loadAndExpand(absPath) {
  let node = nodes.get(absPath)
  if (!node) {
    node = { kind: 'directory', expanded: false }
    nodes.set(absPath, node)
  }
  if (!node.children) {
    try {
      const result = await listDir(absPath)
      node.children = result.entries
      for (const e of result.entries) {
        if (!nodes.has(e.path)) nodes.set(e.path, { kind: e.kind === 'directory' ? 'directory' : 'file', expanded: false })
      }
    } catch (e) {
      showBanner(`✗ ${e.message}`, 'err')
      return
    }
  }
  node.expanded = true
  renderTree()
}

function collapse(absPath) {
  const node = nodes.get(absPath)
  if (node) { node.expanded = false; renderTree() }
}

function renderTree() {
  filetree.innerHTML = ''
  if (!rootPath) return
  // Root row: shows the resolved root dir as the first entry.
  const rootName = rootPath.split('/').filter(Boolean).pop() || rootPath
  const rootLi = document.createElement('li')
  rootLi.className = 'folder depth-0 expanded'
  rootLi.textContent = rootName
  rootLi.title = rootPath
  rootLi.addEventListener('click', (e) => { e.stopPropagation(); collapse(rootPath) })
  filetree.appendChild(rootLi)
  // Render children in document order, recursively walking expanded folders.
  walkRender(rootPath, 1)
}

function walkRender(absPath, depth) {
  const node = nodes.get(absPath)
  if (!node || !node.expanded || !node.children) return
  for (const e of node.children) {
    const li = document.createElement('li')
    const childNode = nodes.get(e.path)
    const expanded = e.kind === 'directory' && childNode && childNode.expanded
    li.className = `${e.kind === 'directory' ? 'folder' : 'file'} depth-${Math.min(depth, 2)} ${expanded ? 'expanded' : ''}`
    li.textContent = e.name
    li.title = e.path
    li.addEventListener('click', (ev) => onEntryClick(ev, e))
    filetree.appendChild(li)
    if (expanded) walkRender(e.path, depth + 1)
  }
}

function onEntryClick(ev, entry) {
  ev.stopPropagation()
  if (entry.kind === 'directory') {
    const node = nodes.get(entry.path)
    if (node && node.expanded) collapse(entry.path)
    else loadAndExpand(entry.path)
    return
  }
  // File click: open in a new tab via canvas.html.
  // Phase 4 will mount MarkdownEditor; today canvas.html is a stub.
  setDrawer(false)
  const url = chrome.runtime.getURL('canvas.html') + '?path=' + encodeURIComponent(entry.path)
  chrome.tabs.create({ url })
  showBanner(`opened ${entry.name} in new tab`, 'ok')
}

async function bootTree() {
  try {
    const result = await listDir('')
    rootPath = result.resolvedPath
    const root = nodes.get(rootPath) || { kind: 'directory', expanded: true }
    root.children = result.entries
    root.expanded = true
    nodes.set(rootPath, root)
    for (const e of result.entries) {
      if (!nodes.has(e.path)) nodes.set(e.path, { kind: e.kind === 'directory' ? 'directory' : 'file', expanded: false })
    }
    renderTree()
  } catch (e) {
    filetree.innerHTML = `<li class="file" style="color:#f08a8a">✗ ${e.message}</li>`
  }
}

// First open triggers the real fs boot — guarded inside setDrawer.
let treeBooted = false

// ── Ping (Phase-0 diagnostic) ─────────────────────────────────────────

pingBtn.addEventListener('click', () => {
  const nonce = Math.random().toString(36).slice(2, 10)
  const t0 = performance.now()
  showBanner(`→ pinging helper (${nonce})...`)
  chrome.runtime.sendMessage({ type: 'ping-helper', nonce }, (response) => {
    const popupTotal = (performance.now() - t0).toFixed(1)
    if (chrome.runtime.lastError) {
      showBanner(`✗ ${chrome.runtime.lastError.message}`, 'err')
      return
    }
    if (response && response.ok) {
      showBanner(
        `✓ pong ${response.elapsedMs}ms (e2e ${popupTotal}ms) pid=${response.helperPid} msg#${response.messageCount}`,
        'ok'
      )
    } else {
      showBanner(`✗ ${response ? response.error : 'no response'}`, 'err')
    }
  })
})

let bannerTimer = null
function showBanner(text, cls) {
  banner.classList.remove('hidden', 'ok', 'err')
  if (cls) banner.classList.add(cls)
  banner.textContent = text
  if (bannerTimer) clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => banner.classList.add('hidden'), 6000)
}

// ── Phase 2 — real PTY via xterm + SW port ────────────────────────────

const SESSION_ID = 'sp-' + Math.random().toString(36).slice(2, 10)

const term = new window.Terminal({
  cursorBlink: true,
  fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: 1.2,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    black: '#000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#fff'
  },
  scrollback: 10_000,
  convertEol: false
})

const fitAddon = new window.FitAddon.FitAddon()
term.loadAddon(fitAddon)
term.open(termHost)

let lastCols = 80, lastRows = 24

function fitAndPropagate() {
  try {
    fitAddon.fit()
    const { cols, rows } = term
    if (cols !== lastCols || rows !== lastRows) {
      lastCols = cols
      lastRows = rows
      if (swPort && ptyReady) {
        swPort.postMessage({ type: 'pty:resize', id: SESSION_ID, cols, rows })
      }
    }
  } catch (e) {
    console.warn('[sidepanel] fit failed:', e)
  }
}

// Initial fit happens after layout stabilizes.
requestAnimationFrame(() => requestAnimationFrame(fitAndPropagate))
window.addEventListener('resize', fitAndPropagate)

// Connect to the SW.
let swPort = null
let ptyReady = false

function connectSw() {
  if (swPort) return
  swPort = chrome.runtime.connect({ name: 'sidepanel' })
  swPort.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return
    // Phase 3 — files:list:result is keyed by reqId, not session id.
    if (msg.type === 'files:list:result') {
      handleFilesResult(msg)
      return
    }
    // Phase 2 — pty messages are keyed by SESSION_ID.
    if (msg.id !== SESSION_ID) return
    if (msg.type === 'pty:created') {
      ptyReady = true
      console.log('[sidepanel] pty created (helper pid=' + msg.pid + ')')
    } else if (msg.type === 'pty:data') {
      term.write(msg.data)
    } else if (msg.type === 'pty:exit') {
      ptyReady = false
      term.write(`\r\n\x1b[2;90m[pty exited code=${msg.exitCode}]\x1b[0m\r\n`)
    } else if (msg.type === 'pty:error') {
      term.write(`\r\n\x1b[31m[pty error: ${msg.error}]\x1b[0m\r\n`)
      ptyReady = false
    }
  })
  swPort.onDisconnect.addListener(() => {
    console.warn('[sidepanel] sw port disconnected')
    swPort = null
    ptyReady = false
    // Try to reconnect on next user keypress.
  })
  // Spawn the PTY.
  swPort.postMessage({
    type: 'pty:create',
    id: SESSION_ID,
    cols: term.cols,
    rows: term.rows
  })
}

connectSw()

// Forward keystrokes to the PTY.
term.onData((data) => {
  if (!ptyReady) {
    if (!swPort) connectSw()
    return
  }
  swPort.postMessage({ type: 'pty:write', id: SESSION_ID, data })
})

// Tear down the PTY when the panel is closed (browser fires this on tab/panel close).
window.addEventListener('beforeunload', () => {
  if (swPort && ptyReady) {
    try { swPort.postMessage({ type: 'pty:kill', id: SESSION_ID }) } catch {}
  }
})
