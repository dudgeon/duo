// Stage 10 Phase 5 — browser-type renderer for the WorkingPane.
// On unmount (e.g. when a file tab becomes active and replaces this view),
// collapse the WebContentsView to 1×1 so the browser doesn't remain visible
// over whatever took its place.

import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import { AddressBar } from './AddressBar'
import { useBrowserState } from '../hooks/useBrowserState'
import { useBrowserSelection } from '../hooks/useBrowserSelection'
import { useSelectionFormat } from '../hooks/useSelectionFormat'
import { SendToDuoPill, type PillAnchorRect } from './editor/primitives/SendToDuoPill'
import { formatBrowserSendPayload, formatBrowserInspectPayload } from './editor/sendFormat'
import type { BrowserFindResult } from '@shared/types'

interface BrowserRendererProps {
  /** Stage 15.2 — same `onSendToDuo` callback the editor uses; writes
   *  the formatted payload into the active terminal's PTY. `null`
   *  propagates "no terminal available" and props the pill from
   *  rendering. */
  onSendToDuo?: ((payload: string) => void) | null
  /** ENH-176 — label override for the Send pill. See MarkdownEditor.tsx
   *  for the same prop contract. */
  pillLabel?: string
}

export function BrowserRenderer({ onSendToDuo, pillLabel }: BrowserRendererProps = {}) {
  const { state, navigate } = useBrowserState()
  const contentRef = useRef<HTMLDivElement>(null)
  const browserSelection = useBrowserSelection()
  const { format: selectionFormat } = useSelectionFormat()

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const send = () => {
      const r = el.getBoundingClientRect()
      window.electron.browser.setBounds({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      })
    }
    const park = () => {
      // FOLLOWUP-025 v2 walk-rev3 — park the WCV off-screen while a
      // full-viewport renderer modal (Clone modal) is open. WCVs are
      // native OS overlays that paint ABOVE the renderer regardless
      // of z-index, so a `fixed inset-0 z-50` modal would otherwise
      // be partially occluded by the browser pane WCV. Modal-close
      // fires `duo-wcv-restore` which re-runs send() against the
      // current DOM rect.
      window.electron.browser.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    }

    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    window.addEventListener('duo-wcv-park', park)
    window.addEventListener('duo-wcv-restore', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      window.removeEventListener('duo-wcv-park', park)
      window.removeEventListener('duo-wcv-restore', send)
      // Hide the WebContentsView when this renderer unmounts (file tab took
      // over). 1×1 keeps the view alive (SSO, audio, etc.) but invisible.
      window.electron.browser.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    }
  }, [])

  // BUG-006 (v0.5.5) — the in-page injected pill (rendered via CDP in
  // SELECTION_OBSERVER_IIFE) is now the visible Send → Duo affordance
  // on the browser surface. Renderer-DOM pill stays mounted as a
  // structural fallback (e.g. if CDP injection ever fails) but with
  // pillAnchor === null it's not painted. Keeping the renderer-DOM
  // computation commented out for posterity; restore if we ever fix
  // the WCV occlusion at the compositor layer.
  const pillAnchor = useMemo<PillAnchorRect | null>(() => {
    // Always null: WCV occludes the renderer-DOM pill regardless of
    // z-index. The in-page pill (CdpBridge SELECTION_OBSERVER_IIFE)
    // owns the visual chrome on the browser surface.
    return null
  }, [])

  // Pill click — same formatter contract as the editor side, kind:
  // 'browser'. The page title for the provenance line comes from
  // BrowserState (the address bar already tracks it); falls back to
  // the URL alone when the title hasn't propagated yet.
  //
  // BUG-006 v2 — accepts an optional snapshot arg (provided by the
  // in-page pill via the binding payload). When omitted, falls back
  // to the renderer's cached snapshot — that's the path used by the
  // ⌘D keyboard shortcut and the (currently disabled) renderer-DOM
  // pill, which both run synchronously inside the renderer.
  const handleSendToDuoClick = useCallback((overrideSnap?: import('@shared/types').BrowserSelectionSnapshot | null) => {
    if (!onSendToDuo) return
    const snap = overrideSnap ?? browserSelection.snapshot
    if (!snap) return
    const payload = formatBrowserSendPayload(snap, selectionFormat, {
      pageTitle: state.title
    })
    onSendToDuo(payload)
  }, [onSendToDuo, browserSelection, selectionFormat, state.title])

  // BUG-006 — subscribe to in-page pill clicks. The page-injected pill
  // posts via the duoSendToDuoClick CDP binding → BrowserManager IPC →
  // here. v2 carries the selection snapshot in the IPC message so we
  // don't race with selectionchange clearing the renderer's cache.
  //
  // Defensive: tolerate a stale preload (preload doesn't HMR — if the
  // renderer reloaded my changes but Electron wasn't restarted, this
  // function is still undefined). Without the guard the renderer
  // throws on mount and the whole window goes blank.
  useEffect(() => {
    const subscribe = window.electron.browser.onSendToDuoClick
    if (typeof subscribe !== 'function') {
      console.warn('[BrowserRenderer] window.electron.browser.onSendToDuoClick missing — preload likely stale; restart Electron to enable in-page pill clicks.')
      return
    }
    return subscribe((snapshot) => {
      handleSendToDuoClick(snapshot)
    })
  }, [handleSendToDuoClick])

  // ENH-159b — subscribe to inspect-mode element clicks. Page-side
  // INSPECT_OBSERVER_IIFE captures the snapshot when the user clicks
  // an outlined element while inspect mode is active; the snapshot
  // arrives here via the duoInspectClick binding → BrowserManager
  // IPC. We format it (carries the page title from BrowserState into
  // the provenance line, same as the selection formatter) and ship
  // to the active terminal — same egress path as the Send → Duo
  // pill. `null` = ESC was pressed; just no-op (the page-side IIFE
  // also flips inspect mode off in that case).
  useEffect(() => {
    if (!onSendToDuo) return
    const subscribe = window.electron.browser.onInspectClick
    if (typeof subscribe !== 'function') {
      console.warn('[BrowserRenderer] window.electron.browser.onInspectClick missing — preload likely stale; restart Electron to enable inspect mode.')
      return
    }
    return subscribe((snapshot) => {
      if (!snapshot) return
      const withTitle: import('@shared/types').BrowserInspectSnapshot = {
        ...snapshot,
        pageTitle: snapshot.pageTitle ?? state.title ?? undefined
      }
      const payload = formatBrowserInspectPayload(withTitle, selectionFormat)
      onSendToDuo(payload)
    })
  }, [onSendToDuo, selectionFormat, state.title])

  // Stage 15.3 — ⌘D listener. Same shape as MarkdownEditor + PageTab.
  // Browser pane is mounted whenever activeWorking.kind === 'browser';
  // multiple browser tabs share one BrowserRenderer mount, so the
  // single listener is correct. Gates on a non-null selection snapshot
  // so a chord with nothing selected no-ops cleanly.
  useEffect(() => {
    const handler = () => {
      if (!browserSelection.snapshot) return
      handleSendToDuoClick()
    }
    window.addEventListener('duo-send-to-duo', handler)
    return () => window.removeEventListener('duo-send-to-duo', handler)
  }, [handleSendToDuoClick, browserSelection])

  // ENH-028 — find-in-page state lives in the renderer; main owns the
  // actual webContents.findInPage call. ⌘F (forwarded as the
  // `duo-browser-find-open` window event by App.tsx when the active
  // surface is the browser) opens the bar; ⎋ closes it; ⌘G / Enter =
  // next; ⇧Enter in the bar = previous — the ONLY find-previous here,
  // a deliberate asymmetry vs the editor/canvas bars (which also keep
  // input-local ⌘⇧F; over the browser, ⌘⇧F opens the vault-search
  // palette — FOLLOWUP-047). Match counts arrive via onFindResult
  // from main.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findResult, setFindResult] = useState<BrowserFindResult | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)

  // Open / focus / close hooks. App.tsx dispatches these on ⌘F / ⌘G
  // when the working pane's active surface is the browser. (The
  // `duo-browser-find-prev` listener below is orphaned — nothing
  // dispatches it since the global find-prev chord was retired; its
  // removal is FOLLOWUP-047.)
  useEffect(() => {
    const onOpen = () => {
      setFindOpen(true)
      // rAF so the input is mounted before .focus() runs.
      requestAnimationFrame(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      })
    }
    const onNext = () => {
      if (!findQuery) return
      window.electron.browser.findStart(findQuery, { findNext: true, forward: true })
    }
    const onPrev = () => {
      if (!findQuery) return
      window.electron.browser.findStart(findQuery, { findNext: true, forward: false })
    }
    window.addEventListener('duo-browser-find-open', onOpen)
    window.addEventListener('duo-browser-find-next', onNext)
    window.addEventListener('duo-browser-find-prev', onPrev)
    return () => {
      window.removeEventListener('duo-browser-find-open', onOpen)
      window.removeEventListener('duo-browser-find-next', onNext)
      window.removeEventListener('duo-browser-find-prev', onPrev)
    }
  }, [findQuery])

  // Subscribe to match-count results. Main pushes intermediate +
  // final updates per `webContents.findInPage`; we keep the latest.
  useEffect(() => {
    return window.electron.browser.onFindResult((result) => {
      setFindResult(result)
    })
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    setFindResult(null)
    window.electron.browser.findStop()
  }, [])

  const handleFindInput = useCallback((next: string) => {
    setFindQuery(next)
    if (next.length === 0) {
      setFindResult(null)
      window.electron.browser.findStop()
      return
    }
    window.electron.browser.findStart(next)
  }, [])

  return (
    <div className="flex flex-col w-full h-full bg-surface-1">
      {/* ENH-028 — find-in-page bar. Renders above the address bar
          when active so it doesn't overlap the WebContentsView (BUG-047
          occlusion class). Slides into the renderer-DOM column flow,
          which pushes the WCV's content area down via the existing
          ResizeObserver. */}
      {findOpen && (
        <div className="flex items-center h-9 px-3 gap-2 border-b border-border shrink-0 bg-surface-2 text-zinc-200">
          <span className="text-[11px] text-zinc-500 select-none">Find</span>
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => handleFindInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeFind()
              } else if (e.key === 'Enter') {
                // ↵ = next, ⇧↵ = previous (browser convention).
                e.preventDefault()
                if (!findQuery) return
                window.electron.browser.findStart(findQuery, {
                  findNext: true,
                  forward: !e.shiftKey
                })
              }
            }}
            placeholder="Search this page…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="flex-1 min-w-0 px-2 py-0.5 text-[12px] bg-surface-3 border border-accent rounded text-zinc-100 placeholder-zinc-500 outline-none"
          />
          <span className="text-[11px] text-zinc-500 tabular-nums select-none w-16 text-right">
            {findResult && findQuery
              ? findResult.matches > 0
                ? `${findResult.activeMatchOrdinal}/${findResult.matches}`
                : '0/0'
              : ''}
          </span>
          <button
            type="button"
            onClick={closeFind}
            title="Close find"
            className="text-[11px] text-zinc-500 hover:text-zinc-200 px-1.5"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex items-center h-10 px-3 gap-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <NavButton
            title="Back"
            disabled={!state.canGoBack}
            onClick={() => window.electron.browser.back()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6 2L3 5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </NavButton>

          <NavButton
            title="Forward"
            disabled={!state.canGoForward}
            onClick={() => window.electron.browser.forward()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M4 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </NavButton>

          <NavButton
            title={state.isLoading ? 'Stop' : 'Reload'}
            onClick={() => window.electron.browser.reload()}
          >
            {state.isLoading ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 2a3 3 0 1 1-2.83 2M2 1v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </NavButton>
        </div>

        <AddressBar
          url={state.url}
          onNavigate={navigate}
          isLoading={state.isLoading}
        />
      </div>

      <div className="flex-1 relative min-w-0">
        <div ref={contentRef} className="absolute inset-0" />
      </div>
      {/* Stage 15.2 — Send → Duo pill anchored over the active page
          selection. Same primitive the editor uses; only the binding
          (selection observer + rect translation) is browser-specific. */}
      {onSendToDuo && (
        <SendToDuoPill rect={pillAnchor} onClick={handleSendToDuoClick} label={pillLabel} />
      )}
    </div>
  )
}

function NavButton({
  title,
  disabled = false,
  onClick,
  children
}: {
  title: string
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}
