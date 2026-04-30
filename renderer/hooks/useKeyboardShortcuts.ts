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

import { useEffect, useRef } from 'react'
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
  // BUG-021 fix — tab cycle handlers (⌃Tab / ⌃⇧Tab) need to see the
  // CURRENT tabs at keystroke time, not whatever was captured by the
  // useEffect closure. After Stage 21c Phase 2 (session restore on
  // relaunch) replaces `opts.tabs` with the rehydrated list, there's
  // a window where the old useEffect closure can still be live (the
  // re-run is scheduled but not yet executed). Pulling tabs +
  // activeTabId through refs eliminates the stale-closure path
  // entirely — the dispatch reads `tabsRef.current` at the moment
  // the keystroke fires.
  const tabsRef = useRef<TabSession[]>(opts.tabs)
  const activeTabIdRef = useRef<string>(opts.activeTabId)
  tabsRef.current = opts.tabs
  activeTabIdRef.current = opts.activeTabId

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
          // BUG-036 (v0.5.3) — pane-aware ⌘T. From terminal focus,
          // open a new vanilla shell tab in the front terminal's
          // launch CWD (newShellTab uses pendingCwd, which the
          // active-terminal-switch effect syncs to the active tab).
          // From any other focus (browser / files / editor /
          // canvas), keep Chrome-parity behavior: new browser tab.
          // Reverts the BUG-008 spec ("⌘T everywhere → browser
          // tab") in favor of the discovery affordance — the `>`
          // and `+` buttons on the strip teach the explicit kinds
          // for users who want them, but ⌘T from a terminal goes
          // where muscle memory expects.
          if (pane === 'terminal') {
            opts.newShellTab()
            return
          }
          opts.newBrowserTab()
          return
        case 'newClaudeTab':
          // BUG-027 — ⌘⇧T from browser focus reopens the last-closed
          // browser tab (Chrome parity).
          // BUG-036 (v0.5.3) — from terminal focus, ⌘⇧T spawns a
          // claude tab in the front terminal's launch CWD (this
          // already worked because newClaudeTab uses pendingCwd;
          // the comment is here to anchor the spec).
          // From any other focus, ⌘⇧T → new claude tab.
          if (pane === 'working') {
            void window.electron.browser.reopenLastClosed()
            return
          }
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
            // BUG-021 fix — read from ref (always latest) so post-
            // session-restore tab IDs are visible.
            const tabs = tabsRef.current
            const idx = arg - 1
            if (idx >= 0 && idx < tabs.length) {
              opts.setActiveTabId(tabs[idx].id)
            }
          }
          return
        }
        case 'prevTerminalTab': {
          const tabs = tabsRef.current
          if (tabs.length === 0) return
          const idx = tabs.findIndex(t => t.id === activeTabIdRef.current)
          const prev = tabs[(idx - 1 + tabs.length) % tabs.length]
          opts.setActiveTabId(prev.id)
          return
        }
        case 'nextTerminalTab': {
          const tabs = tabsRef.current
          if (tabs.length === 0) return
          const idx = tabs.findIndex(t => t.id === activeTabIdRef.current)
          const next = tabs[(idx + 1) % tabs.length]
          opts.setActiveTabId(next.id)
          return
        }
        case 'cycleTabsForward':
        case 'cycleTabsBackward': {
          const delta = id === 'cycleTabsBackward' ? -1 : 1
          // BUG-021 fix — read tabs from ref so the cycle always
          // sees post-session-restore state. The closure itself
          // re-binds when opts.tabs changes (via deps) but the ref
          // is belt+braces against any timing windows where the
          // closure is stale.
          const tabs = tabsRef.current
          if (pane === 'terminal' && tabs.length > 0) {
            const idx = tabs.findIndex(t => t.id === activeTabIdRef.current)
            const next = tabs[(idx + delta + tabs.length) % tabs.length]
            opts.setActiveTabId(next.id)
          } else {
            void (async () => {
              // Browser side: getTabs() is an IPC call, so it
              // always returns BrowserManager's CURRENT state
              // (no closure issue). But add a small fallback log
              // when the cycle yields a no-op so user repros land
              // a useful breadcrumb.
              const btabs = await window.electron.browser.getTabs()
              if (btabs.length === 0) {
                console.warn('[shortcuts] cycleTabs: browser has zero tabs — nothing to cycle')
                return
              }
              const activeIdx = btabs.findIndex(t => t.isActive)
              if (activeIdx < 0) {
                // No active tab found — switch to the first one
                // anyway so the cycle progresses rather than
                // silently no-oping.
                console.warn('[shortcuts] cycleTabs: no active browser tab found; defaulting to index 0')
                await window.electron.browser.switchTab(btabs[0].id)
                return
              }
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
