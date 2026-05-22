// ENH-170 (Sprint 20 / v0.7.7) — Settings modal, first occupant.
//
// Triggered by:
//   - macOS app menu: App > Settings… (via SETTINGS_MODAL_OPEN push)
//   - Keyboard chord ⌘, (same — bound on the menu item itself)
//
// v1 ships the two Claude-tab Return-key prefs that have shipped as
// CLI-only (`duo claude-return` / `duo shift-return`) since Sprint 16
// / v0.6.15. The toggles wire to the existing `useClaudeKeyPrefs()`
// hook — same plumbing the CLI verbs already use, so changing a
// toggle here updates state across all surfaces (terminal pane
// behavior, CLI reads, future panels).
//
// Toggle label "Return → line break in Claude" picked by owner via
// AskUserQuestion 2026-05-22 over four proposed alternatives (single-
// toggle framing won over verbose Submit/Newline pairs).
//
// v2 stretch (not Sprint 20): expose `duo author`, `duo selection-format`,
// default new-terminal kind. v1 keeps the modal small and focused.

import { useEffect, useRef } from 'react'
import { useClaudeKeyPrefs } from '../hooks/useClaudeKeyPrefs'

export interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { claudeReturn, shiftReturn, setClaudeReturn, setShiftReturn } = useClaudeKeyPrefs()
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // ESC dismissal. Click-outside via the backdrop overlay.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // The toggle semantic — `true` on the switch means "newline mode".
  // The CLI flag has the same default: `claude-return submit` is off,
  // `claude-return newline` is on. Same for shift-return.
  const returnIsNewline = claudeReturn === 'newline'
  const shiftReturnIsSubmit = shiftReturn === 'submit'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        // Click outside the dialog body closes. Click inside doesn't.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="bg-surface-1 border border-border rounded-lg shadow-xl w-[480px] max-w-[90vw] p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-700 px-2 py-1 rounded hover:bg-accent/10"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">Claude terminals</h3>

          <SettingToggle
            label="Return → line break in Claude"
            description="When on, pressing Return in a Claude terminal inserts a newline (multi-line composer). When off, Return submits to Claude (terminal default)."
            checked={returnIsNewline}
            onChange={(v) => setClaudeReturn(v ? 'newline' : 'submit')}
          />

          <SettingToggle
            label="Shift+Return → submit in Claude"
            description="When on, Shift+Return submits to Claude. When off, Shift+Return inserts a newline (Slack default)."
            checked={shiftReturnIsSubmit}
            onChange={(v) => setShiftReturn(v ? 'submit' : 'newline')}
          />
        </section>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[13px] font-medium bg-accent text-white hover:bg-accent/90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

interface SettingToggleProps {
  label: string
  description: string
  checked: boolean
  onChange: (next: boolean) => void
}

function SettingToggle({ label, description, checked, onChange }: SettingToggleProps) {
  return (
    <label className="flex items-start gap-3 py-3 border-t border-border first:border-t-0 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-accent w-4 h-4 cursor-pointer"
      />
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[12px] text-zinc-600 mt-0.5">{description}</div>
      </div>
    </label>
  )
}
