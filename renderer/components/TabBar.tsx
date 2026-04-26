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
  /** BUG-003 fix — tint the strip when this column has keyboard focus.
   *  Works because the strip is renderer DOM (unlike the xterm canvas /
   *  WebContentsView which occlude inset shadows on the column wrapper). */
  focused?: boolean
}

// Stage 12 Phase 3 — tab-strip rhyme.
//
// The terminal and working tab strips now share the same chip language so
// the user reads them as a single family. Differentiator: strip background
// (terminal sits on paper-edge, working on paper-deep — see
// WorkingTabStrip.tsx). Both share rounded-top chips, accent top-stripe
// for active, and serif-italic for the active label (Atelier voice).
//
// Mock reference: docs/design/atelier/project/duo-components.jsx ~L286.
export function TabBar({ tabs, activeTabId, onSelect, onNew, onClose, pendingCwd, focused = false }: TabBarProps) {
  const newTabTip = pendingCwd
    ? `New terminal tab (⌘⇧T) — launches in ${pendingCwd}`
    : 'New terminal tab (⌘⇧T)'
  return (
    <div
      className={[
        'flex items-end h-9 border-b shrink-0 px-2 gap-0.5 transition-colors',
        // Focused: warm ochre wash + accent border-bottom. Unfocused:
        // paper-edge with the standard paper-rule border.
        focused ? 'bg-accent-soft border-accent' : 'bg-surface-2 border-border'
      ].join(' ')}
    >
      <div className="flex items-end flex-1 overflow-x-auto scrollbar-none gap-0.5">
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
            canClose={tabs.length > 1}
          />
        ))}
      </div>

      {/* New tab button — sits on the strip baseline like the chips. */}
      <button
        onClick={onNew}
        className="shrink-0 w-6 h-6 mb-1 flex items-center justify-center rounded text-ink-mute hover:text-ink hover:bg-surface-3 transition-colors"
        title={newTabTip}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
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
  canClose: boolean
}

function Tab({ tab, isActive, onSelect, onClose, canClose }: TabProps) {
  return (
    <button
      onClick={onSelect}
      className={[
        'group relative flex items-center gap-1.5 px-2.5 h-7 max-w-[200px] rounded-t-lg shrink-0 transition-colors',
        isActive
          // Active: paper bg merges into the pane below; chip "outline" on
          // top + sides via inset shadows (paper-rule). 2px accent stripe
          // at the top renders as an absolute child below.
          ? 'bg-surface-0 text-ink shadow-[inset_0_1px_0_var(--duo-paper-rule),inset_1px_0_var(--duo-paper-rule),inset_-1px_0_var(--duo-paper-rule)] font-serif italic text-[13px] font-medium'
          : 'text-ink-mute hover:text-ink-soft hover:bg-surface-3 text-xs'
      ].join(' ')}
      title={tab.title}
    >
      {/* Accent top-stripe for active — mirrors WorkingTabStrip + the mock. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-0.5 bg-accent rounded-t-lg"
        />
      )}

      <TerminalIcon active={isActive} />

      <span className="truncate leading-none not-italic">{tab.title}</span>

      {canClose && (
        <span
          onClick={onClose}
          role="button"
          tabIndex={0}
          aria-label={`Close ${tab.title}`}
          onKeyDown={(e) => e.key === 'Enter' && onClose(e as unknown as React.MouseEvent)}
          className={[
            'flex items-center justify-center w-3.5 h-3.5 rounded shrink-0 transition-opacity transition-colors',
            isActive
              ? 'opacity-80 text-ink-mute hover:text-ink hover:bg-surface-2'
              : 'opacity-0 group-hover:opacity-100 text-ink-ghost hover:text-ink-soft hover:bg-surface-2'
          ].join(' ')}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </span>
      )}
    </button>
  )
}

// 10×10 terminal glyph — matches the working strip's per-type icon set so
// the two surfaces look like siblings.
function TerminalIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={active ? 'text-accent' : 'text-ink-ghost'}
    >
      <path d="M1.3 1.3h7.4v7.4H1.3V1.3Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M2.8 4l1.4 1-1.4 1M5 7h2.2" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
