// ENH-231 — the Home mode toggle (Projects ↔ Catch-up). A segmented control
// rendered as an ARIA radiogroup. The toggle only PERSISTS the preference
// (setMode → Settings → HOME_MODE_PUSH fan-out); it never fetches (BUG-046 —
// the catch-up board is polled by HomeView's isActive-gated effect, so a mode
// flip is a pure display switch with data already in hand).

import type { HomeMode } from '@shared/types'

interface ModeToggleProps {
  mode: HomeMode
  onChange: (mode: HomeMode) => void
}

const OPTIONS: { value: HomeMode; label: string }[] = [
  { value: 'projects', label: 'Projects' },
  { value: 'catchup', label: 'Catch-up' },
]

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div className="duo-cu-mode-row">
      <span className="duo-cu-mode-label">Home</span>
      <div className="duo-cu-mode-seg" role="radiogroup" aria-label="Home mode">
        {OPTIONS.map((opt) => {
          const on = opt.value === mode
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`duo-cu-mode-btn${on ? ' on' : ''}`}
              onClick={() => {
                if (!on) onChange(opt.value)
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <span className="duo-cu-mode-hint">remembers your last choice</span>
    </div>
  )
}
