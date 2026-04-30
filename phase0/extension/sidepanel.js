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

// ── Mock filetree ─────────────────────────────────────────────────────

const MOCK_TREE = [
  { name: 'duo', kind: 'folder', depth: 0, expanded: true },
  { name: 'core', kind: 'folder', depth: 1, expanded: true },
  { name: 'pty-manager.ts', kind: 'file', depth: 2 },
  { name: 'files-service.ts', kind: 'file', depth: 2 },
  { name: 'socket-server.ts', kind: 'file', depth: 2 },
  { name: 'electron', kind: 'folder', depth: 1 },
  { name: 'docs', kind: 'folder', depth: 1, expanded: true },
  { name: 'roadmap.html', kind: 'file', depth: 2 },
  { name: 'CHANGELOG.md', kind: 'file', depth: 2 },
  { name: 'phase0', kind: 'folder', depth: 1 },
  { name: 'package.json', kind: 'file', depth: 1 },
  { name: 'README.md', kind: 'file', depth: 1 }
]

function renderTree() {
  filetree.innerHTML = ''
  for (const entry of MOCK_TREE) {
    if (entry.depth > 0 && !isAncestorExpanded(entry)) continue
    const li = document.createElement('li')
    li.className = `${entry.kind} depth-${entry.depth} ${entry.expanded ? 'expanded' : ''}`
    li.textContent = entry.name
    li.dataset.name = entry.name
    li.dataset.kind = entry.kind
    li.addEventListener('click', (e) => onTreeClick(entry, li, e))
    filetree.appendChild(li)
  }
}

function isAncestorExpanded(entry) {
  const idx = MOCK_TREE.indexOf(entry)
  for (let i = idx - 1; i >= 0; i--) {
    const cand = MOCK_TREE[i]
    if (cand.depth < entry.depth) {
      return !!cand.expanded && (cand.depth === 0 || isAncestorExpanded(cand))
    }
  }
  return true
}

function onTreeClick(entry, li, e) {
  e.stopPropagation()
  if (entry.kind === 'folder') {
    entry.expanded = !entry.expanded
    renderTree()
    return
  }
  console.log('[sidepanel] file clicked (Phase 3 will open canvas):', entry.name)
  setDrawer(false)
  showBanner(`(Phase 3 will open ${entry.name} in a new tab)`)
}

renderTree()

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
    if (!msg || msg.id !== SESSION_ID) return
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
