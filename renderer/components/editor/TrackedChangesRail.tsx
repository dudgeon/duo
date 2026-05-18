// BUG-138 Phase 4e — per-suggestion rail rows. Sister to CommentRail
// but for track-changes (insertion / deletion / highlight). Stacked
// above the comment rail when both have entries.
//
// Each row shows:
//   - op-type chip ("+ ins" / "− del" / "★ hl") with the kind's color
//   - author name (or "(unattributed)" when null)
//   - inline excerpt of the marked text (truncated)
//   - ✓ Accept and ✗ Reject buttons
//
// Phase 4f (next) layers author-filter chips on top of this.

import type { Editor } from '@tiptap/react'
import { acceptTrackedChange, rejectTrackedChange, type TrackedRange } from './trackedChanges'

interface Props {
  editor: Editor | null
  ranges: TrackedRange[]
  /** Optional click handler to scroll the editor to the change. v1
   *  uses a simple PM coords-at-pos jump via the editor view. */
  onJumpTo?: (range: TrackedRange) => void
}

const KIND_LABEL: Record<TrackedRange['kind'], string> = {
  insertion: '+ ins',
  deletion: '− del',
  highlight: '★ hl'
}

const KIND_CLASS: Record<TrackedRange['kind'], string> = {
  insertion: 'text-emerald-400 bg-emerald-500/10',
  deletion: 'text-rose-400 bg-rose-500/10',
  highlight: 'text-amber-300 bg-amber-500/10'
}

export function TrackedChangesRail({ editor, ranges, onJumpTo }: Props) {
  if (!editor || ranges.length === 0) return null

  return (
    <div
      className="flex flex-col gap-1.5 px-2 py-2 border-b border-border bg-surface-1"
      data-duo-tc-rail="1"
    >
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1">
        Track changes ({ranges.length})
      </div>
      {ranges.map((range, idx) => (
        <TrackedChangeCard
          key={`${range.kind}-${range.from}-${range.to}-${idx}`}
          editor={editor}
          range={range}
          onJumpTo={onJumpTo}
        />
      ))}
    </div>
  )
}

interface CardProps {
  editor: Editor
  range: TrackedRange
  onJumpTo?: (range: TrackedRange) => void
}

function TrackedChangeCard({ editor, range, onJumpTo }: CardProps) {
  const author = range.author && range.author.trim().length > 0
    ? range.author
    : '(unattributed)'
  const excerpt = range.text.length > 60 ? range.text.slice(0, 57) + '…' : range.text

  return (
    <div
      className="flex items-start gap-2 p-2 rounded border border-border bg-surface-2 hover:bg-surface-3 transition-colors"
      data-duo-tc-row="1"
      data-duo-tc-kind={range.kind}
    >
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded font-mono ${KIND_CLASS[range.kind]}`}>
            {KIND_LABEL[range.kind]}
          </span>
          <span className="text-zinc-400 truncate">{author}</span>
        </div>
        <button
          type="button"
          className="text-left text-xs text-zinc-300 truncate hover:text-zinc-100"
          onMouseDown={(e) => {
            e.preventDefault()
            onJumpTo?.(range)
          }}
          title="Scroll to this change"
        >
          {excerpt || '(empty)'}
        </button>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="px-1.5 py-0.5 rounded text-xs text-emerald-400 hover:bg-emerald-500/15"
          onMouseDown={(e) => {
            e.preventDefault()
            acceptTrackedChange(editor, range)
          }}
          title="Accept this change"
        >
          ✓
        </button>
        <button
          type="button"
          className="px-1.5 py-0.5 rounded text-xs text-rose-400 hover:bg-rose-500/15"
          onMouseDown={(e) => {
            e.preventDefault()
            rejectTrackedChange(editor, range)
          }}
          title="Reject this change"
        >
          ✗
        </button>
      </div>
    </div>
  )
}
