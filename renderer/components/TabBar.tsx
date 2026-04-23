import type { TabSession } from '@shared/types'

interface TabBarProps {
  tabs: TabSession[]
  activeTabId: string
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
  /** Shown in the `+` button tooltip so the user can check where the next
   *  terminal will launch (Stage 10 § D10). */
  pendingCwd?: string
}

export function TabBar({ tabs, activeTabId, onSelect, onNew, onClose, pendingCwd }: TabBarProps) {
  const newTabTip = pendingCwd
    ? `New terminal tab (⌘⇧T) — launches in ${pendingCwd}`
    : 'New terminal tab (⌘⇧T)'
  return (
    // The traffic-light spacer + window drag region moved up to the App-level
    // top chrome row (Stage 10 Phase 2). The terminal tab bar lives inside the
    // middle column now — no window-edge spacing required.
    <div className="flex items-center h-10 bg-surface-1 border-b border-border shrink-0 px-2">
      {/* Tabs */}
      <div className="flex items-center flex-1 overflow-x-auto scrollbar-none gap-px">
        {tabs.map(tab => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={() => onSelect(tab.id)}
            onClose={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          />
        ))}
      </div>

      {/* New tab button */}
      <button
        onClick={onNew}
        className="shrink-0 w-8 h-8 mr-2 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-surface-3 transition-colors"
        title={newTabTip}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

interface TabProps {
  tab: TabSession
  isActive: boolean
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
}

function Tab({ tab, isActive, onSelect, onClose }: TabProps) {
  return (
    <button
      onClick={onSelect}
      className={[
        'group flex items-center gap-2 px-3 h-8 max-w-[180px] rounded text-sm font-medium transition-colors shrink-0',
        isActive
          ? 'bg-surface-3 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-2'
      ].join(' ')}
      title={tab.title}
    >
      <span className="truncate leading-none">{tab.title}</span>
      {/* Close button — only show on hover or when active */}
      <span
        onClick={onClose}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onClose(e as unknown as React.MouseEvent)}
        className={[
          'flex items-center justify-center w-4 h-4 rounded shrink-0 transition-colors',
          isActive
            ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-600'
            : 'opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
        ].join(' ')}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </span>
    </button>
  )
}
