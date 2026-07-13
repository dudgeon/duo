// ENH-260 — the pure suggesting-mode reconciliation kernel.
//
// Package S1 (see docs/prd/enh-260-track-changes-composition.md § 2 + § 4).
// Everything here is a pure ProseMirror function: no `Editor`, no TipTap
// dependency, no dispatch. `extensions/SuggestingMode.ts` (package S4) is a
// thin plugin that delegates its `appendTransaction` to `buildSuggestionTr`
// and only owns UI-adjacent concerns (recording keydown direction, the D4
// caret-skip on an intact deletion-run edge).
//
// Locked decisions this file implements (PRD § 1):
//   D1  — "own" insertion = author null OR === currentAuthor (net-zero delete).
//   D3  — typing inside a tracked deletion relocates to just after the run,
//         caret after it; inserted text never inherits a DeletionMark.
//   D4  — `findDeletionRun` is the shared primitive the plugin uses for the
//         caret-skip; also used here to detect a D3 relocate.
//   D7  — deleting a FOREIGN pending insertion keeps both marks (nested
//         cross-author state); accept resolves both, reject restores the
//         pending insertion (consumers: trackedChanges.ts, package S3).
//   D8  — a deletion whose slice has no text (pure structural / boundary
//         removal) passes untracked; CriticMarkup can't carry it.
//   D9  — programmatic transactions opt out via META_SUGGEST_AUTO /
//         addToHistory:false / preventUpdate / history plugin metas.
//   D10 — fenced code blocks and inline `code` spans are untracked; the
//         reconciler skips ranges the marks can't legally apply to.

import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Selection } from '@tiptap/pm/state'
import type { Mark, MarkType, Node as PMNode, ResolvedPos } from '@tiptap/pm/model'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Mapping, ReplaceStep, ReplaceAroundStep } from '@tiptap/pm/transform'
import { markFragmentText } from './trackedDiff'
import { META_SUGGEST_AUTO } from './suggestMeta'

export type DeleteDirection = 'backspace' | 'forward' | null

/** D1 policy: a suggestion mark is "own" when its author attr is null
 *  (unattributed — treated as belonging to whoever's editing now) or
 *  equals `currentAuthor`. Only a different, non-null author is foreign. */
export function isOwnSuggestionMark(author: string | null, currentAuthor: string): boolean {
  return author === null || author === currentAuthor
}

/** Marks of the single character occupying `[from, to)` — i.e. the text
 *  node that overlaps that one-position-wide slot — or null if that slot
 *  isn't (fully) inside a text node (block boundary, doc edge). Used by
 *  `findDeletionRun` to test/expand a run one character at a time. */
function charMarks(doc: PMNode, from: number, to: number): readonly Mark[] | null {
  if (from < 0 || to > doc.content.size || to <= from) return null
  let marks: readonly Mark[] | null = null
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isText) {
      marks = node.marks
      found = true
      return false
    }
    // A container (block) ancestor overlapping the slot — recurse into it
    // looking for the actual text leaf; `nodesBetween` calls back for every
    // ancestor on the way down, not just leaves.
    return true
  })
  return found ? marks : null
}

/**
 * The contiguous run of deletionMark-ed text containing or abutting `pos`,
 * or null if `pos` doesn't sit at/inside such a run. Used by the plugin for
 * D4 caret-skip, and here for the D3 "insertion split a deletion run"
 * relocate check.
 *
 * `direction: 'backspace'` looks at the character ENDING at `pos` (i.e.
 * `[pos - 1, pos)` — "the char Backspace would delete"); `'forward'` looks
 * at the character STARTING at `pos` (`[pos, pos + 1)` — "the char Delete
 * would delete"). Either direction, once a marked character is found, the
 * run is expanded both ways to its full contiguous extent.
 */
export function findDeletionRun(
  doc: PMNode,
  pos: number,
  direction: 'backspace' | 'forward'
): { from: number, to: number } | null {
  const delType = doc.type.schema.marks.deletionMark
  if (!delType) return null

  const anchorFrom = direction === 'backspace' ? pos - 1 : pos
  const anchorTo = anchorFrom + 1
  const anchorMarks = charMarks(doc, anchorFrom, anchorTo)
  if (!anchorMarks || !delType.isInSet(anchorMarks)) return null

  let from = anchorFrom
  while (from > 0) {
    const marks = charMarks(doc, from - 1, from)
    if (marks && delType.isInSet(marks)) from--
    else break
  }
  let to = anchorTo
  while (to < doc.content.size) {
    const marks = charMarks(doc, to, to + 1)
    if (marks && delType.isInSet(marks)) to++
    else break
  }
  return { from, to }
}

