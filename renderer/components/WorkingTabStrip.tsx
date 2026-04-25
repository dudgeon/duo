// Stage 10 Phase 3 — unified tab strip for the WorkingPane.
//
// Supersedes the old `BrowserTabStrip`. Tabs are mixed-type, identified by
// `type`; each chip shows a small leading icon indicating the type so a
// browser page, a markdown preview, and an image preview can sit side by
// side without visual ambiguity (Stage 10 § D26).

import type { WorkingTab, WorkingTabType } from '@shared/types'

interface WorkingTabStripProps {
  tabs: WorkingTab[]
  onSelect: (id: string) => void
  onNew: () => void
  onClose: (id: string) => void
}

export function WorkingTabStrip({ tabs, onSelect, onNew, onClose }: WorkingTabStripProps) {
  return (
    <div className="flex items-center h-8 px-2 gap-px bg-surface-2 border-b border-border shrink-0 overflow-x-auto scrollbar-none">
      {tabs.map(tab => (
        <WorkingTabItem
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
  tab: WorkingTab
  onSelect: () => void
  onClose: (e: React.MouseEvent) => void
  canClose: boolean
}

function WorkingTabItem({ tab, onSelect, onClose, canClose }: ItemProps) {
  const label = tabLabel(tab)
  const tooltip = tab.path ?? tab.url ?? label
  return (
    <button
      onClick={onSelect}
      className={[
        'group flex items-center gap-1.5 px-2 h-6 max-w-[200px] rounded text-[11px] font-medium transition-colors shrink-0',
        tab.isActive
          ? 'bg-surface-3 text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-surface-1'
      ].join(' ')}
      title={tooltip}
    >
      <TypeIcon type={tab.type} />
      <span className="truncate leading-none">{label}</span>
      {tab.dirty && (
        <span
          aria-label="Unsaved changes"
          title="Unsaved changes"
          className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
        />
      )}
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

function tabLabel(tab: WorkingTab): string {
  if (tab.type === 'browser') return tab.title || tab.url || 'New tab'
  return tab.title
}

function TypeIcon({ type }: { type: WorkingTabType }) {
  // 10×10 glyphs, monochrome. Matches the per-type set we'll grow in the
  // navigator (Phase 4). Keep the set small and recognizable.
  switch (type) {
    case 'browser':
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <circle cx="5" cy="5" r="3.7" stroke="currentColor" strokeWidth="1" />
          <path d="M1.3 5h7.4M5 1.3C6.2 2.6 6.8 4.2 6.8 5S6.2 7.4 5 8.7C3.8 7.4 3.2 5.8 3.2 5S3.8 2.6 5 1.3Z" stroke="currentColor" strokeWidth="0.8" />
        </svg>
      )
    case 'editor':
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
          <path d="M3 5h3M3 6.5h3M3 8h2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
        </svg>
      )
    case 'markdown-preview':
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
          <path d="M3 6.5l1-1 1 1 1-1 1 1" stroke="currentColor" strokeWidth="0.9" />
        </svg>
      )
    case 'image':
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <rect x="1.3" y="1.5" width="7.4" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
          <circle cx="3.5" cy="4" r="0.8" stroke="currentColor" strokeWidth="0.8" />
          <path d="M8 6.5L6 4.5l-1.5 2L3 5l-1.5 1.5" stroke="currentColor" strokeWidth="0.9" />
        </svg>
      )
    case 'pdf':
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
          <text x="3.5" y="7.5" fontSize="2.8" fill="currentColor" fontFamily="system-ui">pdf</text>
        </svg>
      )
    default:
      return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M1.5 1.5h5l2 2v5h-7v-7Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
          <path d="M6.5 1.5v2h2" stroke="currentColor" strokeWidth="1" />
        </svg>
      )
  }
}
