// BUG-060 (v0.6.3) — fenced code block on Enter.
//
// TipTap's CodeBlock / CodeBlockLowlight extensions ship with a
// `textblockTypeInputRule` that fires on the trailing whitespace of
// the fence line:
//
//   /^```([a-z]+)?[\s\n]$/
//
// In practice that means typing `\`\`\`javascript ` (with trailing
// SPACE) converts the paragraph to a code block — same pattern as
// `# ` → heading, `> ` → blockquote, etc. The leftover space is
// fine; it's the convention the markdown plugin assumes.
//
// What users actually do: type `\`\`\`javascript` then press Enter,
// expecting the code block to materialize on the new line. PM input
// rules don't run on Enter (Enter is consumed by `splitBlock` in the
// keymap layer before input rules see it), so nothing happens — the
// triple-backticks stay literal text. Reported as BUG-060.
//
// Fix: a small extension that hooks the Enter keymap, scans the
// paragraph the cursor is at, and converts to codeBlock if the line
// matches `^\`\`\`(\w*)$`. Returns true (consuming the Enter) on
// match — TipTap's keymap chain stops there. Returns false on
// miss — Enter bubbles to default `splitBlock` behavior unchanged.
//
// Tilde fences (~~~) are documented but rarely used in practice;
// pattern is identical, so we cover both. Closing fences are NOT
// handled here — once you're inside a code block, Enter just adds
// a newline (TipTap's default), which is what the user wants. Exit
// the code block via Mod-Enter (built into CodeBlock extension).

import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

const FENCE_REGEX = /^(```|~~~)([a-z0-9-]*)$/i

export const FencedCodeBlockEnter = Extension.create({
  name: 'fencedCodeBlockEnter',

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { editor } = this
        const { state } = editor
        const { selection, schema } = state
        const { $from } = selection

        // Only fire at the end of a top-level paragraph. If we're
        // already inside a codeBlock (or anywhere else), let the
        // default Enter handler run.
        if ($from.parent.type.name !== 'paragraph') return false

        const text = $from.parent.textContent
        const match = FENCE_REGEX.exec(text)
        if (!match) return false

        const codeBlockType = schema.nodes.codeBlock
        if (!codeBlockType) return false

        const language = match[2] || null
        const tr = state.tr

        // Replace the paragraph wholesale with an empty codeBlock of
        // the matched language. The cursor lands inside the new
        // codeBlock so the next keystroke goes there.
        const paragraphStart = $from.before($from.depth)
        const paragraphEnd = $from.after($from.depth)

        tr.replaceWith(
          paragraphStart,
          paragraphEnd,
          codeBlockType.create(language ? { language } : null)
        )

        // Place cursor inside the new (empty) codeBlock. The codeBlock
        // is at `paragraphStart`; its content position is +1.
        const newPos = paragraphStart + 1
        tr.setSelection(TextSelection.near(tr.doc.resolve(newPos)))

        editor.view.dispatch(tr)
        return true
      }
    }
  }
})
