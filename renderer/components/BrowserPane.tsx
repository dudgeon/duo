// Stage 2: Address bar and nav chrome are live. The content area below is an
// invisible anchor — the Electron main process overlays a WebContentsView on
// top of it by reading its pixel bounds via the browser:bounds IPC channel.

import { useRef, useEffect } from 'react'
import { AddressBar } from './AddressBar'
import { useBrowserState } from '../hooks/useBrowserState'

export function BrowserPane() {
  const { state, navigate } = useBrowserState()
  const contentRef = useRef<HTMLDivElement>(null)

  // Keep the WebContentsView positioned over this div as the split moves or
  // window resizes. ResizeObserver fires on both resize and initial mount.
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
    // Also watch window resize (split drag doesn't always trigger ResizeObserver)
    window.addEventListener('resize', send)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [])

  return (
    <div className="flex flex-col w-full h-full bg-surface-1 border-l border-border">
      {/* Address bar / nav chrome */}
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

      {/* The WebContentsView is overlaid on top of this div by the main process. */}
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
