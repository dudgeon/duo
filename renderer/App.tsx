import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { WorkingPane } from './components/WorkingPane'
import { FilesPane } from './components/FilesPane'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { TabSession } from '@shared/types'

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
  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab(home)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)

  // Middle ↔ right split (terminal vs working pane). Files column is
  // fixed-width for Phase 2; resize handle arrives in Phase 4.
  const [splitPct, setSplitPct] = useState(55)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // Stage 10 § D1/D5 — files column visibility (manual + auto).
  const [filesCollapsed, setFilesCollapsed] = useState(false)
  // Track auto-collapse so manual expand after a narrow-window collapse
  // doesn't get stomped the moment ResizeObserver fires.
  const lastAutoCollapseState = useRef(false)

  // Stage 10 § D31 — focus tracking across columns.
  const [focusedColumn, setFocusedColumn] = useState<FocusedColumn>('terminal')

  // ── Tab actions ────────────────────────────────────────────────────────────

  const newTab = useCallback(() => {
    const tab = makeTab(home)
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [home])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length === 1) return prev // keep at least one
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
      // Only drive auto-collapse transitions — don't override manual expand.
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
    // Stage 10 § D29 — ⌘W is focus-aware. Terminal column closes its tab;
    // working column closes the active browser tab. Files column does nothing
    // (navigator tree isn't tabbed — the nav has a collapse, not a close).
    closeTab: () => {
      if (focusedColumn === 'working') {
        // Close active browser tab via the existing IPC. The browser manager
        // refuses to close the last tab, so we don't need to guard here.
        void (async () => {
          const tabs = await window.electron.browser.getTabs()
          const active = tabs.find(t => t.isActive)
          if (active) await window.electron.browser.closeTab(active.id)
        })()
      } else {
        closeTab(activeTabId)
      }
    },
    tabs,
    activeTabId,
    setActiveTabId,
    // Stage 10 § D5 — ⌘B toggles Files column.
    toggleFilesColumn: () => setFilesCollapsed(prev => !prev)
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface-0">
      {/* macOS traffic-light row — a top chrome band so the red/yellow/green
          buttons have space and the three-column workspace starts below. */}
      <div className="h-10 shrink-0 bg-surface-1 border-b border-border titlebar-drag flex items-center">
        <div className="w-20 shrink-0" />
        <div className="flex-1" />
      </div>

      {/* Three-column workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Files (left) */}
        <div
          className="h-full shrink-0"
          onMouseDown={() => setFocusedColumn('files')}
          aria-label="Files column"
        >
          <FilesPane collapsed={filesCollapsed} focused={focusedColumn === 'files'} />
        </div>

        {/* Middle (terminal + tab bar; agent-tools slot reserved but empty) */}
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
            />
            <div className="flex-1 overflow-hidden">
              <TerminalPane
                tabs={tabs}
                activeTabId={activeTabId}
                onTitleChange={updateTabTitle}
              />
            </div>
            {/* Stage 12 agent-tools dock (placeholder) — collapsed to nothing
                until that stage ships. The div is present so the layout
                preserves its spot. */}
          </div>

          <div
            className="split-divider"
            onMouseDown={onDividerMouseDown}
          />

          {/* Working pane (right) — polymorphic shell with unified tab strip.
              Browser is the only tab type in Phase 3; editor / preview arrive
              in Phase 5. */}
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
