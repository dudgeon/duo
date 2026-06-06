// ENH-195 (D3) — "View diff" as accept/reject-able tracked changes.
//
// When a markdown file the editor has open is destructively overwritten on
// disk and we reload it, the user wants to SEE the old→new change as real
// tracked changes they can accept or reject with the editor's existing
// suggesting-mode machinery (the insertion / deletion marks + the bulk
// accept/reject helpers in `trackedChanges.ts`).
//
// `applyTrackedDiff` takes the just-reloaded doc (which already lives in
// `editor.state.doc` as `newDoc`) plus the PRE-reload doc the user had
// (`oldDoc`), and rewrites the editor doc IN PLACE — one dispatched
// transaction — into a tracked-changes view of `oldDoc → newDoc`:
//
//   • spans present in newDoc but not oldDoc  → wrapped in `insertionMark`
//   • spans present in oldDoc but not newDoc  → RE-INSERTED, struck, wrapped
//     in `deletionMark`, positioned just before the corresponding insertion
//     (reading order: struck-old, then new).
//
// The invariant (verified exhaustively in `trackedDiff.test.ts`): after
// `applyTrackedDiff`, `acceptAllTrackedChanges` reproduces `newDoc` exactly
// and `rejectAllTrackedChanges` reproduces `oldDoc` exactly (ProseMirror
// `Node.eq`). It is the exact inverse pair, for inline AND block-level edits.
//
// ── Why a block-level diff, not raw ChangeSet ranges ───────────────────────
// The obvious approach — run one `prosemirror-changeset` ChangeSet over the
// whole doc and `addMark`/`replace` its ranges — fails the round-trip for
// block-level changes. ChangeSet reports changed ranges over *inline* content;
// a region that spans several paragraphs comes back as ONE range whose
// endpoints fall INSIDE the first/last paragraph and exclude the
// paragraph-boundary tokens between them. Marking that range and then deleting
// the marked text (what accept/reject do) strands empty `<paragraph></…>`
// shells and orphans tokens shared across the boundary (e.g. a trailing "."
// common to old and new). Track-changes marks are text-only; a block boundary
// can't carry one.
//
// So we diff at the BLOCK level first (an LCS over top-level children by
// `Node.eq`), which gives clean whole-block insert / delete / keep units, and
// fall back to a per-block inline ChangeSet only for a block that was
// *replaced in place* by another of the same type (so its edits stay inside a
// single, surviving block boundary). Whole-block units are collapsed on
// accept/reject by `deleteTrackedRange` in `trackedChanges.ts` (deletes the
// block node, not just its text). The two together round-trip exactly.

import { Editor } from '@tiptap/react'
import { Slice, Fragment, Mark, Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import { reloadChangeSet } from './reloadDiff'

/** Recursively add `mark` to every text node in `fragment`, preserving block
 *  structure and open depths. Non-text nodes are copied with their (also
 *  marked) content; text nodes get `mark` unioned into their mark set. */
function markFragmentText(fragment: Fragment, mark: Mark): Fragment {
  const nodes: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      nodes.push(node.mark(mark.addToSet(node.marks)))
    } else {
      nodes.push(node.copy(markFragmentText(node.content, mark)))
    }
  })
  return Fragment.fromArray(nodes)
}

/** Shallow array of a node's direct children. */
function childArray(node: PMNode): PMNode[] {
  const out: PMNode[] = []
  node.forEach((child) => out.push(child))
  return out
}

/** A struck copy of `block` — every text node wrapped in `delMark`. */
function struck(block: PMNode, delMark: Mark): PMNode {
  return block.copy(markFragmentText(block.content, delMark))
}

/** An insertion-marked copy of `block` — every text node wrapped in `insMark`. */
function inserted(block: PMNode, insMark: Mark): PMNode {
  return block.copy(markFragmentText(block.content, insMark))
}

/**
 * Inline diff of two single textblocks of the same type that occupy the same
 * position (a block "replaced in place"). Returns ONE block whose inline
 * content carries the change inline: unchanged runs bare, new runs
 * `insMark`-ed, struck-old runs spliced in `delMark`-ed just before their
 * insertion. Because the change stays inside this one surviving block, no
 * block boundary is created or destroyed and the round-trip holds via the
 * plain text delete in accept/reject.
 */
