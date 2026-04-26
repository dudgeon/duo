// Stage 17a polish item 3 — surface-agnostic action interface for the
// shared editor toolbar. Stage 11's MarkdownEditor builds an
// `EditorActions` from its TipTap editor; Stage 17a's CanvasTab builds
// one from iframe DOM-mutation primitives. The toolbar imports neither
// — it's pure presentation, dispatching through this interface.
//
// Reactivity model: actions themselves are stable (built once per host
// mount, or rebuilt only when the underlying editor instance changes).
// State-querying methods (`isActive`, `currentBlock`, `inTable`,
// `tableOps.canX`) are called fresh on every toolbar render. The host
// triggers re-renders by bumping a `selectionVersion` counter passed
// to the toolbar as a prop — same pattern TipTap's `useEditorState`
// achieves through its own subscription.

export type Mark =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'blockquote'
  | 'codeBlock'

export type BlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface TableOps {
  addRowBefore: () => void
  addRowAfter: () => void
  deleteRow: () => void
  addColumnBefore: () => void
  addColumnAfter: () => void
  deleteColumn: () => void
  toggleHeaderRow: () => void
  deleteTable: () => void
  // can-X queries drive the disabled state of contextual buttons.
  canAddRowBefore: () => boolean
  canAddRowAfter: () => boolean
  canDeleteRow: () => boolean
  canAddColumnBefore: () => boolean
  canAddColumnAfter: () => boolean
  canDeleteColumn: () => boolean
  canToggleHeaderRow: () => boolean
  canDeleteTable: () => boolean
}

/** Canvas-only buttons (PRD H28). MD passes `undefined`; toolbar hides. */
export interface CanvasExtras {
  insertComponent?: () => void   // 17e snippet menu
  toggleViewSource?: () => void  // 17e
  toggleLock?: () => void        // 17d
}

export interface EditorActions {
  // Inline marks — operate on the current selection.
  toggleBold: () => void
  toggleItalic: () => void
  toggleUnderline: () => void
  toggleStrike: () => void
  toggleCode: () => void

  // Block kinds + structure.
  setBlock: (kind: BlockKind) => void
  toggleBulletList: () => void
  toggleOrderedList: () => void
  toggleTaskList: () => void
  toggleBlockquote: () => void
  toggleCodeBlock: () => void
  insertHr: () => void
  insertTable: () => void   // 3x3 with header row by convention

  // Link picker.
  setLink: (url: string | null) => void   // null → unlink
  currentLinkHref: () => string | undefined

  // History.
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // State queries (called per render; toolbar re-renders on selectionVersion).
  isActive: (mark: Mark) => boolean
  currentBlock: () => BlockKind
  inTable: () => boolean

  // Optional contextual surfaces.
  tableOps?: TableOps
  extras?: CanvasExtras
}
