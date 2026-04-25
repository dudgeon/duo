// Stage 11 — table keyboard shortcuts (PRD D12a).
// `⌥⇧↑/↓` insert row above/below, `⌥⇧←/→` insert column left/right.
// Active only when the cursor is inside a table — TipTap's commands return
// false otherwise, so the shortcut effectively no-ops outside tables.

import { Extension } from '@tiptap/core'

export const TableShortcuts = Extension.create({
  name: 'tableShortcuts',
  addKeyboardShortcuts() {
    return {
      'Alt-Shift-ArrowUp': () => this.editor.chain().focus().addRowBefore().run(),
      'Alt-Shift-ArrowDown': () => this.editor.chain().focus().addRowAfter().run(),
      'Alt-Shift-ArrowLeft': () => this.editor.chain().focus().addColumnBefore().run(),
      'Alt-Shift-ArrowRight': () => this.editor.chain().focus().addColumnAfter().run()
    }
  }
})
