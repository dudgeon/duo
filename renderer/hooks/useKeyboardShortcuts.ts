import { useEffect } from 'react'
import type { TabSession } from '@shared/types'

interface Options {
  newTerminalTab: () => void
  newBrowserTab: () => void
  closeTab: () => void
  tabs: TabSession[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  // Stage 10 § D5 — ⌘B collapses/expands the Files column.
  toggleFilesColumn?: () => void
}

export function useKeyboardShortcuts({
  newTerminalTab,
  newBrowserTab,
  closeTab,
  tabs,
  activeTabId,
  setActiveTabId,
  toggleFilesColumn
}: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey // ⌘ on macOS
      const key = e.key.toLowerCase()

      // ⌘T — new browser tab (Chrome parity)
      if (meta && !e.shiftKey && key === 't') {
        e.preventDefault()
        newBrowserTab()
        return
      }

      // ⌘⇧T — new terminal tab
      if (meta && e.shiftKey && key === 't') {
        e.preventDefault()
        newTerminalTab()
        return
      }

      // ⌘L — focus the address bar (Chrome parity)
      if (meta && key === 'l') {
        const el = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
        if (el) {
          e.preventDefault()
          el.focus()
          el.select()
        }
        return
      }

      // ⌘B — toggle the Files column (Stage 10 § D5)
      if (meta && !e.shiftKey && key === 'b') {
        if (toggleFilesColumn) {
          e.preventDefault()
          toggleFilesColumn()
        }
        return
      }

      // ⌘W — close active tab. Focus-aware routing lives in the handler passed
      // from App.tsx (Stage 10 § D29).
      if (meta && key === 'w') {
        e.preventDefault()
        closeTab()
        return
      }

      // ⌘⇧1–⌘⇧9 — jump to working-pane (right-column) tab N (Stage 10 § D30)
      if (meta && e.shiftKey && key >= '1' && key <= '9') {
        e.preventDefault()
        const n = parseInt(key, 10)
        void window.electron.browser.switchTab(n)
        return
      }

      // ⌘1–⌘9 — jump to terminal tab N
      if (meta && !e.shiftKey && key >= '1' && key <= '9') {
        e.preventDefault()
        const idx = parseInt(key, 10) - 1
        if (idx < tabs.length) setActiveTabId(tabs[idx].id)
        return
      }

      // ⌘⇧[ — previous terminal tab
      if (meta && e.shiftKey && e.key === '[') {
        e.preventDefault()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
        setActiveTabId(prev.id)
        return
      }

      // ⌘⇧] — next terminal tab
      if (meta && e.shiftKey && e.key === ']') {
        e.preventDefault()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        const next = tabs[(idx + 1) % tabs.length]
        setActiveTabId(next.id)
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [newTerminalTab, newBrowserTab, closeTab, tabs, activeTabId, setActiveTabId, toggleFilesColumn])
}
