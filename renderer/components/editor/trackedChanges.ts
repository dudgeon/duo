// BUG-138 Phase 4d — helpers for accepting/rejecting CriticMarkup
// marks (insertions, deletions, highlights) in bulk.
//
// Comments are handled by the existing rail UX in
// `markdownComments.ts`; this module covers the track-changes triad
// (insertion / deletion / highlight) that Phase 4b/4c can stamp
// automatically when Suggesting is on.

import type { Editor } from '@tiptap/react'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'

export interface TrackedRange {
  from: number
  to: number
  kind: 'insertion' | 'deletion' | 'highlight'
  author: string | null
  ts: string | null
  text: string
}

const KIND_BY_MARK_NAME: Record<string, TrackedRange['kind']> = {
  insertionMark: 'insertion',
  deletionMark: 'deletion',
  highlightMark: 'highlight'
}

/** Collect every tracked-change range in the doc. Adjacent
 *  same-mark spans collapse into one range. Comments are excluded —
 *  the existing comment rail surfaces those separately. */
export function collectTrackedChanges(doc: PMNode): TrackedRange[] {
  const out: TrackedRange[] = []
  let current: { kind: TrackedRange['kind']; from: number; to: number; mark: Mark } | null = null

  const flush = () => {
    if (!current) return
    out.push({
      from: current.from,
      to: current.to,
      kind: current.kind,
      author: (current.mark.attrs.author as string | null) ?? null,
      ts: (current.mark.attrs.ts as string | null) ?? null,
      text: doc.textBetween(current.from, current.to, '\n', ' ')
    })
    current = null
  }

  doc.descendants((node, pos) => {
    if (!node.isText) {
      // A non-text node boundary breaks any in-progress range —
      // typing across blocks shouldn't merge marks.
      flush()
      return true
    }
    const text = node.text ?? ''
    const tcMark = node.marks.find(m => KIND_BY_MARK_NAME[m.type.name])
    if (!tcMark) {
      flush()
      return false
    }
    const kind = KIND_BY_MARK_NAME[tcMark.type.name]
    if (current && current.kind === kind && current.to === pos &&
        current.mark.attrs.author === tcMark.attrs.author) {
      // Extend the in-progress range.
      current.to = pos + text.length
    } else {
      flush()
      current = { kind, from: pos, to: pos + text.length, mark: tcMark }
    }
    return false
  })
  flush()
  return out
}

/** Count tracked changes in the doc. O(n) walker; cheap to call on
 *  every render (the banner uses this to gate its mount). */
export function countTrackedChanges(doc: PMNode): number {
  return collectTrackedChanges(doc).length
}

/** Accept every tracked change in the doc per standard CriticMarkup
 *  semantics: insertion → keep text + strip mark; deletion → remove
 *  text; highlight → keep text + strip mark. Single transaction. */
export function acceptAllTrackedChanges(editor: Editor): number {
  if (!editor || editor.isDestroyed) return 0
  const ranges = collectTrackedChanges(editor.state.doc)
  if (ranges.length === 0) return 0
  const schema = editor.schema
  const insMark = schema.marks.insertionMark
  const delMark = schema.marks.deletionMark
  const hlMark = schema.marks.highlightMark

  const tr = editor.state.tr
  // Apply in REVERSE so earlier positions stay valid.
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]
    const from = tr.mapping.map(r.from)
    const to = tr.mapping.map(r.to)
    if (r.kind === 'insertion' && insMark) {
      tr.removeMark(from, to, insMark)
    } else if (r.kind === 'deletion' && delMark) {
      tr.delete(from, to)
    } else if (r.kind === 'highlight' && hlMark) {
      tr.removeMark(from, to, hlMark)
    }
  }
  if (tr.docChanged || tr.steps.length > 0) {
    editor.view.dispatch(tr)
  }
  return ranges.length
}

/** Reject every tracked change: insertion → drop text; deletion →
 *  keep text + strip mark; highlight → keep text + strip mark. */
export function rejectAllTrackedChanges(editor: Editor): number {
  if (!editor || editor.isDestroyed) return 0
  const ranges = collectTrackedChanges(editor.state.doc)
  if (ranges.length === 0) return 0
  const schema = editor.schema
  const insMark = schema.marks.insertionMark
  const delMark = schema.marks.deletionMark
  const hlMark = schema.marks.highlightMark

  const tr = editor.state.tr
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]
    const from = tr.mapping.map(r.from)
    const to = tr.mapping.map(r.to)
    if (r.kind === 'insertion' && insMark) {
      tr.delete(from, to)
    } else if (r.kind === 'deletion' && delMark) {
      tr.removeMark(from, to, delMark)
    } else if (r.kind === 'highlight' && hlMark) {
      tr.removeMark(from, to, hlMark)
    }
  }
  if (tr.docChanged || tr.steps.length > 0) {
    editor.view.dispatch(tr)
  }
  return ranges.length
}

/** Accept a single tracked-change range. Used by the per-suggestion
 *  rail rows in Phase 4e. */
export function acceptTrackedChange(editor: Editor, range: TrackedRange): boolean {
  if (!editor || editor.isDestroyed) return false
  const schema = editor.schema
  const tr = editor.state.tr
  if (range.kind === 'insertion' && schema.marks.insertionMark) {
    tr.removeMark(range.from, range.to, schema.marks.insertionMark)
  } else if (range.kind === 'deletion' && schema.marks.deletionMark) {
    tr.delete(range.from, range.to)
  } else if (range.kind === 'highlight' && schema.marks.highlightMark) {
    tr.removeMark(range.from, range.to, schema.marks.highlightMark)
  } else {
    return false
  }
  editor.view.dispatch(tr)
  return true
}

/** Reject a single tracked-change range. Used by Phase 4e. */
export function rejectTrackedChange(editor: Editor, range: TrackedRange): boolean {
  if (!editor || editor.isDestroyed) return false
  const schema = editor.schema
  const tr = editor.state.tr
  if (range.kind === 'insertion' && schema.marks.insertionMark) {
    tr.delete(range.from, range.to)
  } else if (range.kind === 'deletion' && schema.marks.deletionMark) {
    tr.removeMark(range.from, range.to, schema.marks.deletionMark)
  } else if (range.kind === 'highlight' && schema.marks.highlightMark) {
    tr.removeMark(range.from, range.to, schema.marks.highlightMark)
  } else {
    return false
  }
  editor.view.dispatch(tr)
  return true
}