/**
 * Invariant checker (PRD § 2). A text node may legally carry BOTH
 * insertionMark and deletionMark ONLY in the sanctioned D7 state: a
 * pending insertion by one (non-null) author, struck by a DIFFERENT
 * author. Any other double-marked state — same author on both, or an
 * unattributed (null) insertion author — is a bug (should have net-zeroed
 * per D1 instead of double-marking). Returns the violating ranges.
 */
export function checkSuggestionInvariant(doc: PMNode): Array<{ from: number, to: number, text: string }> {
  const violations: Array<{ from: number, to: number, text: string }> = []
  const schema = doc.type.schema
  const insType = schema.marks.insertionMark
  const delType = schema.marks.deletionMark
  if (!insType || !delType) return violations

  doc.descendants((node, pos) => {
    if (!node.isText) return true
    const insMark = insType.isInSet(node.marks)
    const delMark = delType.isInSet(node.marks)
    if (insMark && delMark) {
      const insAuthor = (insMark.attrs.author as string | null) ?? null
      const delAuthor = (delMark.attrs.author as string | null) ?? null
      if (insAuthor === null || insAuthor === delAuthor) {
        violations.push({ from: pos, to: pos + node.nodeSize, text: node.text ?? '' })
      }
    }
    return true
  })
  return violations
}

/** True when `$pos` sits inside a `codeBlock` ancestor (any depth). */
function isInCodeBlock($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'codeBlock') return true
  }
  return false
}

/** True when `fragment` contains at least one non-empty text character,
 *  anywhere in its (possibly nested) content. D8 — a slice with no text
 *  can't carry a CriticMarkup deletion mark, so it passes untracked. */
function fragmentHasText(fragment: Fragment): boolean {
  let has = false
  fragment.forEach((node) => {
    if (has) return
    if (node.isText) {
      if (node.text && node.text.length > 0) has = true
    } else if (node.content.size > 0) {
      if (fragmentHasText(node.content)) has = true
    }
  })
  return has
}

/**
 * True when EVERY text character in `fragment` sits in a code context
 * (inline `code` mark or codeBlock ancestry). D10 — a deletion entirely
 * inside code must behave as an untracked NATIVE edit (the character is
 * actually removed), not merely "unmarked". Reinstating a whole-code slice
 * verbatim (the per-node "keep bare" rule below) would silently UNDO the
 * user's Backspace — reinstate-verbatim only makes sense for a MIXED slice
 * (code sitting alongside trackable content that legitimately needs
 * striking); this whole-fragment check is the bypass that keeps a
 * pure-code deletion a real deletion, mirroring the insertion-side
 * codeBlock/inline-code skip in the original appendTransaction.
 */
function fragmentIsAllCode(fragment: Fragment, codeMarkType: MarkType | undefined, inCode: boolean): boolean {
  let allCode = true
  fragment.forEach((node) => {
    if (!allCode) return
    if (node.isText) {
      if (!node.text || node.text.length === 0) return
      const hasCode = inCode || (codeMarkType ? !!codeMarkType.isInSet(node.marks) : false)
      if (!hasCode) allCode = false
      return
    }
    if (node.content.size === 0) return
    const childInCode = inCode || node.type.name === 'codeBlock'
    if (!fragmentIsAllCode(node.content, codeMarkType, childInCode)) allCode = false
  })
  return allCode
}

/**
 * Recursively transform a deleted slice's fragment per PRD § 2:
 *   - own insertion (D1)              → DROP (net-zero)
 *   - foreign insertion (D7)          → KEEP, ADD deletionMark
 *   - already deletionMark'ed         → KEEP as-is (preserve original author)
 *   - inline `code` mark / codeBlock  → KEEP as-is bare (D10, untracked)
 *   - plain text                      → ADD deletionMark
 * Non-text nodes recurse into their content, preserving structure; `inCode`
 * tracks codeBlock ancestry (ambient, since a deletion fully inside a
 * codeBlock's inline content won't include the codeBlock node itself in
 * the sliced fragment).
 */
