// BUG-138 Phase 4d — bulk banner: "N suggestions · Accept all · Reject all"
// Mounts above the editor body whenever the doc carries one or more
// tracked-change marks (InsertionMark / DeletionMark / HighlightMark).
// Single TR per click; reverse-order application keeps positions valid.

import type { Editor } from '@tiptap/react'
import { acceptAllTrackedChanges, rejectAllTrackedChanges } from './trackedChanges'

interface Props {
  editor: Editor | null
  /** Pre-computed tracked-change count. MarkdownEditor recomputes via
   *  collectTrackedChanges on every selection/update tick and passes
   *  the count down so the banner stays in sync. */
  count: number
}

export function SuggestingBanner({ editor, count }: Props) {
  if (!editor || count === 0) return null

  return (
    <div
      className="flex items-center gap-3 h-9 px-3 border-b border-border bg-accent/10 text-zinc-300 text-xs shrink-0"
      data-duo-suggesting-banner="1"
    >
      <span className="font-medium text-accent">
        {count} {count === 1 ? 'suggestion' : 'suggestions'}
      </span>
      <span className="text-zinc-500">·</span>
      <button
        type="button"
        className="text-zinc-300 hover:text-accent transition-colors px-2 py-0.5 rounded hover:bg-accent/15"
        onMouseDown={(e) => {
          e.preventDefault()
          acceptAllTrackedChanges(editor)
        }}
        title="Accept every tracked change in this doc"
      >
        Accept all
      </button>
      <button
        type="button"
        className="text-zinc-300 hover:text-zinc-100 transition-colors px-2 py-0.5 rounded hover:bg-surface-3"
        onMouseDown={(e) => {
          e.preventDefault()
          rejectAllTrackedChanges(editor)
        }}
        title="Reject every tracked change in this doc"
      >
        Reject all
      </button>
    </div>
  )
}
