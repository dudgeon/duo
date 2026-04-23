import type { BrowserTab } from '@shared/types'

interface BrowserTabStripProps {
  tabs: BrowserTab[]
  onSelect: (id: number) => void
  onNew: () => void
  onClose: (id: number) => void
}

export function BrowserTabStrip({ tabs, onSelect, onNew, onClose }: BrowserTabStripProps) {
  return (
    <div className="flex items-center h-8 px-2 gap-px bg-surface-2 border-b border-border shrink-0 overflow-x-auto scrollbar-none">
      {tabs.map(tab => (
        <BrowserTabItem
          key={tab.id}
          tab={tab}
          onSelect={() => onSelect(tab.id)}
          onClose={(e) => {
            e.stopPropagation()
            onClose(tab.id)
          }}
          canClose={tabs.length > 1}
        />
      ))}

      <button
        onClick={onNew}
        className="shrink-0 w-6 h-6 ml-1 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-surface-3 transition-colors"
        title="New browser tab (⌘T)"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

interface ItemProps {
  tab: BrowserTab
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  canClose: boolean
}

function BrowserTabItem({ tab, onSelect, onClose, canClose }: ItemProps) {
  const label = tab.title || tab.url || 'New tab'
  return (
    <button
      onClick={onSelect}
      className={[
        'group flex items-center gap-2 px-2 h-6 max-w-[200px] rounded text-[11px] font-medium transition-colors shrink-0',
        tab.isActive
          ? 'bg-surface-3 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-1'
      ].join(' ')}
      title={tab.url}
    >
      <span className="truncate leading-none">{label}</span>
      {canClose && (
        <span
          onClick={onClose}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onClose(e as unknown as React.MouseEvent)}
          className={[
            'flex items-center justify-center w-3.5 h-3.5 rounded shrink-0 transition-colors',
            tab.isActive
              ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-600'
              : 'opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
          ].join(' ')}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </span>
      )}
    </button>
  )
}
