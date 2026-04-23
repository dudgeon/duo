import { useEffect } from 'react'
import type { TabSession } from '@shared/types'

interface Options {
  newTab: () => void
  closeTab: () => void
  tabs: TabSession[]
  activeTabId: string
  setActiveTabId: (id: string) => void
}

export function useKeyboardShortcuts({ newTab, closeTab, tabs, activeTabId, setActiveTabId }: Options) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey // ⌘ on macOS

      // ⌘T — new tab
      if (meta && e.key === 't') {
        e.preventDefault()
        newTab()
        return
      }

      // ⌘L — focus the address bar (Chrome parity)
      if (meta && e.key === 'l') {
        const el = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
        if (el) {
          e.preventDefault()
          el.focus()
          el.select()
        }
        return
      }

      // ⌘W — close active tab
      if (meta && e.key === 'w') {
        e.preventDefault()
        closeTab()
        return
      }

      // ⌘1–⌘9 — jump to tab N
      if (meta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key, 10) - 1
        if (idx < tabs.length) setActiveTabId(tabs[idx].id)
        return
      }

      // ⌘⇧[ — previous tab
      if (meta && e.shiftKey && e.key === '[') {
        e.preventDefault()
        const idx = tabs.findIndex(t => t.id === activeTabId)
        const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
        setActiveTabId(prev.id)
        return
      }

      // ⌘⇧] — next tab
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
  }, [newTab, closeTab, tabs, activeTabId, setActiveTabId])
}