function diffInlineBlock(oldBlock: PMNode, newBlock: PMNode, insMark: Mark, delMark: Mark): PMNode {
  const schema = oldBlock.type.schema
  const oldDoc = schema.node('doc', null, [oldBlock])
  const newDoc = schema.node('doc', null, [newBlock])
  const cs = reloadChangeSet(oldDoc, newDoc)

  // Operate on a one-block doc; mutate via a Transform (no EditorState needed).
  const tr = new Transform(newDoc)
  // REVERSE order so each change's positions stay valid as we splice.
  for (let i = cs.changes.length - 1; i >= 0; i--) {
    const ch = cs.changes[i]
    if (ch.toB > ch.fromB) tr.addMark(ch.fromB, ch.toB, insMark)
    if (ch.toA > ch.fromA) {
      const oldSlice = oldDoc.slice(ch.fromA, ch.toA)
      const marked = new Slice(
        markFragmentText(oldSlice.content, delMark),
        oldSlice.openStart,
        oldSlice.openEnd
      )
      // Insert struck-old just BEFORE the insertion at fromB.
      tr.replace(ch.fromB, ch.fromB, marked)
    }
  }
  // The single resulting block.
  return tr.doc.firstChild as PMNode
}

/**
 * Fraction of `newBlock` that is NOT shared with `oldBlock` (0 = identical
 * text, →1 = wholly different). Used to choose inline vs whole-block rendering
 * for a same-type block "replaced in place": a small edit reads best as an
 * inline diff; a wholesale rewrite reads as noise when char-interleaved
 * (`"Project statuMeeting notes report"`), so we strike the old block whole and
 * insert the new block whole instead.
 */
function blockChangedFraction(oldBlock: PMNode, newBlock: PMNode): number {
  const schema = oldBlock.type.schema
  const oldDoc = schema.node('doc', null, [oldBlock])
  const newDoc = schema.node('doc', null, [newBlock])
  const cs = reloadChangeSet(oldDoc, newDoc)
  let insChars = 0
  for (const ch of cs.changes) if (ch.toB > ch.fromB) insChars += ch.toB - ch.fromB
  return newDoc.content.size === 0 ? (oldDoc.content.size > 0 ? 1 : 0) : insChars / newDoc.content.size
}

// Above this much of a block changing, render it as a clean whole-block
// strike+insert rather than a char-level inline diff (too noisy for a rewrite).
const INLINE_DIFF_MAX_CHANGED = 0.5

type BlockOp =
  | { t: 'keep'; nw: PMNode }
  | { t: 'del'; old: PMNode }
  | { t: 'ins'; nw: PMNode }

/**
 * Longest-common-subsequence alignment of two block lists by `Node.eq`,
 * emitted as a keep/del/ins op stream in output order. Standard DP-LCS with a
 * deterministic tie-break (prefer deletions first) so a "replace" surfaces as
 * a del-run immediately followed by an ins-run — which `buildTrackedDoc`
 * zips into in-place inline diffs.
 */
