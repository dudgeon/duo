// BUG-138 Phase 4d — helpers for accepting/rejecting CriticMarkup
// marks (insertions, deletions, highlights) in bulk.
//
// Comments are handled by the existing rail UX in
// `markdownComments.ts`; this module covers the track-changes triad
// (insertion / deletion / highlight) that Phase 4b/4c can stamp
// automatically when Suggesting is on.

import type { Editor } from '@tiptap/react'
import type { Mark, Node as PMNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { META_SUGGEST_AUTO } from './suggestMeta'

/**
 * Delete a tracked-change text range, collapsing the surrounding block when
 * the range is that block's *entire* content (ENH-195 D3, hardened for the
 * reload-diff accept/reject round-trip).
 *
 * Plain `tr.delete(from, to)` over the text of a whole paragraph leaves an
 * empty `<paragraph></paragraph>` shell behind — fine for an *inline*
 * suggestion (delete a few words inside a paragraph that survives), but wrong
 * when an entire block was inserted or struck (a whole-paragraph deletion, or
 * a destructive reload that swaps every block). There the block itself must
 * vanish. We detect "the marked text spans the block end-to-end" and delete
 * the whole block node (`before(depth)`–`after(depth)`) so it joins away
 * cleanly; otherwise we fall back to the plain text delete.
 *
 * This keeps `acceptAllTrackedChanges` / `rejectAllTrackedChanges` exact
 * inverses of `applyTrackedDiff` (`trackedDiff.ts`) for block-level changes,
 * and is a no-op behaviour change for the inline suggestions Phase 4b/4c
 * stamp (those never cover a block end-to-end together with its boundary).
 */
function deleteTrackedRange(tr: Transaction, from: number, to: number): void {
  const $from = tr.doc.resolve(from)
  const $to = tr.doc.resolve(to)
  const spansWholeBlock =
    $from.parent.isTextblock &&
    $from.sameParent($to) &&
    $from.parentOffset === 0 &&
    $to.parentOffset === $to.parent.content.size &&
    $from.depth > 0
  if (spansWholeBlock) {
    tr.delete($from.before($from.depth), $to.after($to.depth))
  } else {
    tr.delete(from, to)
  }
}

export interface TrackedRange {
  from: number
  to: number
  kind: 'insertion' | 'deletion' | 'highlight'
  author: string | null
  ts: string | null
  text: string
  // ENH-260 D7 — set when this deletion range is the "nested" state: text
  // still carries a pending InsertionMark AND a DeletionMark suggested by
  // (possibly) another author. `author` above is the DELETION mark's
  // author (who is proposing this range be removed), not the insertion's.
  // See PRD § 1 D7 and § 2 "Consumers".
  overInsertion?: boolean
}

/** Collect every tracked-change range in the doc. Adjacent
 *  same-mark spans collapse into one range. Comments are excluded —
 *  the existing comment rail surfaces those separately.
 *
 *  ENH-260 D7 — a text node can carry BOTH insertionMark and deletionMark
 *  (foreign-author deletion of a still-pending insertion). Such a run is
 *  classified as `kind: 'deletion'` with `overInsertion: true`, attributed
 *  to the DELETION mark's author (the insertion is the older, still-open
 *  suggestion; the deletion is the newer counter-suggestion this range
 *  represents). An overInsertion run only merges with an adjacent run that
 *  is ALSO overInsertion with the same deletion author — it never merges
 *  with a plain deletion or plain insertion neighbor. */
export function collectTrackedChanges(doc: PMNode): TrackedRange[] {
  const out: TrackedRange[] = []
  let current: { kind: TrackedRange['kind']; from: number; to: number; mark: Mark; overInsertion: boolean } | null = null

  const flush = () => {
    if (!current) return
    out.push({
      from: current.from,
      to: current.to,
      kind: current.kind,
      author: (current.mark.attrs.author as string | null) ?? null,
      ts: (current.mark.attrs.ts as string | null) ?? null,
      text: doc.textBetween(current.from, current.to, '\n', ' '),
      ...(current.overInsertion ? { overInsertion: true } : {})
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
    const insMark = node.marks.find(m => m.type.name === 'insertionMark')
    const delMark = node.marks.find(m => m.type.name === 'deletionMark')
    const hlMark = node.marks.find(m => m.type.name === 'highlightMark')

    let kind: TrackedRange['kind']
    let mark: Mark
    let overInsertion = false
    if (insMark && delMark) {
      // D7 nested state — classify as a deletion, authored by the
      // DeletionMark (the counter-suggestion this range represents).
      kind = 'deletion'
      mark = delMark
      overInsertion = true
    } else if (delMark) {
      kind = 'deletion'
      mark = delMark
    } else if (insMark) {
      kind = 'insertion'
      mark = insMark
    } else if (hlMark) {
      kind = 'highlight'
      mark = hlMark
    } else {
      flush()
      return false
    }

    if (current && current.kind === kind && current.to === pos &&
        current.overInsertion === overInsertion &&
        current.mark.attrs.author === mark.attrs.author) {
      // Extend the in-progress range.
      current.to = pos + text.length
    } else {
      flush()
      current = { kind, from: pos, to: pos + text.length, mark, overInsertion }
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
 *  text; highlight → keep text + strip mark. Single transaction.
 *
 *  ENH-260 D7 — an `overInsertion` deletion range (nested ins+del state)
 *  takes the SAME path as a plain deletion: accepting the deletion
 *  resolves both suggestions (the pending insertion never lands). */
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
      // Covers both plain deletions and overInsertion (D7) ranges.
      deleteTrackedRange(tr, from, to)
    } else if (r.kind === 'highlight' && hlMark) {
      tr.removeMark(from, to, hlMark)
    }
  }
  if (tr.docChanged || tr.steps.length > 0) {
    // D9 — this transaction deletes content programmatically; without the
    // meta the suggesting-mode reconciler would resurrect it as a new
    // tracked deletion of the just-removed text.
    tr.setMeta(META_SUGGEST_AUTO, true)
    editor.view.dispatch(tr)
  }
  return ranges.length
}

/** Reject every tracked change: insertion → drop text; deletion →
 *  keep text + strip mark; highlight → keep text + strip mark.
 *
 *  ENH-260 D7 — an `overInsertion` deletion range is different from a
 *  plain deletion here: reject-all rejects the underlying (still-pending)
 *  insertion TOO, so the text is deleted outright rather than just having
 *  its DeletionMark stripped. (Single-range reject, by contrast, restores
 *  the pending insertion — see `rejectTrackedChange`.) */
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
      deleteTrackedRange(tr, from, to)
    } else if (r.kind === 'deletion' && r.overInsertion && delMark) {
      // D7 — reject-all also rejects the nested pending insertion: delete
      // the text rather than just stripping the DeletionMark.
      deleteTrackedRange(tr, from, to)
    } else if (r.kind === 'deletion' && delMark) {
      tr.removeMark(from, to, delMark)
    } else if (r.kind === 'highlight' && hlMark) {
      tr.removeMark(from, to, hlMark)
    }
  }
  if (tr.docChanged || tr.steps.length > 0) {
    tr.setMeta(META_SUGGEST_AUTO, true)
    editor.view.dispatch(tr)
  }
  return ranges.length
}

