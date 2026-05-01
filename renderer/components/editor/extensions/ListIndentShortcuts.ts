// ENH-025 (v0.5.4) — ⌘[ / ⌘] outdent / indent for list items in the
// markdown editor. Mirrors Obsidian / Bear / Notion / VS Code muscle
// memory; ⇧Tab / Tab still work natively via TipTap's StarterKit
// keymap, but those collide with focus traversal and tab-character
// insertion in some surfaces, so the meta-bracket shortcuts give
// users an unambiguous indent affordance.
//
// Behavior:
//   - Inside a bulletList / orderedList / taskList → liftListItem /
//     sinkListItem on the appropriate node type (works for all three
//     list flavors via the `listItem` and `taskItem` types).
//   - Outside a list → no-op (returns false), so the keystroke
//     bubbles up to the renderer's capture-phase shortcut matcher.
//     Plain ⌘[ / ⌘] aren't claimed globally (only ⌘⇧[ / ⌘⇧] are),
//     so nothing else happens — matches Obsidian's "do nothing in
//     plain text" behavior. (Browser back/forward nav is already
//     suppressed by the WebContentsView keyboard forwarder, so we
//     don't need to worry about that surface.)
//
// We try `taskItem` first because TaskList's items are a separate
// node type from ListItem; if neither command applies, return false.

import { Extension } from '@tiptap/core'

export const ListIndentShortcuts = Extension.create({
  name: 'listIndentShortcuts',

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => {
        // Try task-item first (TaskList), then list-item (bullet/ordered).
        // `chain().run()` returns true if the chain dispatched a tr.
        const taskOk = this.editor.can().sinkListItem('taskItem')
        if (taskOk) return this.editor.chain().focus().sinkListItem('taskItem').run()
        const listOk = this.editor.can().sinkListItem('listItem')
        if (listOk) return this.editor.chain().focus().sinkListItem('listItem').run()
        return false
      },
      'Mod-[': () => {
        const taskOk = this.editor.can().liftListItem('taskItem')
        if (taskOk) return this.editor.chain().focus().liftListItem('taskItem').run()
        const listOk = this.editor.can().liftListItem('listItem')
        if (listOk) return this.editor.chain().focus().liftListItem('listItem').run()
        return false
      }
    }
  }
})
