// BUG-137 — link editing in markdown editor was broken in two ways:
//
//   1. Typing `[text](url)` (markdown-link syntax) was NOT being parsed
//      — TipTap's @tiptap/extension-link ships no input rule for this.
//      Users had to highlight + ⌘K to make a link.
//
//   2. ⌘K had no editor-side keyboard handler. The toolbar button
//      hinted "Link (⌘K)" but pressing ⌘K from the editor was a no-op.
//
// This extension is a no-state companion to the Link extension that
// installs both an input rule + a keyboard shortcut. It lives next to
// Link in the editor's extension array.

import { Extension } from '@tiptap/core'
import { markInputRule } from '@tiptap/core'

/** Match `[text](url)` at the end of typed input. The trailing `)`
 *  triggers the rule. `text` is the link label; `url` is the href.
 *  Empty `text` is disallowed; empty `url` is allowed (e.g. `[label]()`
 *  for a placeholder link the user fills in later via ⌘K). */
const MARKDOWN_LINK_INPUT_RULE = /\[([^\]]+)\]\(([^)]*)\)$/

export const MarkdownLinkShortcuts = Extension.create({
  name: 'markdownLinkShortcuts',

  addInputRules() {
    const linkType = this.editor.schema.marks.link
    if (!linkType) return []
    return [
      markInputRule({
        find: MARKDOWN_LINK_INPUT_RULE,
        type: linkType,
        getAttributes: (match) => ({ href: match[2] || '' })
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      // ⌘K — open the link prompt. Uses window.prompt (same code path
      // as the toolbar's insertLink button). Pre-fills with the current
      // link's href when the selection sits on an existing link.
      'Mod-k': () => {
        const editor = this.editor
        const current = editor.getAttributes('link').href as string | undefined
        const url = window.prompt('Link URL', current ?? 'https://')
        if (url === null) return true // user cancelled — still consume the chord
        const trimmed = url.trim()
        if (trimmed === '') {
          editor.chain().focus().unsetLink().run()
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
        }
        return true
      }
    }
  }
})
