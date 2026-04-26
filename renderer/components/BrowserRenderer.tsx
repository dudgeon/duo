// Stage 10 Phase 5 — browser-type renderer for the WorkingPane.
// On unmount (e.g. when a file tab becomes active and replaces this view),
// collapse the WebContentsView to 1×1 so the browser doesn't remain visible
// over whatever took its place.

import { useRef, useEffect, useMemo, useCallback } from 'react'
import { AddressBar } from './AddressBar'
import { useBrowserState } from '../hooks/useBrowserState'
import { useBrowserSelection } from '../hooks/useBrowserSelection'
import { useSelectionFormat } from '../hooks/useSelectionFormat'
import { SendToDuoPill, type PillAnchorRect } from './editor/primitives/SendToDuoPill'
import { formatBrowserSendPayload } from './editor/sendFormat'

interface BrowserRendererProps {
  /** Stage 15.2 — same `onSendToDuo` callback the editor uses; writes
   *  the formatted payload into the active terminal's PTY. `null`
   *  propagates "no terminal available" and props the pill from
   *  rendering. */
  onSendToDuo?: ((payload: string) => void) | null
}

export function BrowserRenderer({ onSendToDuo }: BrowserRendererProps = {}) {
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

    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
      // Hide the WebContentsView when this renderer unmounts (file tab took
      // over). 1×1 keeps the view alive (SSO, audio, etc.) but invisible.
      window.electron.browser.setBounds({ x: 0, y: 0, width: 1, height: 1 })
    }
  }, [])

  // Stage 15.2 — translate the page-side selection rect into renderer-
  // window coordinates so the pill anchors over the WebContentsView.
  // The contentRef div is the placeholder that the view's bounds
  // mirror; its screen rect plus the page's viewport-relative rect
  // gives the pill's anchor.
  const pillAnchor = useMemo<PillAnchorRect | null>(() => {
    if (!browserSelection.snapshot || !browserSelection.rect) return null
    if (!onSendToDuo) return null
    const host = contentRef.current
    if (!host) return null
    const hostRect = host.getBoundingClientRect()
    const pageRect = browserSelection.rect
    const top = hostRect.top + pageRect.y
    const right = hostRect.left + pageRect.x + pageRect.width
    const bottom = top + pageRect.height
    return { top, right, bottom }
  }, [browserSelection, onSendToDuo])

  // Pill click — same formatter contract as the editor side, kind:
  // 'browser'. The page title for the provenance line comes from
  // BrowserState (the address bar already tracks it); falls back to
  // the URL alone when the title hasn't propagated yet.
  const handleSendToDuoClick = useCallback(() => {
    if (!onSendToDuo) return
    const snap = browserSelection.snapshot
    if (!snap) return
    const payload = formatBrowserSendPayload(snap, selectionFormat, {
      pageTitle: state.title
    })
    onSendToDuo(payload)
  }, [onSendToDuo, browserSelection, selectionFormat, state.title])

  return (
    <div className="flex flex-col w-full h-full bg-surface-1">
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
        <SendToDuoPill rect={pillAnchor} onClick={handleSendToDuoClick} />
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
