// ENH-195 (D3) — pure ProseMirror diff for the markdown reload change-highlight.
//
// When a file the editor has open changes on disk and we reload it, the user
// wants to SEE what moved: which spans are new and where text was removed. We
// compute that diff structurally rather than over raw markdown bytes, so the
// highlight lands on real document positions the decoration layer can map.
//
// The mechanism: treat the reload as a single ReplaceStep that swaps the whole
// old document content for the new content, then let prosemirror-changeset's
// simplification pass condense that into the minimal set of inserted / deleted
// ranges (it compares document tokens and cancels the parts that didn't
// actually change). Every position we report (`fromB` / `toB`) is in NEW-doc
// ProseMirror coordinates — the coordinate space the freshly-reloaded editor
// state lives in.

import { ChangeSet } from '@tiptap/pm/changeset' // transitive dep of @tiptap/pm — DO NOT add to package.json
import { Slice, Node as PMNode } from '@tiptap/pm/model'
import { ReplaceStep } from '@tiptap/pm/transform'

export interface ReloadDiff {
  /** Inserted spans, in NEW-doc PM positions (`fromB`–`toB`). */
  inserted: { from: number; to: number }[]
  /** NEW-doc PM anchors where content was deleted (collapsed to a point). */
  deletedAt: number[]
  /** Inserted chars as a fraction of the new doc size — a "how big a change" signal. */
  changedFraction: number
}

/**
 * Diff two ProseMirror documents as if `oldDoc` were reloaded into `newDoc`.
 * Pure: no editor, no transaction, no side effects.
 */
export function computeReloadDiff(oldDoc: PMNode, newDoc: PMNode): ReloadDiff {
  // Model the reload as one whole-document replacement (old content → new
  // content), then let ChangeSet simplify it into the genuinely-changed ranges.
  const replace = new ReplaceStep(0, oldDoc.content.size, new Slice(newDoc.content, 0, 0))
  const cs = ChangeSet.create(oldDoc).addSteps(newDoc, [replace.getMap()], null)

  const inserted: { from: number; to: number }[] = []
  const deletedAt: number[] = []
  let insChars = 0

  for (const ch of cs.changes) {
    // Inserted span: content exists in the new doc for this change.
    if (ch.toB > ch.fromB) {
      inserted.push({ from: ch.fromB, to: ch.toB })
      insChars += ch.toB - ch.fromB
    }
    // Pure deletion: old content removed with nothing inserted in its place.
    // The deletion collapses to a single new-doc anchor (`fromB === toB`).
    if (ch.toA > ch.fromA && ch.toB === ch.fromB) {
      deletedAt.push(ch.fromB)
    }
  }

  // Guard divide-by-zero: an empty new doc is "fully changed" only if the old
  // doc had content to clear; otherwise nothing changed.
  const changedFraction =
    newDoc.content.size === 0
      ? oldDoc.content.size > 0
        ? 1
        : 0
      : insChars / newDoc.content.size

  return { inserted, deletedAt, changedFraction }
}
