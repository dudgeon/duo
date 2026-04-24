import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import type { FileTab, ActiveWorking } from './components/WorkingPane'
import { classifyFile } from './components/fileClassifier'
import { FilesPane } from './components/FilesPane'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useNavigator, computePendingCwd } from './hooks/useNavigator'
import type { TabSession, DirEntry } from '@shared/types'

// Stage 10 § D32: auto-collapse the Files column on windows narrower than
// this. The user can manually re-expand; we don't re-collapse again unless
// the threshold is re-crossed (hysteresis prevents jitter).
const AUTO_COLLAPSE_WIDTH = 1100

// Stage 9: cozy-mode persistence keys. Per-tab map survives within a
// session but tab UUIDs don't span relaunches; the last-choice flag is the
// durable piece (new tabs inherit it per PRD § C4).
const COZY_BY_TAB_KEY = 'duo.cozy.v1.byTab'
const COZY_LAST_KEY = 'duo.cozy.v1.lastChoice'

function loadCozyByTab(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COZY_BY_TAB_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch { return {} }
}

function loadCozyLast(): boolean {
  try { return localStorage.getItem(COZY_LAST_KEY) === '1' } catch { return false }
}

type FocusedColumn = 'files' | 'terminal' | 'working'

function makeTab(cwd: string): TabSession {
  return {
    id: crypto.randomUUID(),
    title: 'Terminal',
    cwd
  }
}

