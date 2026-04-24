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
  // ⌘` — toggle focus between terminal and working pane.
  togglePaneFocus?: () => void
  // ⌘+ / ⌘- / ⌘0 — adjust the active terminal tab's font bump.
  adjustTerminalFontBump?: (delta: number | 'reset') => void
}

export function useKeyboardShortcuts({
  newTerminalTab,
  newBrowserTab,
  closeTab,
  tabs,
  activeTabId,
  setActiveTabId,
  toggleFilesColumn,
  togglePaneFocus,
  adjustTerminalFontBump
}: Options) {
  useEffect(() => {
    // Dispatch via a single `process(e)` function so both native window
    // keydowns and shortcuts forwarded from the browser WebContentsView
    // can reuse the same routing logic.
    const process = (e: { metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; key: string; preventDefault: () => void }) => {
      const meta = e.metaKey
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

      // ⌘` — cycle focus between terminal and working pane
      if (meta && !e.shiftKey && (key === '`' || e.key === '`')) {
        if (togglePaneFocus) {
          e.preventDefault()
          togglePaneFocus()
        }
        return
      }

      // ⌘= / ⌘+ / ⌘- / ⌘0 — terminal font-size bump. These match Chromium's
      // default zoom accelerators; preventDefault keeps them from colliding
      // with the main-window zoom lock (which would no-op anyway). Browser
      // WebContentsViews get their own copy of these keys and still zoom.
      if (meta && !e.shiftKey && (key === '=' || e.key === '=' || e.key === '+')) {
        if (adjustTerminalFontBump) {
          e.preventDefault()
          adjustTerminalFontBump(1)
        }
        return
      }
      if (meta && !e.shiftKey && (key === '-' || e.key === '-')) {
        if (adjustTerminalFontBump) {
          e.preventDefault()
          adjustTerminalFontBump(-1)
        }
        return
      }
      if (meta && !e.shiftKey && (key === '0' || e.key === '0')) {
        if (adjustTerminalFontBump) {
          e.preventDefault()
          adjustTerminalFontBump('reset')
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

      // ⌃Tab / ⌃⇧Tab — cycle working-pane (browser) tabs (Chrome parity).
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        void (async () => {
          const btabs = await window.electron.browser.getTabs()
          if (btabs.length === 0) return
          const activeIdx = btabs.findIndex(t => t.isActive)
          const delta = e.shiftKey ? -1 : 1
          const nextIdx = (activeIdx + delta + btabs.length) % btabs.length
          await window.electron.browser.switchTab(btabs[nextIdx].id)
        })()
        return
      }
    }

    const windowHandler = (e: KeyboardEvent) => process(e)
    window.addEventListener('keydown', windowHandler)

    // When the browser WebContentsView has focus, Chromium swallows
    // keystrokes before the window listener can see them. BrowserManager
    // intercepts the Duo shortcuts and forwards them here.
    const unsubscribeBrowserKey = window.electron.keyboard?.onBrowserKey((e) => {
      process({
        metaKey: e.meta,
        shiftKey: e.shift,
        ctrlKey: e.ctrl,
        altKey: e.alt,
        key: e.key,
        preventDefault: () => { /* already prevented in main */ }
      })
    })

    return () => {
      window.removeEventListener('keydown', windowHandler)
      unsubscribeBrowserKey?.()
    }
  }, [newTerminalTab, newBrowserTab, closeTab, tabs, activeTabId, setActiveTabId, toggleFilesColumn, togglePaneFocus])
}