function blockLcs(oldKids: PMNode[], newKids: PMNode[]): BlockOp[] {
  const m = oldKids.length
  const n = newKids.length
  // dp[i][j] = LCS length of oldKids[i..] vs newKids[j..].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldKids[i].eq(newKids[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: BlockOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (oldKids[i].eq(newKids[j])) {
      ops.push({ t: 'keep', nw: newKids[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', old: oldKids[i] })
      i++
    } else {
      ops.push({ t: 'ins', nw: newKids[j] })
      j++
    }
  }
  while (i < m) ops.push({ t: 'del', old: oldKids[i++] })
  while (j < n) ops.push({ t: 'ins', nw: newKids[j++] })
  return ops
}

/**
 * Build the tracked-changes document from `oldDoc` and `newDoc`. Walks the
 * block-level LCS; a del-run followed by an ins-run is zipped pairwise into
 * in-place inline diffs where the paired blocks share a type (otherwise the
 * old block is struck and the new block inserted as whole blocks). Pure: no
 * editor, no transaction.
 */
function buildTrackedDoc(
  oldDoc: PMNode,
  newDoc: PMNode,
  insMark: Mark,
  delMark: Mark
): PMNode {
  const ops = blockLcs(childArray(oldDoc), childArray(newDoc))
  const out: PMNode[] = []

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.t === 'keep') {
      out.push(op.nw)
      continue
    }
    if (op.t === 'ins') {
      out.push(inserted(op.nw, insMark))
      continue
    }
    // op.t === 'del' — gather the contiguous del-run, then the ins-run that
    // immediately follows it, and zip them as in-place replacements.
    const dels: PMNode[] = []
    while (k < ops.length && ops[k].t === 'del') {
      dels.push((ops[k] as { old: PMNode }).old)
      k++
    }
    const inss: PMNode[] = []
    while (k < ops.length && ops[k].t === 'ins') {
      inss.push((ops[k] as { nw: PMNode }).nw)
      k++
    }
    k-- // the outer loop will k++ past the run

    const pairs = Math.min(dels.length, inss.length)
    for (let p = 0; p < pairs; p++) {
      const sameTextblock = dels[p].type === inss[p].type && dels[p].isTextblock && inss[p].isTextblock
      // Inline diff only for a same-type block with a MODEST edit; a wholesale
      // rewrite renders as clean whole-block strike+insert (round-trips either way).
      if (sameTextblock && blockChangedFraction(dels[p], inss[p]) <= INLINE_DIFF_MAX_CHANGED) {
        out.push(diffInlineBlock(dels[p], inss[p], insMark, delMark))
      } else {
        out.push(struck(dels[p], delMark))
        out.push(inserted(inss[p], insMark))
      }
    }
    // Leftover unpaired deletions (struck) then insertions (marked).
    for (let p = pairs; p < dels.length; p++) out.push(struck(dels[p], delMark))
    for (let p = pairs; p < inss.length; p++) out.push(inserted(inss[p], insMark))
  }

  return newDoc.type.schema.node('doc', null, out)
}

/** Count the marked text nodes in a freshly-built tracked doc — a quick
 *  "did anything change?" gate (0 ⇒ identity reload). */
function countMarkedTextNodes(doc: PMNode, insMark: Mark, delMark: Mark): number {
  let count = 0
  doc.descendants((node) => {
    if (
      node.isText &&
      (insMark.isInSet(node.marks) || delMark.isInSet(node.marks))
    ) {
      count++
    }
    return true
  })
  return count
}

/**
 * Rewrite `editor.state.doc` (which IS `newDoc`, the just-reloaded disk
 * version) in place into a tracked-changes view of `oldDoc → newDoc`, in one
 * dispatched transaction. Returns the number of marked text spans stamped
 * (0 if the docs are identical or the suggesting marks are missing).
 *
 * @param editor  the live editor whose doc is `newDoc`
 * @param oldDoc  the PRE-reload (user's) doc, in the SAME schema as the editor
 * @param attrs   author / timestamp stamped onto every insertion + deletion mark
 */
export function applyTrackedDiff(
  editor: Editor,
  oldDoc: PMNode,
  attrs: { author: string | null; ts: string | null }
): number {
  if (!editor || editor.isDestroyed) return 0
  const insType = editor.schema.marks.insertionMark
  const delType = editor.schema.marks.deletionMark
  if (!insType || !delType) return 0

  const newDoc = editor.state.doc
  const insMark = insType.create(attrs)
  const delMark = delType.create(attrs)

  const tracked = buildTrackedDoc(oldDoc, newDoc, insMark, delMark)
  const stamped = countMarkedTextNodes(tracked, insMark, delMark)
  if (stamped === 0) return 0

  // Swap the whole doc content for the tracked-changes version, one dispatch.
  const tr = editor.state.tr.replaceWith(0, newDoc.content.size, tracked.content)
  if (tr.docChanged) editor.view.dispatch(tr)
  return stamped
}
