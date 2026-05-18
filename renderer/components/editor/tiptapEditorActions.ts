// Stage 17a polish item 3 — adapter that builds an `EditorActions`
// implementation from a TipTap `Editor` instance. Sister to
// `HtmlCanvas/canvasEditorActions.ts`. Both feed the same shared
// `EditorToolbar`.

import type { Editor } from '@tiptap/react'
import type { BlockKind, EditorActions, Mark } from './EditorActions'

/** Sprint 6 Phase 4 / MISSING-001 — host-supplied hooks that wire the
 *  toolbar's Comment button to the markdown editor's commentMark
 *  pipeline. canStartComment runs on every toolbar render so the
 *  enabled state tracks the live selection (toolbarVersion bumps on
 *  selectionUpdate / update). startComment is a stable closure that
 *  the host points at the latest handleStartNewComment via a ref. */
export interface TiptapEditorActionsOptions {
  startComment?: () => void
  canStartComment?: () => boolean
  /** BUG-138 Phase 4 — Suggesting mode hooks. `suggestingOn` is read
   *  on every toolbar render (toolbarVersion bumps cover the state
   *  change); `toggleSuggesting` flips the per-doc state in the
   *  sidecar. Optional so hosts without track-changes UX can leave
   *  the toolbar button hidden. */
  suggestingOn?: boolean
  toggleSuggesting?: () => void
}

export function buildTiptapEditorActions(
  editor: Editor,
  opts?: TiptapEditorActionsOptions
): EditorActions {
  return {
    toggleBold: () => editor.chain().focus().toggleBold().run(),
    toggleItalic: () => editor.chain().focus().toggleItalic().run(),
    toggleUnderline: () => editor.chain().focus().toggleUnderline().run(),
    toggleStrike: () => editor.chain().focus().toggleStrike().run(),
    toggleCode: () => editor.chain().focus().toggleCode().run(),

    setBlock: (kind: BlockKind) => {
      if (kind === 'p') {
        editor.chain().focus().setParagraph().run()
      } else {
        const level = parseInt(kind.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6
        editor.chain().focus().toggleHeading({ level }).run()
      }
    },
    toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
    toggleOrderedList: () => editor.chain().focus().toggleOrderedList().run(),
    toggleTaskList: () => editor.chain().focus().toggleTaskList().run(),
    toggleBlockquote: () => editor.chain().focus().toggleBlockquote().run(),
    toggleCodeBlock: () => editor.chain().focus().toggleCodeBlock().run(),
    insertHr: () => editor.chain().focus().setHorizontalRule().run(),
    insertTable: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),

    setLink: (url) => {
      if (url === null) {
        editor.chain().focus().unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
      }
    },
    currentLinkHref: () => editor.getAttributes('link')['href'] as string | undefined,

    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    canUndo: () => editor.can().undo(),
    canRedo: () => editor.can().redo(),

    isActive: (mark: Mark) => editor.isActive(mark),
    currentBlock: (): BlockKind => {
      for (let level = 1; level <= 6; level++) {
        if (editor.isActive('heading', { level })) {
          return (`h${level}`) as BlockKind
        }
      }
      return 'p'
    },
    inTable: () => editor.isActive('table'),

    tableOps: {
      addRowBefore: () => editor.chain().focus().addRowBefore().run(),
      addRowAfter: () => editor.chain().focus().addRowAfter().run(),
      deleteRow: () => editor.chain().focus().deleteRow().run(),
      addColumnBefore: () => editor.chain().focus().addColumnBefore().run(),
      addColumnAfter: () => editor.chain().focus().addColumnAfter().run(),
      deleteColumn: () => editor.chain().focus().deleteColumn().run(),
      toggleHeaderRow: () => editor.chain().focus().toggleHeaderRow().run(),
      deleteTable: () => editor.chain().focus().deleteTable().run(),
      canAddRowBefore: () => editor.can().addRowBefore(),
      canAddRowAfter: () => editor.can().addRowAfter(),
      canDeleteRow: () => editor.can().deleteRow(),
      canAddColumnBefore: () => editor.can().addColumnBefore(),
      canAddColumnAfter: () => editor.can().addColumnAfter(),
      canDeleteColumn: () => editor.can().deleteColumn(),
      canToggleHeaderRow: () => editor.can().toggleHeaderRow(),
      canDeleteTable: () => editor.can().deleteTable()
    },
    // No `extras` — those are canvas-only (PRD H28).
    // Sprint 6 Phase 4 / MISSING-001 — comment hooks.
    startComment: opts?.startComment,
    canStartComment: opts?.canStartComment,
    // BUG-138 Phase 4 — Suggesting mode hooks.
    suggestingOn: opts?.suggestingOn,
    toggleSuggesting: opts?.toggleSuggesting
  }
}
