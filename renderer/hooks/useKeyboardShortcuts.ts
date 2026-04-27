// Capture-phase, matcher-driven global keyboard shortcut hook.
//
// Replaces the prior bubble-phase listener that relied on each new
// surface (xterm, iframe, TipTap, WebContentsView) wiring its own
// escape mechanism. The chronic regression family that produced
// (BUG-001, BUG-008, BUG-012/013/014) all came from new panes
// shipping with the global shortcuts dead by default.
//
// Now: a single `document` capture-phase listener fires before any
// focused element's bubble handlers. The matcher in
// `keyboard/globalShortcuts.ts` owns the entire shortcut vocabulary;
// this hook just dispatches matched IDs to App-supplied callbacks.
// Iframe surfaces (canvas) install a forwarder that synthesizes a
// keystroke at the parent so the same capture listener catches it.
// xterm + WebContentsView consult the same matcher and yield when a
// match is positive.

import { useEffect } from 'react'
import type { TabSession } from '@shared/types'
import {
  matchGlobalShortcut,
  isInEditableSurface,
  type ShortcutId
} from '../keyboard/globalShortcuts'

interface Options {
  // Action callbacks. App.tsx owns the actual side effects (tab
  // spawn, font bump, focus shift); this hook just decides which
  // callback to fire for which matched shortcut.
  newClaudeTab: () => void
  newShellTab: () => void
  newBrowserTab: () => void
  newMarkdownFile?: () => void
  closeTab: () => void
  tabs: TabSession[]
  activeTabId: string
  setActiveTabId: (id: string) => void
  toggleFilesColumn?: () => void
  togglePaneFocus?: () => void
  adjustTerminalFontBump?: (delta: number | 'reset') => void
  // BUG-001 fix — pane-focus signal lets ⌃Tab / ⌃⇧Tab cycle terminal
  // tabs when the terminal is focused, browser tabs otherwise.
  activePaneFocus?: 'files' | 'terminal' | 'working'
}

export function useKeyboardShortcuts(opts: Options) {
  useEffect(() => {
    // Build a single dispatcher that App.tsx callbacks resolve through.
    // `paneOverride` is set when the keystroke arrived from the
    // browser-pane forwarder (Chromium swallows window keydowns when the
    // WebContentsView has focus); the override carries the implied
    // focus so ⌃Tab routes to browser tabs even when the renderer's
    // cached `focusedColumn` is stale.
    const dispatch = (id: ShortcutId, arg: number | undefined, paneOverride?: 'files' | 'terminal' | 'working') => {
      const pane = paneOverride ?? opts.activePaneFocus
      switch (id) {
        case 'newBrowserTab':
          opts.newBrowserTab()
          return
        case 'newClaudeTab':
          opts.newClaudeTab()
          return
        case 'newMarkdownFile':
          opts.newMarkdownFile?.()
          return
        case 'closeTab':
          opts.closeTab()
          return
        case 'focusAddressBar': {
          const el = document.querySelector<HTMLInputElement>('[data-duo-addressbar]')
          el?.focus()
          el?.select()
          return
        }
        case 'toggleFilesColumn':
          opts.toggleFilesColumn?.()
          return
        case 'togglePaneFocus':
          opts.togglePaneFocus?.()
          return
        case 'fontBumpUp':
          opts.adjustTerminalFontBump?.(1)
          return
        case 'fontBumpDown':
          opts.adjustTerminalFontBump?.(-1)
          return
        case 'fontBumpReset':
          opts.adjustTerminalFontBump?.('reset')
          return
        case 'jumpWorkingTab': {
          if (typeof arg === 'number') {
            void window.electron.browser.switchTab(arg)
          }
          return
        }
        case 'jumpTerminalTab': {
          if (typeof arg === 'number') {
            const idx = arg - 1
            if (idx >= 0 && idx < opts.tabs.length) {
              opts.setActiveTabId(opts.tabs[idx].id)
            }
          }
          return
        }
        case 'prevTerminalTab': {
          const idx = opts.tabs.findIndex(t => t.id === opts.activeTabId)
          if (opts.tabs.length === 0) return
          const prev = opts.tabs[(idx - 1 + opts.tabs.length) % opts.tabs.length]
          opts.setActiveTabId(prev.id)
          return
        }
        case 'nextTerminalTab': {
          const idx = opts.tabs.findIndex(t => t.id === opts.activeTabId)
          if (opts.tabs.length === 0) return
          const next = opts.tabs[(idx + 1) % opts.tabs.length]
          opts.setActiveTabId(next.id)
          return
        }
        case 'cycleTabsForward':
        case 'cycleTabsBackward': {
          const delta = id === 'cycleTabsBackward' ? -1 : 1
          if (pane === 'terminal' && opts.tabs.length > 0) {
            const idx = opts.tabs.findIndex(t => t.id === opts.activeTabId)
            const next = opts.tabs[(idx + delta + opts.tabs.length) % opts.tabs.length]
            opts.setActiveTabId(next.id)
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
    }

    // Capture-phase listener on `document` — fires BEFORE any focused
    // surface's bubble-phase handlers. TipTap, app-level controls, and
    // the canvas-iframe forwarder (which synthesizes events here) all
    // route through this single point.
    const documentHandler = (e: KeyboardEvent) => {
      const ctx = { inEditableSurface: isInEditableSurface(document) }
      const match = matchGlobalShortcut(e, ctx)
      if (!match) return
      e.preventDefault()
      e.stopPropagation()
      dispatch(match.id, match.arg)
    }
    document.addEventListener('keydown', documentHandler, true)

    // Browser pane forwarder. The WebContentsView swallows window
    // keydowns before any renderer listener runs, so main-process
    // intercepts them and forwards via IPC. We re-build a synthetic
    // KeyboardEvent here so the matcher's contract stays the same.
    // 'working' pane override because the browser pane having keyboard
    // focus is the proximate cause of the forward.
    const unsubscribeBrowserKey = window.electron.keyboard?.onBrowserKey((forward) => {
      const synthetic = new KeyboardEvent('keydown', {
        key: forward.key,
        ctrlKey: forward.ctrl,
        metaKey: forward.meta,
        shiftKey: forward.shift,
        altKey: forward.alt
      })
      const ctx = { inEditableSurface: false } // browser is not editable surface for our purposes
      const match = matchGlobalShortcut(synthetic, ctx)
      if (match) dispatch(match.id, match.arg, 'working')
    })

    return () => {
      document.removeEventListener('keydown', documentHandler, true)
      unsubscribeBrowserKey?.()
    }
  }, [
    opts.newClaudeTab,
    opts.newShellTab,
    opts.newBrowserTab,
    opts.newMarkdownFile,
    opts.closeTab,
    opts.tabs,
    opts.activeTabId,
    opts.setActiveTabId,
    opts.toggleFilesColumn,
    opts.togglePaneFocus,
    opts.adjustTerminalFontBump,
    opts.activePaneFocus
  ])
}