function transformDeletedFragment(
  fragment: Fragment,
  currentAuthor: string,
  insMarkType: MarkType,
  delMarkType: MarkType,
  codeMarkType: MarkType | undefined,
  inCode: boolean
): Fragment {
  const out: PMNode[] = []
  fragment.forEach((node) => {
    if (node.isText) {
      const insMark = insMarkType.isInSet(node.marks)
      if (insMark && isOwnSuggestionMark((insMark.attrs.author as string | null) ?? null, currentAuthor)) {
        // D1 — own pending insertion, deleted: net-zero. Drop it.
        return
      }
      if (insMark) {
        // D7 — foreign pending insertion, deleted: keep both marks.
        const delMark = delMarkType.create({ author: currentAuthor, ts: null })
        out.push(markFragmentText(Fragment.from(node), delMark).firstChild as PMNode)
        return
      }
      const existingDelMark = delMarkType.isInSet(node.marks)
      if (existingDelMark) {
        // Already a pending deletion: keep as-is, preserve original author.
        out.push(node)
        return
      }
      const hasCode = inCode || (codeMarkType ? !!codeMarkType.isInSet(node.marks) : false)
      if (hasCode) {
        // D10 — code contexts are untracked; keep the text bare.
        out.push(node)
        return
      }
      // Plain text: strike it.
      const delMark = delMarkType.create({ author: currentAuthor, ts: null })
      out.push(markFragmentText(Fragment.from(node), delMark).firstChild as PMNode)
      return
    }
    // Non-text (structural) node — recurse, preserving the node itself.
    const childInCode = inCode || node.type.name === 'codeBlock'
    out.push(node.copy(transformDeletedFragment(node.content, currentAuthor, insMarkType, delMarkType, codeMarkType, childInCode)))
  })
  return Fragment.fromArray(out)
}

/**
 * The reconciler (PRD § 2 + D1/D3/D7/D8/D9/D10). Walks every qualifying
 * user transaction's steps, in order, and builds one appended transaction
 * on `newState.tr` that:
 *   - reinstates (struck) any text a step removed, EXCEPT own pending
 *     insertions (net-zero) and text with no characters at all (D8);
 *   - stamps insertionMark on any text a step inserted, strips any
 *     inherited deletionMark, and relocates an insertion that landed
 *     strictly inside a deletion run to just after the run (D3).
 * Returns null when nothing needs to change (including all the D9 skip
 * guards below).
 */
