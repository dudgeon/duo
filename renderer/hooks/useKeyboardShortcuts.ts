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
import { cycleNext } from '../keyboard/tabCycle'

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
  /** FOLLOWUP-025 — ⌘⇧K opens the File → Clone… modal. Pure-UI
   *  complement to ENH-151's `duo clone` CLI. */
  openCloneModal?: () => void
  togglePaneFocus?: () => void
  adjustTerminalFontBump?: (delta: number | 'reset') => void
  /** Stage 26 PR 3 item 8 — flip the navigator breadcrumb into the
   *  editable input. Fired by ⌘⇧G ("Go to folder"). */
  focusBreadcrumbEdit?: () => void
  /** ENH-023 — find-in-document. App.tsx routes these to the active
   *  markdown editor's FindBar. ⌘F opens / re-focuses; ⌘G cycles to
   *  next match (works even with bar closed if there's a stored
   *  query); ⌘⇧F cycles to previous. */
  openFind?: () => void
  findNext?: () => void
  findPrev?: () => void
  /** Sprint 3 Phase 3b — Split View chord handlers. ⌘\ moves the
   *  active main tab into the aux slot; ⌘⇧\ promotes aux back to
   *  main (closes the split AND keeps the file open). For pure-close
   *  (discard the split entirely without promoting the aux file),
   *  use the ✕ button in the aux header. */
  splitViewToggle?: () => void
  splitViewPromote?: () => void
  /** ENH-098 (Sprint 9) — pane-jump chords. ⌘⌥L/;/' jump focus
   *  directly to terminal/main/aux respectively (vs. togglePaneFocus
   *  which CYCLES). focusAuxPane is a no-op when split view is
   *  closed; App.tsx may surface a toast hint there. */
  focusTerminalPane?: () => void
  focusMainPane?: () => void
  focusAuxPane?: () => void
  /** ENH-102 (Sprint 9) — ⌘⇧⌫ deletes the active working-pane file
   *  (move-to-trash + close tab + confirm dialog). Working-pane file
   *  tabs only; no-op when active surface is a browser tab or
   *  terminal. */
  deleteCurrentFile?: () => void
  /** Sprint 11 ENH-096 B.4 — ⌘O opens the VaultQuickSwitcher overlay
   *  (fuzzy search across all files in the vault root, distinct from
   *  ⌘⇧A which is open-tabs only). When the active path isn't inside
   *  a vault, the overlay still opens but renders an empty-state
   *  hint pointing at the vault requirement. */
  openVaultQuickSwitcher?: () => void
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
  // BUG-038 (4th instance) — same closure-staleness story as BUG-021,
  // applied to `activePaneFocus`. The dispatcher used to read the focus
  // value off the useEffect closure, which `opts.activePaneFocus`
  // populates via the deps array. But there's a window where:
  //   1. User clicks into a terminal tab → React schedules a state
  //      update for `focusedColumn`.
  //   2. Before React re-runs the useEffect (and rebinds the
  //      dispatcher closure), the user presses ⌃Tab.
  //   3. The capture-phase keydown fires, but `pane` is still the
  //      previous value (often `'working'` from a prior browser /
  //      canvas click), so the cycle takes the BROWSER branch instead
  //      of the terminal branch, leaving most terminal tabs
  //      unreachable.
  // Ref ensures the dispatcher always sees the latest pane focus at
  // keystroke time, no matter where useEffect's render loop is.
  const activePaneRef = useRef<'files' | 'terminal' | 'working' | undefined>(opts.activePaneFocus)
  tabsRef.current = opts.tabs
  activeTabIdRef.current = opts.activeTabId
  activePaneRef.current = opts.activePaneFocus

  useEffect(() => {
    // Build a single dispatcher that App.tsx callbacks resolve through.
    // `paneOverride` is set when the keystroke arrived from the
    // browser-pane forwarder (Chromium swallows window keydowns when the
    // WebContentsView has focus); the override carries the implied
    // focus so ⌃Tab routes to browser tabs even when the renderer's
    // cached `focusedColumn` is stale.
    const dispatch = (id: ShortcutId, arg: number | undefined, paneOverride?: 'files' | 'terminal' | 'working') => {
      // BUG-038 (4th instance) fix — read pane from a ref so the
      // dispatcher always sees the CURRENT focus state, not the
      // useEffect-closure snapshot. paneOverride still wins for the
      // browser-pane forwarder path (Chromium-swallowed keydowns).
      const pane = paneOverride ?? activePaneRef.current
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
        case 'focusBreadcrumbEdit':
          opts.focusBreadcrumbEdit?.()
          return
        case 'openFind':
          opts.openFind?.()
          return
        case 'findNext':
          opts.findNext?.()
          return
        case 'findPrev':
          opts.findPrev?.()
          return
        case 'sendToDuo': {
          // Stage 15.3 — ⌘D dispatches a CustomEvent that each
          // editor / canvas / browser-pane surface listens for and
          // routes to its own Send → Duo handler. Same indirection
          // pattern as duo-cycle-working-tab and duo-tree-start-rename:
          // keeps the global hook free of surface-specific state.
          window.dispatchEvent(new CustomEvent('duo-send-to-duo', { detail: { pane } }))
          return
        }
        case 'startComment': {
          // Sprint 6 BUG-081 — ⌘⌥M dispatches a CustomEvent the active
          // editing surface listens for. Mirrors the sendToDuo pattern
          // — surface-side handler decides whether to act based on
          // local selection state (no-op when there's no selection or
          // no anchor). Canvas listens today; markdown editor wires
          // the same listener in Phase 4 / MISSING-001.
          window.dispatchEvent(new CustomEvent('duo-start-comment', { detail: { pane } }))
          return
        }
        case 'reloadBrowserTab': {
          // Sprint 6 BUG-084 — ⌘R reloads the active browser tab when
          // the working pane has a browser tab focused; otherwise
          // no-op (keeps editor / canvas / terminal panes intact).
          // Same CustomEvent indirection as sendToDuo — App.tsx
          // listens, checks `activeWorking.kind === 'browser'`, and
          // calls window.electron.browser.reload() if so.
          window.dispatchEvent(new CustomEvent('duo-reload-active-browser', { detail: { pane } }))
          return
        }
        case 'viewSource': {
          // ENH-117 — ⌘⌥V opens the read-only "view source" overlay.
          // Both MarkdownEditor + PageTab listen for this event;
          // each gates on isActive so only the visible surface
          // responds. Same pane-aware indirection as sendToDuo /
          // startComment.
          window.dispatchEvent(new CustomEvent('duo-view-source', { detail: { pane } }))
          return
        }
        case 'toggleFilesColumn':
          opts.toggleFilesColumn?.()
          return
        case 'openCloneModal':
          // FOLLOWUP-025 — File → Clone… modal trigger.
          opts.openCloneModal?.()
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
          const nextId = cycleNext(tabsRef.current, activeTabIdRef.current, -1)
          if (nextId) opts.setActiveTabId(nextId)
          return
        }
        case 'nextTerminalTab': {
          const nextId = cycleNext(tabsRef.current, activeTabIdRef.current, 1)
          if (nextId) opts.setActiveTabId(nextId)
          return
        }
        case 'splitViewToggle':
          opts.splitViewToggle?.()
          return
        case 'splitViewPromote':
          opts.splitViewPromote?.()
          return
        case 'openTabSearchPalette':
          // ENH-080 — fire a window CustomEvent that App.tsx listens
          // for. Same indirection as sendToDuo and startComment so
          // this hook stays free of palette state.
          window.dispatchEvent(new CustomEvent('duo-open-tab-search'))
          return
        case 'focusTerminalPane':
          opts.focusTerminalPane?.()
          return
        case 'focusMainPane':
          opts.focusMainPane?.()
          return
        case 'focusAuxPane':
          opts.focusAuxPane?.()
          return
        case 'deleteCurrentFile':
          opts.deleteCurrentFile?.()
          return
        case 'vaultQuickSwitcher':
          opts.openVaultQuickSwitcher?.()
          return
        case 'cycleTabsForward':
        case 'cycleTabsBackward': {
          const delta = (id === 'cycleTabsBackward' ? -1 : 1) as 1 | -1
          console.debug('[BUG-079]', Date.now(), 'shortcut entry', { id, delta, pane })
          // BUG-021 + BUG-038 v3 — read both tabs and activePaneFocus
          // from refs so the cycle sees CURRENT state at keystroke
          // time, not a useEffect-closure snapshot. cycleNext is a
          // pure helper that handles wrap-around and -1-idx fallback
          // consistently.
          const tabs = tabsRef.current
          if (pane === 'terminal' && tabs.length > 0) {
            const nextId = cycleNext(tabs, activeTabIdRef.current, delta)
            console.debug('[BUG-079]', Date.now(), 'terminal cycle setActiveTabId', { nextId })
            if (nextId) opts.setActiveTabId(nextId)
          } else {
            // BUG-038 v4 — when pane is 'working' (or anything
            // non-terminal), cycle the WHOLE working-pane strip,
            // not just BrowserManager's tab list. The strip mixes
            // file tabs (markdown, canvas, image) and browser tabs;
            // the previous browser-only branch left file tabs
            // unreachable from ⌃Tab. WorkingPane.tsx owns the merged
            // list (and its pinned-first sort), so dispatch a
            // CustomEvent and let WorkingPane do the right thing.
            // Mirrors the duo-tree-start-rename pattern: avoids
            // lifting mergedTabs state up to App just to read it.
            console.debug('[BUG-079]', Date.now(), 'dispatch duo-cycle-working-tab')
            window.dispatchEvent(new CustomEvent('duo-cycle-working-tab', { detail: { delta } }))
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
      // ENH-080 walk-1 fix — pass `code` so chord matchers that consult
      // `e.code === 'KeyA'` / `e.code === 'Slash'` / `e.code === 'KeyM'`
      // actually match on the WCV-forward path. Pre-fix `code` was
      // missing from ForwardedKeyEvent so `synthetic.code === ''`,
      // breaking ⌘⇧A (palette) and ⌘⇧/ (split-view promote) from
      // browser-pane focus.
      const synthetic = new KeyboardEvent('keydown', {
        key: forward.key,
        code: forward.code,
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
    opts.openCloneModal,
    opts.togglePaneFocus,
    opts.splitViewToggle,
    opts.splitViewPromote,
    opts.focusTerminalPane,
    opts.focusMainPane,
    opts.focusAuxPane,
    opts.deleteCurrentFile,
    opts.openVaultQuickSwitcher,
    opts.adjustTerminalFontBump,
    opts.activePaneFocus
  ])
}
