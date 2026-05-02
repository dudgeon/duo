// Stage 24 — confirm modal used for pinned-tab close AND ENH-026
// "Move to Trash" tab actions. BUG-049 (v0.5.5): callers now pass
// explicit `title` / `body` strings; the old `label` prop is still
// supported for backward compat (the pinned-close path keeps its
// original wording: "<label> is pinned. Close it anyway?").
// Auto-focuses Cancel so a stray Return is non-destructive. Click
// outside / Escape also cancel.

import { useEffect, type ReactNode } from 'react'

export interface PinnedCloseConfirmProps {
  /** New API (BUG-049): explicit modal title + body. Used by the
   *  trash flow with copy like "Move to Trash?" / "<file> will be
   *  moved to the Trash. The tab will close." */
  title?: string
  body?: ReactNode
  /** Confirm button label. Defaults to "Close tab" so the original
   *  pinned-close call site is unchanged. */
  confirmLabel?: string
  /** Legacy API (pre-BUG-049): when only `label` is provided, the
   *  modal renders the original pinned-close copy: "Close pinned
   *  tab?" / "<label> is pinned. Close it anyway?". */
  label?: string
  onConfirm: () => void
  onCancel: () => void
}

export function PinnedCloseConfirm({
  title,
  body,
  confirmLabel = 'Close tab',
  label,
  onConfirm,
  onCancel
}: PinnedCloseConfirmProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  // BUG-049 — when explicit title/body are passed, use them; otherwise
  // fall back to the legacy pinned-close copy that wraps `label`.
  const effectiveTitle = title ?? 'Close pinned tab?'
  const effectiveBody = body ?? (
    <>
      <span className="text-ink">{label}</span> is pinned. Close it anyway?
    </>
  )

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
        <h3 className="font-serif text-base text-ink mb-2">{effectiveTitle}</h3>
        <p className="text-sm text-ink-soft mb-4 break-words">
          {effectiveBody}
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
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
