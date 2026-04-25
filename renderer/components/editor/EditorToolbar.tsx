// Stage 11 — top formatting toolbar (PRD D5, top-bar half) + contextual
// table controls (PRD D12a).
//
// Top row: heading picker + inline marks + link + list kinds + block kinds
// + table insert + undo/redo + save.
// Contextual second row: row/column/table operations, shown only when the
// cursor is inside a table. Keeps the primary toolbar stable; table work
// gets its own dense strip.

import { useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor | null
  onSave: () => void
  dirty: boolean
  saving: boolean
}

export function EditorToolbar({ editor, onSave, dirty, saving }: Props) {
  // Subscribe to selection-relevant state so active flags / context bar
  // re-render as the caret moves. Without this the toolbar is static and
  // the in-table indicator never flips.
  const state = useEditorState({
    editor,
    selector: (ctx) => {
      const ed = ctx.editor
      if (!ed) return null
      return {
        inTable: ed.isActive('table'),
        canAddColBefore: ed.can().addColumnBefore(),
        canAddColAfter: ed.can().addColumnAfter(),
        canDelCol: ed.can().deleteColumn(),
        canAddRowBefore: ed.can().addRowBefore(),
        canAddRowAfter: ed.can().addRowAfter(),
        canDelRow: ed.can().deleteRow(),
        canDelTable: ed.can().deleteTable(),
        canToggleHeaderRow: ed.can().toggleHeaderRow()
      }
    }
  })

  if (!editor) {
    return <div className="h-10 border-b border-border shrink-0 bg-surface-1" />
  }

  const currentHeading = (() => {
    for (let level = 1; level <= 6; level++) {
      if (editor.isActive('heading', { level })) return `h${level}`
    }
    if (editor.isActive('paragraph')) return 'p'
    return 'p'
  })()

  const setBlock = (v: string) => {
    if (v === 'p') {
      editor.chain().focus().setParagraph().run()
    } else {
      const level = parseInt(v.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6
      editor.chain().focus().toggleHeading({ level }).run()
    }
  }

  const insertLink = () => {
    const prev = editor.getAttributes('link')['href'] as string | undefined
    const url = window.prompt('Link URL', prev ?? 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  return (
    <div className="flex flex-col shrink-0 border-b border-border bg-surface-1">
    <div className="flex items-center h-10 gap-1 px-2 text-zinc-300 text-sm overflow-x-auto">
      <select
        value={currentHeading}
        onChange={(e) => setBlock(e.target.value)}
        className="bg-surface-2 border border-border rounded px-2 py-1 text-xs focus:outline-none focus:border-accent/60"
        title="Paragraph / Heading level"
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="h5">Heading 5</option>
        <option value="h6">Heading 6</option>
      </select>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (⌘B)">
        <span className="font-bold">B</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (⌘I)">
        <span className="italic">I</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (⌘U)">
        <span className="underline">U</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <span className="line-through">S</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code (⌘E)">
        <span className="font-mono text-xs">{'</>'}</span>
      </Btn>

      <Sep />

      <Btn onClick={insertLink} active={editor.isActive('link')} title="Link (⌘K)">
        <LinkIcon />
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
        <span className="font-bold">•</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <span className="text-xs">1.</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="Task list">
        <span className="text-xs">☐</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
        <span className="text-xs">❝</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block">
        <span className="font-mono text-xs">{'{}'}</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
        <span className="text-xs">—</span>
      </Btn>
      <Btn onClick={insertTable} title="Insert table">
        <TableIcon />
      </Btn>

      <Sep />

      <Btn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (⌘Z)">
        <span className="text-xs">↶</span>
      </Btn>
      <Btn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (⌘⇧Z)">
        <span className="text-xs">↷</span>
      </Btn>

      <div className="ml-auto flex items-center gap-3 pr-1 text-xs text-zinc-500">
        <span aria-live="polite">
          {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
        </span>
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="px-2 py-1 rounded border border-border hover:border-accent/60 text-zinc-300 disabled:opacity-40 disabled:hover:border-border"
          title="Save (⌘S)"
        >
          Save
        </button>
      </div>
    </div>
    {state?.inTable && (
      <div className="flex items-center h-9 gap-1 px-2 border-t border-border bg-surface-2 text-zinc-300 text-xs overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">Table</span>
        <Btn small onClick={() => editor.chain().focus().addRowBefore().run()} disabled={!state.canAddRowBefore} title="Insert row above (⌥⇧↑)">
          ↑＋
        </Btn>
        <Btn small onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!state.canAddRowAfter} title="Insert row below (⌥⇧↓)">
          ↓＋
        </Btn>
        <Btn small onClick={() => editor.chain().focus().deleteRow().run()} disabled={!state.canDelRow} title="Delete row">
          ✕row
        </Btn>
        <Sep />
        <Btn small onClick={() => editor.chain().focus().addColumnBefore().run()} disabled={!state.canAddColBefore} title="Insert column left (⌥⇧←)">
          ←＋
        </Btn>
        <Btn small onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!state.canAddColAfter} title="Insert column right (⌥⇧→)">
          →＋
        </Btn>
        <Btn small onClick={() => editor.chain().focus().deleteColumn().run()} disabled={!state.canDelCol} title="Delete column">
          ✕col
        </Btn>
        <Sep />
        <Btn small onClick={() => editor.chain().focus().toggleHeaderRow().run()} disabled={!state.canToggleHeaderRow} title="Toggle header row">
          Header
        </Btn>
        <Btn small onClick={() => editor.chain().focus().deleteTable().run()} disabled={!state.canDelTable} title="Delete table">
          ✕table
        </Btn>
      </div>
    )}
    </div>
  )
}

function Btn({
  onClick, active, disabled, title, children, small
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
  small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        small
          ? 'min-w-7 h-6 px-1.5 flex items-center justify-center rounded text-[11px]'
          : 'w-7 h-7 flex items-center justify-center rounded',
        'hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent',
        active ? 'bg-surface-3 text-accent' : 'text-zinc-300'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="w-px h-5 bg-border mx-1" />
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}
