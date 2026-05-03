// ENH-066 (v0.6.3) — vertical rail rendered in a pane's slot when
// that pane is fully collapsed (split = 0% for terminal, 100% for
// canvas). Replaces the prior "0-width pane is invisible" failure
// mode where users couldn't tell what they'd just collapsed nor how
// to expand it back. Mirrors `FilesPane.tsx § CollapsedRail`'s
// pattern for the navigator's collapsed state.
//
// Click the rail → onExpand fires → App.tsx's toggleCollapse* sets
// splitPct back to prevSplitPct (the last drag-set value before
// collapse). The titlebar collapse buttons (ENH-040) stay too;
// owner framing: titlebar buttons are "I want to collapse this
// deliberately"; the rail is "I'd forgotten this pane existed and
// want it back."

interface CollapsedPaneRailProps {
  kind: 'terminal' | 'canvas'
  onExpand: () => void
}

export function CollapsedPaneRail({ kind, onExpand }: CollapsedPaneRailProps) {
  const label = kind === 'terminal' ? 'Show terminal column' : 'Show canvas (right pane)'
  return (
    <button
      type="button"
      onClick={onExpand}
      title={label}
      aria-label={label}
      className="h-full w-full flex flex-col items-center pt-3 gap-2 text-ink-mute hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer"
    >
      {kind === 'terminal' ? <TerminalGlyph /> : <CanvasGlyph />}
      {/* Vertical "Show" label, rotated so it reads bottom-to-top in
          the narrow rail. Atelier serif italic to match the chip
          language of the active tab (and the titlebar version
          badge style). */}
      <span
        // ENH-072 (v0.6.3) — bumped from 11px to 13px per owner walk-2
        // note ("the text label on the terminal and canvas collapse
        // rails should be larger"). Stays serif italic to match the
        // tab-strip's active-tab style.
        className="font-serif italic text-[13px] text-ink-mute mt-1 tracking-wide"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {kind === 'terminal' ? 'terminal' : 'canvas'}
      </span>
    </button>
  )
}

function TerminalGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 7l2.5 2L5 11M9 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CanvasGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 6.5h10M4 9h7M4 11.5h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
