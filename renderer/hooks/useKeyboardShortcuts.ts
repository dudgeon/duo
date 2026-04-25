import { useEffect } from 'react'
import type { TabSession } from '@shared/types'

interface Options {
  newTerminalTab: () => void
  newBrowserTab: () => void
  newMarkdownFile?: () => void
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
  // BUG-001 fix — which column has user focus. Routes ⌃Tab to terminal
  // tabs when the terminal is focused, browser tabs otherwise. Without
  // this, ⌃Tab from terminal focus cycles browser tabs (Chromium-default
  // behaviour leaks across panes).
  activePaneFocus?: 'files' | 'terminal' | 'working'
}

export function useKeyboardShortcuts({
  newTerminalTab,
  newBrowserTab,
  newMarkdownFile,
  closeTab,
  tabs,
  activeTabId,
  setActiveTabId,
  toggleFilesColumn,
  togglePaneFocus,
  adjustTerminalFontBump,
  activePaneFocus
}: Options) {
  useEffect(() => {
    // Dispatch via a single `process(e)` function so both native window
    // keydowns and shortcuts forwarded from the browser WebContentsView
    // can reuse the same routing logic. `paneOverride` is set when a
    // keystroke arrived from `onBrowserKey` — in that case we KNOW the
    // browser WebContentsView has keyboard focus regardless of what the
    // renderer's `focusedColumn` state says. Without this, clicks into
    // the browser content (which the WebContentsView swallows before
    // the wrapper's onMouseDown fires) leave `focusedColumn` stuck on
    // its last value, mis-routing ⌃Tab.
    const process = (
      e: { metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; key: string; preventDefault: () => void },
      paneOverride?: 'files' | 'terminal' | 'working'
    ) => {
      const meta = e.metaKey
      const key = e.key.toLowerCase()
      const pane = paneOverride ?? activePaneFocus

      // ⌘T — pane-aware new tab. From terminal focus → new terminal
      // tab (matches the natural "new tab in this column" expectation).
      // From everywhere else → new browser tab (Chrome parity, same as
      // the original Stage 11 D33e behaviour). ⌘⇧T below stays the
      // explicit "new terminal tab" shortcut for compatibility.
      // (Stage 19c will eventually take this further by defaulting
      // terminal-focus ⌘T to launching a primed claude session
      // directly; for now we keep it as a vanilla shell tab.)
      if (meta && !e.shiftKey && key === 't') {
        e.preventDefault()
        if (pane === 'terminal') {
          newTerminalTab()
        } else {
          newBrowserTab()
        }
        return
      }

      // ⌘N — new markdown file (Stage 11 § D33a)
      if (meta && !e.shiftKey && key === 'n') {
        if (newMarkdownFile) {
          e.preventDefault()
          newMarkdownFile()
        }
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

      // ⌘B — toggle the Files column (Stage 10 § D5). Skip if focus is in
      // a contenteditable (the markdown editor), where ⌘B means "bold" and
      // the user does not expect the files column to move. The collapsed
      // rail is click-to-expand as a universal escape hatch.
      if (meta && !e.shiftKey && key === 'b') {
        const active = document.activeElement as HTMLElement | null
        const inEditable = !!active && (
          active.isContentEditable ||
          active.closest('[contenteditable="true"]') !== null
        )
        if (toggleFilesColumn && !inEditable) {
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

      // ⌃Tab / ⌃⇧Tab — pane-aware tab cycling. When the terminal column
      // has focus, cycle terminal tabs (BUG-001 fix; matches ⌘⇧] / ⌘⇧[).
      // Otherwise (working pane, files pane, or unknown) cycle browser
      // tabs to preserve Chrome-parity for the most common case.
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        const delta = e.shiftKey ? -1 : 1
        if (pane === 'terminal' && tabs.length > 0) {
          const idx = tabs.findIndex(t => t.id === activeTabId)
          const next = tabs[(idx + delta + tabs.length) % tabs.length]
          setActiveTabId(next.id)
        } else {
          void (async () => {
            const btabs = await window.electron.browser.getTabs()
            if (btabs.length === 0) return
            const activeIdx = btabs.findIndex(t => t.isActive)
            const nextIdx = (activeIdx + delta + btabs.length) % btabs.length
            await window.electron.browser.switchTab(btabs[nextIdx].id)
          })()
        }
        return
      }
    }

    const windowHandler = (e: KeyboardEvent) => process(e)
    window.addEventListener('keydown', windowHandler)

    // When the browser WebContentsView has focus, Chromium swallows
    // keystrokes before the window listener can see them. BrowserManager
    // intercepts the Duo shortcuts and forwards them here. We pass
    // 'working' as paneOverride because the browser pane having keyboard
    // focus is the proximate cause of the forward — the renderer's
    // cached focusedColumn may be stale (WebContentsView clicks don't
    // bubble to the wrapper's onMouseDown).
    const unsubscribeBrowserKey = window.electron.keyboard?.onBrowserKey((e) => {
      process({
        metaKey: e.meta,
        shiftKey: e.shift,
        ctrlKey: e.ctrl,
        altKey: e.alt,
        key: e.key,
        preventDefault: () => { /* already prevented in main */ }
      }, 'working')
    })

    return () => {
      window.removeEventListener('keydown', windowHandler)
      unsubscribeBrowserKey?.()
    }
  }, [newTerminalTab, newBrowserTab, closeTab, tabs, activeTabId, setActiveTabId, toggleFilesColumn, togglePaneFocus, activePaneFocus])
}
