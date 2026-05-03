// Stage 17b — first-open prompt for `data-duo-id` injection (PRD H14).
//
// Mounts in PageTab between the toolbar and the iframe when the open
// file has zero duo-ids AND there's no persisted choice for the file's
// parent directory. The user picks Yes / No; the choice can optionally
// be remembered for future files in the same directory ("Don't ask
// again for this folder").
//
// Visual style mirrors the WriteWarningBanner primitive (Stage 13b) so
// the canvas chrome feels consistent.

import { useState } from 'react'

interface Props {
  /** Folder containing the open file — shown in the "don't ask again
   *  for this folder" copy + persisted as the choice key. */
  dir: string
  /** Total candidate elements that would receive a duo-id. Drives the
   *  copy ("Add IDs to N elements?"). */
  candidateCount: number
  onAccept: (rememberForDir: boolean) => void
  onDecline: (rememberForDir: boolean) => void
}

export function IdInjectionBanner({ dir, candidateCount, onAccept, onDecline }: Props) {
  const [remember, setRemember] = useState(false)
  const dirShort = dir.length > 60 ? '…' + dir.slice(-58) : dir

  return (
    <div className="shrink-0 px-4 py-3 bg-surface-2 border-b border-border flex items-start gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="text-zinc-200 font-medium">
          Add stable IDs to all elements?
        </div>
        <div className="text-zinc-400 text-xs mt-1">
          Recommended — makes future agent edits more reliable. {candidateCount} element{candidateCount === 1 ? '' : 's'} would gain a <code className="text-[11px]">data-duo-id</code> attribute. The IDs are additive (existing <code className="text-[11px]">id="…"</code> attributes are never touched) and don't render visually.
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="cursor-pointer"
          />
          Don't ask again for files in <code className="text-[11px]">{dirShort}</code>
        </label>
      </div>
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          onClick={() => onAccept(remember)}
          className="px-3 py-1.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent/85 transition-colors"
        >
          Yes, save with IDs
        </button>
        <button
          onClick={() => onDecline(remember)}
          className="px-3 py-1.5 rounded border border-border text-zinc-400 text-xs hover:border-zinc-500 hover:text-zinc-200 transition-colors"
        >
          Keep file pristine
        </button>
      </div>
    </div>
  )
}
