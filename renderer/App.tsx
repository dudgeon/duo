import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import { FilesPane } from './components/FilesPane'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useNavigator, computePendingCwd } from './hooks/useNavigator'
import type { TabSession, DirEntry } from '@shared/types'

// Stage 10 § D32: auto-collapse the Files column on windows narrower than
// this. The user can manually re-expand; we don't re-collapse again unless
// the threshold is re-crossed (hysteresis prevents jitter).
const AUTO_COLLAPSE_WIDTH = 1100

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

  const activeTab = tabs.find(t => t.id === activeTabId)

  // ── Tab actions ────────────────────────────────────────────────────────────

  // Stage 10 § D9: new terminal tabs launch in `pendingCwd`, which is the
  // navigator's current folder (or the selected file's parent).
  const newTab = useCallback(() => {
    const tab = makeTab(pendingCwd)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [pendingCwd])

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

  // Stage 10 § D1: follow-mode — unless the navigator is pinned, moving
  // between terminal tabs updates the navigator's cwd to that tab's launch
  // CWD. This is the "context drawer" behavior.
  useEffect(() => {
    if (nav.state.pinned || !activeTab) return
    if (nav.state.cwd === activeTab.cwd) return
    nav.setCwd(activeTab.cwd)
  }, [activeTab, nav])

  // ── File-open from the navigator ───────────────────────────────────────────

  const onOpenFile = useCallback(async (entry: DirEntry) => {
    // Phase 4 MVP: route only through the browser's `open` command, which
    // creates a new WorkingPane tab. Phase 5 adds per-type renderers so
    // `.md` opens as preview in-renderer, etc. For now we just load the
    // file:// URL in a browser tab — it renders fine for images and PDFs,
    // a plain text dump for text, and a "can't display" for unknowns. Not
    // the final experience but proves the path.
    await window.electron.browser.addTab(`file://${encodeURI(entry.path)}`)
    setFocusedColumn('working')
  }, [])

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
        void (async () => {
          const btabs = await window.electron.browser.getTabs()
          const active = btabs.find(t => t.isActive)
          if (active) await window.electron.browser.closeTab(active.id)
        })()
      } else {
        closeTab(activeTabId)
      }
    },
    tabs,
    activeTabId,
    setActiveTabId,
    toggleFilesColumn: () => setFilesCollapsed(prev => !prev)
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      <div className="h-10 shrink-0 bg-surface-1 border-b border-border titlebar-drag flex items-center">
        <div className="w-20 shrink-0" />
        <div className="flex-1" />
      </div>

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
            <WorkingPane />
          </div>
        </div>
      </div>
    </div>
  )
}
