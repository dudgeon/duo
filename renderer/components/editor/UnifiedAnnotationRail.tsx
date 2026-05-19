// ENH-166 v2 — unified annotation rail. The v1 ship (this morning)
// stacked two rails — TrackedChangesRail on top, comment threads
// below — in one 280px column. Owner pushed back: items should
// **interleave** by document position, e.g. [comment 1, addition 1,
// comment 2, deletion 1, comment 3], so reading the rail mirrors
// reading the document.
//
// This component merges:
//   - tracked changes (TrackedRange[], PM positions in `.from`)
//   - comment threads (BuiltMarkdownThread[], live PM positions in
//     `.range.from` when the mark is anchored in the doc)
// into one sorted list keyed on PM position, with one filter-chip row
// (Mine / Agent / Others) that spans BOTH kinds. Cards keep their
// kind-specific shape; we just choose which to render per item.
//
// Threads without a live range (sidecar-only) sort to the end so the
// rail still surfaces them without inventing a position.

import { useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { TrackedRange } from './trackedChanges'
import type { BuiltMarkdownThread } from './markdownComments'
import type { CommentThread } from './primitives/CommentRail'
import {
  TrackedChangeCard,
  FilterChip,
  classifyAuthor,
  type AnnotationFilter
} from './TrackedChangesRail'
import { CommentThreadCard } from './primitives/CommentRail'

interface Props {
  editor: Editor | null
  ranges: TrackedRange[]
  /** Built threads keyed with their live PM positions (from
   *  `buildMarkdownThreads`). Threads with a null `range` are
   *  sidecar-only and rendered after the positioned ones. */
  threads: BuiltMarkdownThread[]
  currentAuthor: string
  activeThreadId?: string | null
  /** Rail card handlers — the host wires these the same way it did
   *  for the v1 separate rails. */
  onJumpToRange: (range: TrackedRange) => void
  onJumpToThread: (threadId: string) => void
  onReply: (threadId: string, body: string) => void
  onResolve: (threadId: string) => void
  onReopen?: (threadId: string) => void
}

type RailItem =
  | { kind: 'tracked'; sortKey: number; range: TrackedRange; author: string | null }
  | { kind: 'comment'; sortKey: number; thread: CommentThread; leadAuthor: string | null }

const POSITIONLESS_KEY = Number.MAX_SAFE_INTEGER

export function UnifiedAnnotationRail({
  editor,
  ranges,
  threads,
  currentAuthor,
  activeThreadId,
  onJumpToRange,
  onJumpToThread,
  onReply,
  onResolve,
  onReopen
}: Props) {
  const [filter, setFilter] = useState<AnnotationFilter>('all')

  const items = useMemo<RailItem[]>(() => {
    const out: RailItem[] = []
    for (const r of ranges) {
      out.push({ kind: 'tracked', sortKey: r.from, range: r, author: r.author })
    }
    for (const t of threads) {
      // Adapt BuiltMarkdownThread → CommentThread (the shape
      // CommentThreadCard already takes). Thread number is assigned
      // AFTER sorting (1-based document order across comments only —
      // the badge convention from v1).
      const leadAuthor = t.entries[0]?.author ?? null
      const card: CommentThread = {
        id: t.threadId,
        number: 0, // assigned post-sort
        excerpt: t.excerpt ?? undefined,
        resolved: t.resolved,
        entries: t.entries.map(e => ({
          id: e.id,
          author: e.author,
          ts: e.ts,
          body: e.body
        }))
      }
      out.push({
        kind: 'comment',
        sortKey: t.range?.from ?? POSITIONLESS_KEY,
        thread: card,
        leadAuthor
      })
    }
    out.sort((a, b) => a.sortKey - b.sortKey)
    // Assign 1-based comment numbers in post-sort document order.
    let commentN = 0
    for (const item of out) {
      if (item.kind === 'comment') {
        commentN++
        item.thread = { ...item.thread, number: commentN }
      }
    }
    return out
  }, [ranges, threads])

  // Per-bucket counts drive the filter chip labels + disabled state.
  const buckets = useMemo(() => {
    let mine = 0, agent = 0, others = 0, none = 0
    for (const it of items) {
      const author = it.kind === 'tracked' ? it.author : it.leadAuthor
      const cls = classifyAuthor(author, currentAuthor)
      if (cls === 'mine') mine++
      else if (cls === 'agent') agent++
      else if (cls === 'other') others++
      else none++
    }
    return { mine, agent, others, none }
  }, [items, currentAuthor])

  const filtered = useMemo<RailItem[]>(() => {
    if (filter === 'all') return items
    return items.filter(it => {
      const author = it.kind === 'tracked' ? it.author : it.leadAuthor
      const cls = classifyAuthor(author, currentAuthor)
      if (filter === 'mine') return cls === 'mine'
      if (filter === 'agent') return cls === 'agent'
      if (filter === 'others') return cls === 'other'
      return false
    })
  }, [items, filter, currentAuthor])

  if (!editor || items.length === 0) return null

  return (
    <aside
      className="duo-unified-rail"
      aria-label="Annotations"
      data-duo-unified-rail="2"
    >
      <div className="duo-comment-rail__header">
        <span className="duo-comment-rail__count">
          {items.length} annotation{items.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="px-2 pt-1.5 pb-2 flex items-center gap-1" data-duo-unified-filter-row="1">
        <FilterChip label="All" count={items.length} active={filter === 'all'} onSelect={() => setFilter('all')} />
        <FilterChip label="Mine" count={buckets.mine} active={filter === 'mine'} disabled={buckets.mine === 0} onSelect={() => setFilter('mine')} />
        <FilterChip label="Agent" count={buckets.agent} active={filter === 'agent'} disabled={buckets.agent === 0} onSelect={() => setFilter('agent')} />
        <FilterChip label="Others" count={buckets.others} active={filter === 'others'} disabled={buckets.others === 0} onSelect={() => setFilter('others')} />
      </div>
      <div className="duo-comment-rail__threads">
        {filtered.length === 0 ? (
          <div className="duo-comment-rail__empty">No annotations match this filter.</div>
        ) : (
          filtered.map((it) => {
            if (it.kind === 'tracked') {
              return (
                <TrackedChangeCard
                  key={`tc-${it.range.kind}-${it.range.from}-${it.range.to}`}
                  editor={editor}
                  range={it.range}
                  onJumpTo={onJumpToRange}
                />
              )
            }
            return (
              <CommentThreadCard
                key={`cm-${it.thread.id}`}
                thread={it.thread}
                active={activeThreadId === it.thread.id}
                onJumpTo={onJumpToThread}
                onReply={onReply}
                onResolve={onResolve}
                onReopen={onReopen}
              />
            )
          })
        )}
      </div>
    </aside>
  )
}