export function buildSuggestionTr(
  oldState: EditorState,
  transactions: readonly Transaction[],
  newState: EditorState,
  currentAuthor: string,
  deleteDirection: DeleteDirection
): Transaction | null {
  // D9 — skip guards over the WHOLE batch.
  if (!transactions.some(tr => tr.docChanged)) return null
  if (transactions.some(tr => !!tr.getMeta(META_SUGGEST_AUTO))) return null
  if (transactions.some(tr => tr.getMeta('addToHistory') === false)) return null
  if (transactions.some(tr => !!tr.getMeta('preventUpdate'))) return null
  if (transactions.some(tr => tr.getMeta('history$') !== undefined)) return null

  const insMarkType = newState.schema.marks.insertionMark
  const delMarkType = newState.schema.marks.deletionMark
  if (!insMarkType || !delMarkType) return null
  const codeMarkType = newState.schema.marks.code

  const outTr = newState.tr
  let modified = false
  let hadInsertionSegment = false
  let lastReinstateAnchor: number | null = null
  let lastReinstateSize = 0

  for (let k = 0; k < transactions.length; k++) {
    const userTr = transactions[k]
    for (let i = 0; i < userTr.steps.length; i++) {
      const step = userTr.steps[i]
      if (!(step instanceof ReplaceStep) && !(step instanceof ReplaceAroundStep)) continue
      const map = step.getMap()

      // Mapping from "the doc right after this step" (tr.docs[i + 1], the
      // coordinate space `newStart`/`newEnd` below are given in) forward to
      // `newState.doc` — the remaining steps of THIS tr, plus every step of
      // any LATER tr in the batch.
      const remainingStepMaps = userTr.steps.slice(i + 1).map(s => s.getMap())
      const laterTrStepMaps = transactions.slice(k + 1).flatMap(t => t.steps.map(s => s.getMap()))
      const restMapping = new Mapping([...remainingStepMaps, ...laterTrStepMaps])

      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        const isDeletionSeg = oldEnd > oldStart
        const isInsertionSeg = newEnd > newStart

        // Anchor point(s) in `newState.doc` coordinates. For a plain
        // ReplaceStep, `newStart === oldStart` mapped forward (the step
        // doesn't shift the point where the replacement begins).
        const finalStart = restMapping.map(newStart, 1)
        const finalEnd = restMapping.map(newEnd, -1)

        // ---- Deletions: reinstate struck content BEFORE the insertion ----
        if (isDeletionSeg) {
          const beforeDoc = userTr.docs[i]
          const deletedSlice = beforeDoc.slice(oldStart, oldEnd)
          const hasText = fragmentHasText(deletedSlice.content)
          const $anchor = beforeDoc.resolve(oldStart)
          const ambientInCode = isInCodeBlock($anchor)
          // D8 (no text at all) and D10-whole-range (all of it is code) both
          // bypass reinstatement entirely — the native removal stands.
          if (hasText && !fragmentIsAllCode(deletedSlice.content, codeMarkType, ambientInCode)) {
            const transformedFragment = transformDeletedFragment(
              deletedSlice.content, currentAuthor, insMarkType, delMarkType, codeMarkType, ambientInCode
            )
            const isSimpleTextSlice =
              deletedSlice.openStart === 0 &&
              deletedSlice.openEnd === 0 &&
              deletedSlice.content.childCount === 1 &&
              !!deletedSlice.content.firstChild?.isText
            if (!(transformedFragment.size === 0 && isSimpleTextSlice)) {
              const reinstateSlice = new Slice(transformedFragment, deletedSlice.openStart, deletedSlice.openEnd)
              const curAnchor = outTr.mapping.map(finalStart, -1)
              outTr.replace(curAnchor, curAnchor, reinstateSlice)
              modified = true
              if (!isInsertionSeg) {
                lastReinstateAnchor = finalStart
                lastReinstateSize = reinstateSlice.size
              }
            }
          }
        }

        // ---- Insertions: stamp insertionMark, strip inherited deletion ----
        if (isInsertionSeg) {
          hadInsertionSegment = true
          const curStart = outTr.mapping.map(finalStart, 1)
          const curEnd = outTr.mapping.map(finalEnd, -1)
          if (curEnd > curStart) {
            // Port of the original appendTransaction skip rules verbatim:
            // bail when the whole inserted range sits inside a codeBlock,
            // or is entirely inline-`code`-marked (mixed ranges stamp
            // unconditionally — the schema's own `excludes` refuses the
            // mark on the code-marked fragments for us).
            let skip = false
            let sawCodeText = false
            let sawNonCodeText = false
            outTr.doc.nodesBetween(curStart, curEnd, (node) => {
              if (node.type.name === 'codeBlock') {
                skip = true
                return false
              }
              if (node.isText) {
                if (codeMarkType && codeMarkType.isInSet(node.marks)) sawCodeText = true
                else sawNonCodeText = true
              }
              return !skip
            })
            if (sawCodeText && !sawNonCodeText) skip = true

            if (!skip) {
              outTr.addMark(curStart, curEnd, insMarkType.create({ author: currentAuthor, ts: null }))
              outTr.removeMark(curStart, curEnd, delMarkType)
              modified = true

              // D3 — did the insertion land strictly inside a contiguous
              // deletion run? Check both edges AFTER stripping the
              // inherited deletionMark: if both sides are still (now
              // disjoint) deletion runs abutting our range exactly, the
              // insertion split what used to be one run — relocate.
              const backRun = findDeletionRun(outTr.doc, curStart, 'backspace')
              const fwdRun = findDeletionRun(outTr.doc, curEnd, 'forward')
              if (backRun && fwdRun && backRun.to === curStart && fwdRun.from === curEnd) {
                const insertedSlice = outTr.doc.slice(curStart, curEnd)
                outTr.delete(curStart, curEnd)
                const targetPos = outTr.mapping.map(fwdRun.to, -1)
                outTr.insert(targetPos, insertedSlice.content)
                const afterPos = targetPos + insertedSlice.content.size
                outTr.setSelection(Selection.near(outTr.doc.resolve(afterPos), 1))
              }
            }
          }
        }
      })
    }
  }

  if (!modified) return null

  // Caret placement (D3/D4 support) — only for a batch that was a PURE
  // deletion (no insertion segment anywhere) that reinstated something. A
  // relocate (above) already set its own selection; an insertion-bearing
  // batch otherwise keeps the doc's natural (mapped) selection.
  if (!hadInsertionSegment && lastReinstateAnchor !== null && deleteDirection) {
    const from = outTr.mapping.map(lastReinstateAnchor, -1)
    const to = from + lastReinstateSize
    if (deleteDirection === 'backspace') {
      outTr.setSelection(Selection.near(outTr.doc.resolve(from), -1))
    } else if (deleteDirection === 'forward') {
      outTr.setSelection(Selection.near(outTr.doc.resolve(to), 1))
    }
  }

  outTr.setMeta(META_SUGGEST_AUTO, true)
  return outTr
}
