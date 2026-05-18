// BUG-137 — link editing in markdown editor.
//
// v1 (Sprint 18) wired an input rule + ⌘K via TipTap's `markInputRule`.
// Two bugs surfaced during the smoke walk:
//   1. The displayed link text was the URL, not the bracketed label.
//      Root cause: `markInputRule` picks the LAST capture group as the
//      retained text and discards the rest. My regex captured
//      `[(text), (url)]` → url was the kept text.
//   2. (Reported) ⌘K was a no-op. The handler IS registered + reachable
//      from PM's keymap; bumping the extension priority above StarterKit
//      keeps it from being shadowed by other Mod-k bindings if they
//      land in the future. The Link extension itself ships no Mod-k.
//
// v2 (Sprint 18 walk-1 follow-up) uses a custom `InputRule` that
// REPLACES the matched `[text](url)` with just `text`, applies the
// link mark with `href=url`, and consumes the trailing `)`. The ⌘K
// handler is unchanged but the extension priority is bumped to 1000
// so it's evaluated before any peer extension's Mod-k.

import { Extension, InputRule } from '@tiptap/core'

/** Match `[text](url)` at the end of typed input. The trailing `)`
 *  triggers the rule. `text` is the link label; `url` is the href.
 *  Empty `text` is disallowed; empty `url` is allowed (e.g. `[label]()`
 *  for a placeholder the user fills in later via ⌘K). */
const MARKDOWN_LINK_INPUT_RULE = /\[([^\]]+)\]\(([^)]*)\)$/

export const MarkdownLinkShortcuts = Extension.create({
  name: 'markdownLinkShortcuts',
  // BUG-137 walk-1 follow-up — bump priority so Mod-k reaches our
  // handler before any other extension binds the same chord. Higher
  // priority = evaluated first by TipTap's keymap.
  priority: 1000,

  addInputRules() {
    const linkType = this.editor.schema.marks.link
    if (!linkType) return []
    return [
      new InputRule({
        find: MARKDOWN_LINK_INPUT_RULE,
        handler: ({ state, range, match }) => {
          const text = match[1]
          const url = (match[2] ?? '').trim()
          // CRITICAL — TipTap's InputRule plugin treats `handler === null`
          // as a sentinel for "abort this rule" (see node_modules/
          // @tiptap/core/src/InputRule.ts line 157: `if (handler === null
          // || !tr.steps.length) return`). Returning `null` from a
          // successful handler discards the transaction silently. Walk-2
          // hit this exact bug — the InputRule fired, my TR was built,
          // but the `return null` flag caused the plugin to skip the
          // dispatch. The replacement: return early with `null` ONLY for
          // the abort path (empty text); otherwise mutate `state.tr` and
          // return nothing (undefined).
          if (!text) return null
          const tr = state.tr
          tr.replaceWith(
            range.from,
            range.to,
            state.schema.text(text, [linkType.create({ href: url })])
          )
          // Make sure subsequent typing doesn't inherit the link mark.
          tr.removeStoredMark(linkType)
        }
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      // ⌘K — open the link prompt. Uses window.prompt (same code path
      // as the toolbar's insertLink button). Pre-fills with the current
      // link's href when the selection sits on an existing link;
      // extends the mark over the whole link span so an in-place edit
      // updates the existing link rather than splitting it.
      'Mod-k': () => {
        const editor = this.editor
        const current = editor.getAttributes('link').href as string | undefined
        const url = window.prompt('Link URL', current ?? 'https://')
        if (url === null) return true // user cancelled — still consume the chord
        const trimmed = url.trim()
        if (trimmed === '') {
          editor.chain().focus().extendMarkRange('link').unsetLink().run()
        } else {
          editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
        }
        return true
      }
    }
  }
})
