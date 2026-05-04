// Stage 17a polish item 4 — adapter that builds an `EditorActions`
// implementation for the HTML canvas. Sister to
// `editor/tiptapEditorActions.ts`. Both feed the same shared
// `EditorToolbar`. Composes the three primitive modules that exist
// in this directory:
//   - `inlineMarks.ts` — bold / italic / underline / strike / code,
//     link picker (PRD §8 — own selection-aware applicators)
//   - `blockOps.ts`    — headings, lists, blockquote, code block, hr,
//     table insert (mostly execCommand-backed for native undo capture)
//   - `tableOps.ts`    — contextual table strip (hand-rolled DOM)

import type { BlockKind, EditorActions, Mark } from '../editor/EditorActions'
import { applyLink, toggleInlineMark, type InlineTag } from './inlineMarks'
import * as blockOps from './blockOps'
import * as tableOps from './tableOps'

const MARK_TO_TAG: Record<'bold' | 'italic' | 'underline' | 'strike' | 'code', InlineTag> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code'
}

/** Optional host-supplied hooks. The actions object is built once per
 *  PageTab mount; selection-dependent state (canStartComment) lives
 *  behind a callback so the toolbar's per-render query reads CURRENT
 *  state without rebuilding the whole actions object. */
export interface PageEditorActionsOptions {
  /** Sprint 6 BUG-081 — fired when the toolbar Comment button is
   *  clicked, when ⌘⌥M is pressed, or when "Comment" is chosen from
   *  the canvas right-click menu. The host is responsible for opening
   *  the composer; the toolbar just signals intent. */
  startComment?: () => void
  /** Returns whether starting a comment is currently possible — typically
   *  "is there a non-empty selection inside an element with a
   *  data-duo-id ancestor?" The toolbar reads this on every render to
   *  drive the button's enabled state. */
  canStartComment?: () => boolean
}

/** Build canvas-side actions from a getter that returns the live iframe
 *  document. The getter is used (rather than a captured `Document`)
 *  because the iframe's contentDocument can technically change across
 *  navigation; reading it lazily means we never operate on a stale
 *  reference. */
