// Stage 2: replace placeholder with a live WebContentsView
// The actual browser rendering happens in the Electron main process via
// WebContentsView — this component is a position anchor / overlay host.
// For Stage 1 this is just a labeled placeholder.

export function BrowserPane() {
  return (
    <div className="flex flex-col w-full h-full bg-surface-1 border-l border-border">
      {/* Address bar (Stage 2) */}
      <div className="flex items-center h-10 px-3 gap-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <NavButton title="Back" disabled>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M6 2L3 5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </NavButton>
          <NavButton title="Forward" disabled>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M4 2l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </NavButton>
          <NavButton title="Reload" disabled>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M5 2a3 3 0 1 1-2.83 2M2 1v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </NavButton>
        </div>

        <div className="flex-1 h-6 px-3 rounded bg-surface-0 border border-border text-zinc-600 text-xs flex items-center select-none">
          about:blank
        </div>
      </div>

      {/* Browser content area — Stage 2 wires in WebContentsView here */}
      <div className="flex flex-1 items-center justify-center text-zinc-700 text-sm select-none">
        <div className="text-center space-y-2">
          <div className="text-2xl">⌖</div>
          <div className="font-medium">Browser pane</div>
          <div className="text-xs text-zinc-600">Coming in Stage 2</div>
        </div>
      </div>
    </div>
  )
}

function NavButton({ title, disabled, children }: { title: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      disabled={disabled}
      className="w-6 h-6 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-surface-3 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}