/** Accept a single tracked-change range. Used by the per-suggestion
 *  rail rows in Phase 4e.
 *
 *  ENH-260 D7 — an `overInsertion` deletion range takes the SAME path as
 *  a plain deletion (deleteTrackedRange): accepting the deletion resolves
 *  both suggestions. */
export function acceptTrackedChange(editor: Editor, range: TrackedRange): boolean {
  if (!editor || editor.isDestroyed) return false
  const schema = editor.schema
  const tr = editor.state.tr
  if (range.kind === 'insertion' && schema.marks.insertionMark) {
    tr.removeMark(range.from, range.to, schema.marks.insertionMark)
  } else if (range.kind === 'deletion' && schema.marks.deletionMark) {
    // Covers both plain deletions and overInsertion (D7) ranges.
    deleteTrackedRange(tr, range.from, range.to)
  } else if (range.kind === 'highlight' && schema.marks.highlightMark) {
    tr.removeMark(range.from, range.to, schema.marks.highlightMark)
  } else {
    return false
  }
  tr.setMeta(META_SUGGEST_AUTO, true)
  editor.view.dispatch(tr)
  return true
}

/** Reject a single tracked-change range. Used by Phase 4e.
 *
 *  ENH-260 D7 — an `overInsertion` deletion range rejects ONLY the
 *  deletion suggestion: `removeMark` is scoped to `deletionMark`, so the
 *  InsertionMark stays intact and the pending insertion is restored. */
export function rejectTrackedChange(editor: Editor, range: TrackedRange): boolean {
  if (!editor || editor.isDestroyed) return false
  const schema = editor.schema
  const tr = editor.state.tr
  if (range.kind === 'insertion' && schema.marks.insertionMark) {
    deleteTrackedRange(tr, range.from, range.to)
  } else if (range.kind === 'deletion' && schema.marks.deletionMark) {
    // For overInsertion ranges this removes ONLY the DeletionMark,
    // leaving the InsertionMark (and the text) in place (D7).
    tr.removeMark(range.from, range.to, schema.marks.deletionMark)
  } else if (range.kind === 'highlight' && schema.marks.highlightMark) {
    tr.removeMark(range.from, range.to, schema.marks.highlightMark)
  } else {
    return false
  }
  tr.setMeta(META_SUGGEST_AUTO, true)
  editor.view.dispatch(tr)
  return true
}
