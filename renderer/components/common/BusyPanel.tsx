// ENH-253 review — the shared "networked git action in progress" panel
// (spinner + bold title + optional mono detail line) used by CloneModal and
// PullModal. Extracted from CloneModal's FOLLOWUP-025 v2 walk-rev3 panel so
// the two modals can't drift visually.

export function Spinner() {
  return (
    <span className="text-accent" aria-hidden="true">
      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function BusyPanel({ title, detail, children }: {
  title: string
  detail?: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-3 px-4 py-3 rounded bg-paper-deep border border-paper-rule">
      <div className="flex items-center gap-3">
        <Spinner />
        <div className="flex-1 min-w-0">
          <div className="text-ink font-semibold text-sm">{title}</div>
          {detail && (
            <div className="text-ink-mute text-xs mt-0.5 font-mono break-all">{detail}</div>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
