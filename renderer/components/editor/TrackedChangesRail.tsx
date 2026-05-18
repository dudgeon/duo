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

import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { acceptTrackedChange, rejectTrackedChange, type TrackedRange } from './trackedChanges'

interface Props {
  editor: Editor | null
  ranges: TrackedRange[]
  /** Optional click handler to scroll the editor to the change. v1
   *  uses a simple PM coords-at-pos jump via the editor view. */
  onJumpTo?: (range: TrackedRange) => void
  /** BUG-138 Phase 4f — current human author identity. Drives the
   *  "Mine" filter chip. When empty/null, "Mine" matches nothing. */
  currentAuthor?: string
}

type Filter = 'all' | 'mine' | 'agent' | 'others'

const AGENT_NAMES = new Set(['agent', 'claude'])

function classifyAuthor(author: string | null, currentAuthor: string): 'mine' | 'agent' | 'other' | 'none' {
  if (!author || author.trim().length === 0) return 'none'
  const a = author.trim()
  if (currentAuthor && a === currentAuthor.trim()) return 'mine'
  if (AGENT_NAMES.has(a.toLowerCase())) return 'agent'
  return 'other'
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

export function TrackedChangesRail({ editor, ranges, onJumpTo, currentAuthor = '' }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  // BUG-138 walk-1 follow-up — owner ask: way to collapse the
  // track-changes rail. Same chevron pattern as the Properties panel.
  // State is transient (component-local) — re-mounts when ranges go
  // from 0 → ≥1, so toggling Suggesting off + back on re-expands.
  const [collapsed, setCollapsed] = useState(false)

  // Pre-compute the counts per filter bucket so the chips can show
  // disabled state + counts.
  const buckets = useMemo(() => {
    let mine = 0, agent = 0, others = 0, none = 0
    for (const r of ranges) {
      const cls = classifyAuthor(r.author, currentAuthor)
      if (cls === 'mine') mine++
      else if (cls === 'agent') agent++
      else if (cls === 'other') others++
      else none++
    }
    return { mine, agent, others, none }
  }, [ranges, currentAuthor])

  const filteredRanges = useMemo(() => {
    if (filter === 'all') return ranges
    return ranges.filter(r => {
      const cls = classifyAuthor(r.author, currentAuthor)
      if (filter === 'mine') return cls === 'mine'
      if (filter === 'agent') return cls === 'agent'
      if (filter === 'others') return cls === 'other'
      return false
    })
  }, [ranges, filter, currentAuthor])

  if (!editor || ranges.length === 0) return null

  return (
    <div
      className="flex flex-col gap-1.5 px-2 py-2 border-b border-border bg-surface-1"
      data-duo-tc-rail="1"
      data-duo-tc-collapsed={collapsed ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            setCollapsed(c => !c)
          }}
          className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
          title={collapsed ? 'Expand track changes' : 'Collapse track changes'}
        >
          <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>›</span>
          <span>Track changes ({ranges.length})</span>
        </button>
      </div>
      {!collapsed && (
      <>
      <div className="flex items-center gap-1 px-1 -mt-0.5" data-duo-tc-filter-row="1">
        <FilterChip label="All" count={ranges.length} active={filter === 'all'} onSelect={() => setFilter('all')} />
        <FilterChip label="Mine" count={buckets.mine} active={filter === 'mine'} disabled={buckets.mine === 0} onSelect={() => setFilter('mine')} />
        <FilterChip label="Agent" count={buckets.agent} active={filter === 'agent'} disabled={buckets.agent === 0} onSelect={() => setFilter('agent')} />
        <FilterChip label="Others" count={buckets.others} active={filter === 'others'} disabled={buckets.others === 0} onSelect={() => setFilter('others')} />
      </div>
      {filteredRanges.length === 0 ? (
        <div className="px-1 py-3 text-[11px] text-zinc-500 italic">
          No changes match this filter.
        </div>
      ) : (
        filteredRanges.map((range, idx) => (
          <TrackedChangeCard
            key={`${range.kind}-${range.from}-${range.to}-${idx}`}
            editor={editor}
            range={range}
            onJumpTo={onJumpTo}
          />
        ))
      )}
      </>
      )}
    </div>
  )
}

interface FilterChipProps {
  label: string
  count: number
  active: boolean
  disabled?: boolean
  onSelect: () => void
}

function FilterChip({ label, count, active, disabled, onSelect }: FilterChipProps) {
  return (
    <button
      type="button"
      className={[
        'px-1.5 py-0.5 rounded text-[10px] transition-colors',
        active
          ? 'bg-accent/20 text-accent'
          : disabled
            ? 'text-zinc-600 cursor-not-allowed'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface-3'
      ].join(' ')}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onSelect()
      }}
      disabled={disabled}
      data-duo-tc-filter={label.toLowerCase()}
      data-active={active ? 'true' : 'false'}
    >
      {label} {count > 0 && <span className="opacity-70">{count}</span>}
    </button>
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
