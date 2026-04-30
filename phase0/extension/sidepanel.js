// Duo Phase 1 — side panel logic.
//
// Handles:
//   * rail folder button + ⌘B → toggle drawer
//   * rail clock button → send a Phase-0 diagnostic ping via SW
//   * Esc / outside-click / file-click → close drawer
//   * mock filetree rendering
//
// No real PTY or filesystem yet — that's Phase 2 and Phase 3. Mock
// data is hardcoded below so the UX can be validated independently.

const root = document.getElementById('root')
const drawer = document.getElementById('nav-drawer')
const folderBtn = document.getElementById('rail-folder-btn')
const pingBtn = document.getElementById('rail-ping-btn')
const closeBtn = document.getElementById('drawer-close-btn')
const filetree = document.getElementById('filetree')
const banner = document.getElementById('ping-banner')

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

// ⌘B (Cmd on macOS, Ctrl on others)
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

// click-outside dismiss — anywhere inside #work-area while drawer is open
document.addEventListener('click', (e) => {
  if (drawer.classList.contains('closed')) return
  const t = e.target
  if (drawer.contains(t)) return
  if (folderBtn.contains(t)) return
  setDrawer(false)
})

// ── Mock filetree ─────────────────────────────────────────────────────
// Phase 1 hardcodes these so the layout/interaction can be validated
// without wiring chokidar through the helper. Phase 3 replaces this
// with real entries from helper/files-bridge.

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
  // walk up the mock tree by index — hardcoded shape, so just check
  // the most recent ancestor of lower depth
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
  // file click — dismiss drawer, log a stub for now
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
