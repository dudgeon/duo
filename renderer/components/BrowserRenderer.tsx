// Stage 10 Phase 5 — browser-type renderer for the WorkingPane.
// On unmount (e.g. when a file tab becomes active and replaces this view),
// collapse the WebContentsView to 1×1 so the browser doesn't remain visible
// over whatever took its place.

import { useRef, useEffect } from 'react'
import { AddressBar } from './AddressBar'
import { useBrowserState } from '../hooks/useBrowserState'

export function BrowserRenderer() {
  const { state, navigate } = useBrowserState()
  const contentRef = useRef<HTMLDivElement>(null)

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

      <div ref={contentRef} className="flex-1" />
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