export function App() {
  const home = window.electron.env.HOME || '~'
  const nav = useNavigator(home)
  const pendingCwd = computePendingCwd(nav.state)

  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab(home)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)

  const [splitPct, setSplitPct] = useState(55)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const [filesCollapsed, setFilesCollapsed] = useState(false)
  const lastAutoCollapseState = useRef(false)

  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('terminal')

  // Stage 10 Phase 5 — working-pane file tabs live in App-level state so
  // the navigator can push into them from FilesPane.onOpenFile.
  const [fileTabs, setFileTabs] = useState<FileTab[]>([])
  const [activeWorking, setActiveWorking] = useState<ActiveWorking>({ kind: 'browser' })

  // Stage 10 Phase 6 § D16 — dismissible chip when the agent drives the
  // navigator via `duo reveal`. Cleared after ~4s or by user dismiss.
  const [revealChip, setRevealChip] = useState<string | null>(null)

  // Stage 9 — per-tab cozy mode. `cozyByTab` is keyed by tab UUID;
  // `cozyDefault` seeds new tabs with the last-toggled value.
  const [cozyByTab, setCozyByTab] = useState<Record<string, boolean>>(loadCozyByTab)
  const [cozyDefault, setCozyDefault] = useState<boolean>(loadCozyLast)

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeCozy = activeTab ? (cozyByTab[activeTab.id] ?? cozyDefault) : false

  // ── Tab actions ────────────────────────────────────────────────────────────

  // Stage 10 § D9: new terminal tabs launch in `pendingCwd`, which is the
  // navigator's current folder (or the selected file's parent).
  const newTab = useCallback(() => {
    const tab = makeTab(pendingCwd)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [pendingCwd])

  // "Open terminal here" from the navigator's right-click menu (§ D11).
  // Explicit CWD bypasses the pending-CWD rule so the user gets exactly
  // the folder they right-clicked, even if a file is selected elsewhere.
  const openTerminalHere = useCallback((folderPath: string) => {
    const tab = makeTab(folderPath)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
    setFocusedColumn('terminal')
  }, [])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length === 1) return prev
      const next = prev.filter(t => t.id !== id)
      if (id === activeTabId) {
        const idx = prev.findIndex(t => t.id === id)
        setActiveTabId(next[Math.max(0, idx - 1)].id)
      }
      return next
    })
  }, [activeTabId])

  const updateTabTitle = useCallback((id: string, title: string) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, title } : t))
  }, [])

  // Stage 10 § D1: follow-mode — unless the navigator is pinned, switching
  // between terminal tabs moves the navigator's cwd to that tab's launch
  // CWD. This is the "context drawer" behavior.
  //
  // The trigger is a *tab switch*, not any nav-state change. Earlier
  // versions re-ran on every render, which reverted any breadcrumb /
  // tree click back to the active tab's launch CWD. The ref guards against
  // that: we only follow when activeTabId differs from the last tab we
  // followed.
  const lastFollowedTabIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (nav.state.pinned || !activeTab) return
    if (lastFollowedTabIdRef.current === activeTabId) return
    lastFollowedTabIdRef.current = activeTabId
    if (nav.state.cwd !== activeTab.cwd) nav.setCwd(activeTab.cwd)
  }, [activeTabId, activeTab, nav])

  // Stage 10 Phase 6: push navigator-state snapshots to the main process
  // so `duo nav state` can read the current value without a renderer RPC.
  useEffect(() => {
    window.electron.nav.pushState({
      cwd: nav.state.cwd,
      selected: nav.state.selected,
      expanded: [...nav.state.expanded],
      pinned: nav.state.pinned
    })
  }, [nav.state.cwd, nav.state.selected, nav.state.expanded, nav.state.pinned])

  // ── File-open from the navigator ───────────────────────────────────────────

  // Open (or switch to) a file tab in the WorkingPane. § D13 — same-path
  // identity: if a tab already exists for this path, activate it instead of
  // creating a duplicate.
  const openFile = useCallback((path: string, title: string) => {
    setFileTabs(prev => {
      const existing = prev.find(t => t.path === path)
      if (existing) {
        setActiveWorking({ kind: 'file', id: existing.id })
        return prev
      }
      const { type, mime } = classifyFile(path)
      const id = crypto.randomUUID()
      setActiveWorking({ kind: 'file', id })
      return [...prev, { id, type, path, title, mime }]
    })
    setFocusedColumn('working')
  }, [])

  const onOpenFile = useCallback((entry: DirEntry) => {
    openFile(entry.path, entry.name)
  }, [openFile])

  const closeFileTab = useCallback((id: string) => {
    setFileTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      // If we closed the active file tab, fall back to the browser tab set.
      if (activeWorking.kind === 'file' && activeWorking.id === id) {
        setActiveWorking({ kind: 'browser' })
      }
      return next
    })
  }, [activeWorking])

  // Called by MarkdownPreview when the user clicks an internal .md link.
  const onOpenMarkdown = useCallback((path: string) => {
    const name = path.slice(path.lastIndexOf('/') + 1) || path
    openFile(path, name)
  }, [openFile])

  // Stage 10 Phase 6: `duo reveal <path>` from the CLI. Move the navigator
  // to that path and surface a dismissible chip.
  useEffect(() => {
    return window.electron.nav.onReveal((p) => {
      nav.actions.navigateTo(p)
      setRevealChip(p)
    })
  }, [nav.actions])

  // Auto-dismiss the chip after 4 seconds.
  useEffect(() => {
    if (!revealChip) return
    const h = setTimeout(() => setRevealChip(null), 4000)
    return () => clearTimeout(h)
  }, [revealChip])

  // Stage 10 Phase 6: `duo view <path>` from the CLI. Open as a file tab.
  useEffect(() => {
    return window.electron.nav.onView((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1) || p
      openFile(p, name)
    })
  }, [openFile])

  // ── Cozy mode (Stage 9) ────────────────────────────────────────────────────

  // Listen for View → Cozy mode menu clicks. Flip the active tab's cozy
  // state, update the "remember last choice" default, persist, and push
  // the new value back so the menu checkmark tracks it.
  //
  // Guard the electron.cozy API: in dev, preload only loads once per window
  // creation. A stale preload (from before Stage 9) has no `cozy` surface,
  // so the effect would throw and crash the component tree. Silently
  // no-oping here means cozy is just inert until Electron is restarted.
  useEffect(() => {
    if (!window.electron.cozy) return
    return window.electron.cozy.onToggle(() => {
      if (!activeTab) return
      const current = cozyByTab[activeTab.id] ?? cozyDefault
      const next = !current
      setCozyByTab(prev => {
        const updated = { ...prev, [activeTab.id]: next }
        try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(updated)) } catch { /* quota */ }
        return updated
      })
      setCozyDefault(next)
      try { localStorage.setItem(COZY_LAST_KEY, next ? '1' : '0') } catch { /* quota */ }
      window.electron.cozy?.pushState(next)
    })
  }, [activeTab, cozyByTab, cozyDefault])

  // Keep the menu checkmark aligned with the active tab whenever it changes.
  useEffect(() => {
    window.electron.cozy?.pushState(activeCozy)
  }, [activeCozy])

  // Drop stale cozy entries when tabs close so the persisted map can't
  // grow unbounded across sessions (C5).
  useEffect(() => {
    const liveIds = new Set(tabs.map(t => t.id))
    setCozyByTab(prev => {
      const pruned: Record<string, boolean> = {}
      let changed = false
      for (const [id, val] of Object.entries(prev)) {
        if (liveIds.has(id)) pruned[id] = val
        else changed = true
      }
      if (!changed) return prev
      try { localStorage.setItem(COZY_BY_TAB_KEY, JSON.stringify(pruned)) } catch { /* quota */ }
      return pruned
    })
  }, [tabs])

  // ── Split-pane resize (middle/right) ───────────────────────────────────────

  const onDividerMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return
      const { left, width } = splitContainerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - left) / width) * 100
      setSplitPct(Math.min(Math.max(pct, 20), 80))
    }
    const onUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Window-width auto-collapse for Files column ────────────────────────────

  useEffect(() => {
    const check = () => {
      const narrow = window.innerWidth < AUTO_COLLAPSE_WIDTH
      if (narrow !== lastAutoCollapseState.current) {
        lastAutoCollapseState.current = narrow
        if (narrow) setFilesCollapsed(true)
      }
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useKeyboardShortcuts({
    newTerminalTab: newTab,
    newBrowserTab: () => { window.electron.browser.addTab() },
    closeTab: () => {
      if (focusedColumn === 'working') {
        // § D29 — close whichever working-pane tab is currently active.
        if (activeWorking.kind === 'file') {
          closeFileTab(activeWorking.id)
        } else {
          void (async () => {
            const btabs = await window.electron.browser.getTabs()
            const active = btabs.find(t => t.isActive)
            if (active) await window.electron.browser.closeTab(active.id)
          })()
        }
      } else {
        closeTab(activeTabId)
      }
    },
    tabs,
    activeTabId,
    setActiveTabId,
    toggleFilesColumn: () => setFilesCollapsed(prev => !prev),
    // ⌘` — cycle focus between the terminal column and the working pane.
    // Files column is a toggle with ⌘B and intentionally not in this cycle.
    // Also moves actual DOM focus: clicks move it naturally, but the
    // keybinding has to drive it explicitly or keystrokes stay in the
    // previously-focused element.
    togglePaneFocus: () => {
      setFocusedColumn(prev => {
        const next = prev === 'working' ? 'terminal' : 'working'
        // Run the focus move after state commits so the pane is ready.
        queueMicrotask(() => {
          if (next === 'terminal') {
            const textarea = document.querySelector<HTMLTextAreaElement>(
              '.xterm-host:not([style*="display: none"]) .xterm-helper-textarea'
            )
            textarea?.focus()
          } else if (activeWorking.kind === 'browser') {
            window.electron.browser.focusActive()
          } else {
            // File tab — focus its scrollable region so keyboard scroll works.
            document.querySelector<HTMLElement>('[data-duo-workingpane]')?.focus()
          }
        })
        return next
      })
    }
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      {/* Top chrome row. Empty by design so the entire 40px strip is a
          window-drag region. Don't nest child divs here \u2014
          `-webkit-app-region: drag` does not pierce opaque children, so any
          child shrinks the usable drag surface (issue #17). macOS traffic
          lights are positioned over this row by `trafficLightPosition`
          without a DOM spacer. */}
      <div className="h-10 shrink-0 bg-surface-1 border-b border-border titlebar-drag" />

      <div className="flex flex-1 overflow-hidden">
        <div
          className="h-full shrink-0"
          onMouseDown={() => setFocusedColumn('files')}
          aria-label="Files column"
        >
          <FilesPane
            collapsed={filesCollapsed}
            focused={focusedColumn === 'files'}
            home={home}
            state={nav.state}
            actions={nav.actions}
            onOpenFile={onOpenFile}
            onOpenTerminalHere={openTerminalHere}
            revealChip={revealChip}
            onDismissRevealChip={() => setRevealChip(null)}
          />
        </div>

        <div
          ref={splitContainerRef}
          className="flex flex-1 overflow-hidden"
        >
          <div
            className={[
              'flex flex-col h-full border-r transition-colors',
              focusedColumn === 'terminal' ? 'border-accent/60' : 'border-border'
            ].join(' ')}
            style={{ width: `${splitPct}%` }}
            onMouseDown={() => setFocusedColumn('terminal')}
            aria-label="Terminal column"
          >
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onNew={newTab}
              onClose={closeTab}
              pendingCwd={pendingCwd}
            />
            <div className="flex-1 overflow-hidden">
              <TerminalPane
                tabs={tabs}
                activeTabId={activeTabId}
                onTitleChange={updateTabTitle}
                cozyByTab={cozyByTab}
                cozyDefault={cozyDefault}
              />
            </div>
          </div>

          <div
            className="split-divider"
            onMouseDown={onDividerMouseDown}
          />

          <div
            className={[
              'flex-1 overflow-hidden border-l transition-colors',
              focusedColumn === 'working' ? 'border-accent/60' : 'border-transparent'
            ].join(' ')}
            onMouseDown={() => setFocusedColumn('working')}
            aria-label="Working pane"
          >
            <WorkingPane
              fileTabs={fileTabs}
              activeWorking={activeWorking}
              setActiveWorking={setActiveWorking}
              closeFileTab={closeFileTab}
              onOpenMarkdown={onOpenMarkdown}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