export function buildPageEditorActions(
  getDoc: () => Document | null,
  opts?: PageEditorActionsOptions
): EditorActions {
  const withDoc = (fn: (doc: Document) => void): void => {
    const doc = getDoc()
    if (!doc) return
    // Ensure the iframe body has focus so the selection / commands land.
    doc.body.focus()
    fn(doc)
  }
  const queryDoc = <T>(fn: (doc: Document) => T, fallback: T): T => {
    const doc = getDoc()
    if (!doc) return fallback
    return fn(doc)
  }

  return {
    // marks (own implementations per PRD §8)
    toggleBold: () => withDoc(doc => toggleInlineMark(doc, MARK_TO_TAG.bold)),
    toggleItalic: () => withDoc(doc => toggleInlineMark(doc, MARK_TO_TAG.italic)),
    toggleUnderline: () => withDoc(doc => toggleInlineMark(doc, MARK_TO_TAG.underline)),
    toggleStrike: () => withDoc(doc => toggleInlineMark(doc, MARK_TO_TAG.strike)),
    toggleCode: () => withDoc(doc => toggleInlineMark(doc, MARK_TO_TAG.code)),

    // blocks
    setBlock: (kind: BlockKind) => withDoc(doc => blockOps.setBlock(doc, kind)),
    toggleBulletList: () => withDoc(blockOps.toggleBulletList),
    toggleOrderedList: () => withDoc(blockOps.toggleOrderedList),
    toggleTaskList: () => withDoc(blockOps.toggleTaskList),
    toggleBlockquote: () => withDoc(blockOps.toggleBlockquote),
    toggleCodeBlock: () => withDoc(blockOps.toggleCodeBlock),
    insertHr: () => withDoc(blockOps.insertHr),
    insertTable: () => withDoc(doc => blockOps.insertTable(doc, 3, 3, true)),

    // link
    setLink: (url) => withDoc(doc => applyLink(doc, url)),
    currentLinkHref: () => queryDoc(doc => {
      const sel = doc.getSelection()
      if (!sel || sel.rangeCount === 0) return undefined
      let cur: Node | null = sel.getRangeAt(0).startContainer
      while (cur && cur !== doc.body) {
        if (cur.nodeType === 1 && (cur as Element).tagName === 'A') {
          return ((cur as HTMLAnchorElement).href) || undefined
        }
        cur = cur.parentNode
      }
      return undefined
    }, undefined),

    // history (native execCommand undo stack — covers our DOM mutations
    // because they happen inside the contentEditable body)
    undo: () => withDoc(blockOps.undo),
    redo: () => withDoc(blockOps.redo),
    canUndo: () => queryDoc(blockOps.canUndo, false),
    canRedo: () => queryDoc(blockOps.canRedo, false),

    // state queries
    isActive: (mark: Mark) => queryDoc(doc => isMarkActive(doc, mark), false),
    currentBlock: () => queryDoc(blockOps.currentBlock, 'p'),
    inTable: () => queryDoc(blockOps.inTable, false),

    tableOps: {
      addRowBefore: () => withDoc(tableOps.addRowBefore),
      addRowAfter: () => withDoc(tableOps.addRowAfter),
      deleteRow: () => withDoc(tableOps.deleteRow),
      addColumnBefore: () => withDoc(tableOps.addColumnBefore),
      addColumnAfter: () => withDoc(tableOps.addColumnAfter),
      deleteColumn: () => withDoc(tableOps.deleteColumn),
      toggleHeaderRow: () => withDoc(tableOps.toggleHeaderRow),
      deleteTable: () => withDoc(tableOps.deleteTable),
      canAddRowBefore: () => queryDoc(tableOps.canAddRowBefore, false),
      canAddRowAfter: () => queryDoc(tableOps.canAddRowAfter, false),
      canDeleteRow: () => queryDoc(tableOps.canDeleteRow, false),
      canAddColumnBefore: () => queryDoc(tableOps.canAddColumnBefore, false),
      canAddColumnAfter: () => queryDoc(tableOps.canAddColumnAfter, false),
      canDeleteColumn: () => queryDoc(tableOps.canDeleteColumn, false),
      canToggleHeaderRow: () => queryDoc(tableOps.canToggleHeaderRow, false),
      canDeleteTable: () => queryDoc(tableOps.canDeleteTable, false)
    },

    // Sprint 6 BUG-081 — wire the host's Comment hooks through. Both
    // are pass-through; the toolbar reads canStartComment on every
    // render so it always sees current selection state.
    startComment: opts?.startComment,
    canStartComment: opts?.canStartComment
    // No `extras` yet — PRD H28's insertComponent / view-source / lock
    // arrive in 17d/e and will be wired here when those land.
  }
}

function isMarkActive(doc: Document, mark: Mark): boolean {
  const sel = doc.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  let cur: Node | null = sel.getRangeAt(0).startContainer

  // Tag-based marks
  const tagMap: Partial<Record<Mark, string>> = {
    bold: 'STRONG', italic: 'EM', underline: 'U', strike: 'S', code: 'CODE',
    link: 'A', blockquote: 'BLOCKQUOTE', codeBlock: 'PRE'
  }
  const wantedTag = tagMap[mark]
  if (wantedTag) {
    while (cur && cur !== doc.body) {
      if (cur.nodeType === 1 && (cur as Element).tagName === wantedTag) return true
      cur = cur.parentNode
    }
    return false
  }

  // Container-based marks
  if (mark === 'bulletList') return blockOps.isInList(doc, 'UL') && !blockOps.isInTaskList(doc)
  if (mark === 'orderedList') return blockOps.isInList(doc, 'OL')
  if (mark === 'taskList') return blockOps.isInTaskList(doc)
  return false
}
