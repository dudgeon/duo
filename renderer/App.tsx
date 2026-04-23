import { useState, useCallback, useRef, useEffect } from 'react'
import { TabBar } from './components/TabBar'
import { TerminalPane } from './components/TerminalPane'
import { BrowserPane } from './components/BrowserPane'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { TabSession } from '@shared/types'

function makeTab(): TabSession {
  return {
    id: crypto.randomUUID(),
    title: 'Terminal',
    cwd: window.electron.env.HOME || '~'
  }
}

export function App() {
  const [tabs, setTabs] = useState<TabSession[]>(() => [makeTab()])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [splitPct, setSplitPct] = useState(55)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  // ── Tab actions ────────────────────────────────────────────────────────────

  const newTab = useCallback(() => {
    const tab = makeTab()
    setTabs(prev => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

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

  // ── Split-pane resize ──────────────────────────────────────────────────────

  const onDividerMouseDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const { left, width } = containerRef.current.getBoundingClientRect()
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

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useKeyboardShortcuts({
    newTerminalTab: newTab,
    newBrowserTab: () => { window.electron.browser.addTab() },
    closeTab: () => closeTab(activeTabId),
    tabs,
    activeTabId,
    setActiveTabId
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* macOS traffic-light spacer + tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onNew={newTab}
        onClose={closeTab}
      />

      {/* Main split layout */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        <div style={{ width: `${splitPct}%` }} className="overflow-hidden">
          <TerminalPane
            tabs={tabs}
            activeTabId={activeTabId}
            onTitleChange={updateTabTitle}
          />
        </div>

        <div
          className="split-divider"
          onMouseDown={onDividerMouseDown}
        />

        <div className="flex-1 overflow-hidden">
          <BrowserPane />
        </div>
      </div>
    </div>
  )
}
