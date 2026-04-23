// Stage 10 Phase 2 — placeholder for the file navigator.
// The full tree / breadcrumb / etc. arrives in Phase 4. This component
// reserves the leftmost column and handles the collapsed-rail state so the
// layout reshape is shippable on its own.

interface FilesPaneProps {
  collapsed: boolean
  focused: boolean
}

export function FilesPane({ collapsed, focused }: FilesPaneProps) {
  return (
    <div
      className={[
        'flex flex-col h-full bg-surface-1 border-r transition-[width] duration-150',
        focused ? 'border-accent/60' : 'border-border'
      ].join(' ')}
      style={{ width: collapsed ? '48px' : '240px', flexShrink: 0 }}
      aria-label="Files"
    >
      {collapsed ? (
        <CollapsedRail />
      ) : (
        <div className="flex flex-col h-full">
          <div className="h-10 border-b border-border flex items-center px-3 text-xs text-zinc-500 uppercase tracking-wider">
            Files
          </div>
          <div className="flex-1 flex items-center justify-center text-zinc-600 text-xs px-4 text-center">
            {/* Phase 2 placeholder — Phase 4 replaces with tree + breadcrumb */}
            Navigator arrives in Phase 4.
          </div>
        </div>
      )}
    </div>
  )
}

function CollapsedRail() {
  return (
    <div className="h-full flex flex-col items-center pt-3 gap-2 text-zinc-500">
      {/* Minimal rail glyph — real icon replaces in Phase 4 */}
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M3 4.5A1.5 1.5 0 0 1 4.5 3h4l1.5 1.5h5.5A1.5 1.5 0 0 1 17 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 15.5v-11Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
