// Stage 24 — confirm modal that gates closing a pinned WorkingPane
// tab. Used by both the strip's close-button path (right-click flow
// and ⌘W from the strip's local handler) and App.tsx's keyboard
// ⌘W handler. Auto-focuses Cancel so a stray Return is non-
// destructive. Click outside / Escape also cancel.

import { useEffect } from 'react'

export interface PinnedCloseConfirmProps {
  label: string
  onConfirm: () => void
  onCancel: () => void
}

export function PinnedCloseConfirm({ label, onConfirm, onCancel }: PinnedCloseConfirmProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        className="bg-surface-0 border border-border rounded-lg p-5 max-w-[380px] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-serif text-base text-ink mb-2">Close pinned tab?</h3>
        <p className="text-sm text-ink-soft mb-4 break-words">
          <span className="text-ink">{label}</span> is pinned. Close it anyway?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="px-3 h-8 rounded text-sm text-ink-soft hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 h-8 rounded text-sm bg-accent text-white hover:bg-accent-ink"
          >
            Close tab
          </button>
        </div>
      </div>
    </div>
  )
}
