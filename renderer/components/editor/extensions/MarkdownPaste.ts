// BUG-026 — block-aware paste in the TipTap markdown editor.
//
// Replaces tiptap-markdown's default `clipboardTextParser`, which always
// parses with `{ inline: true }`. Inline parsing keeps the paste from
// being wrapped in a fresh paragraph (good for "paste a bold word
// mid-sentence" muscle memory), but it mishandles block-level markdown
// — headings, lists, fenced code, blockquotes — by either flattening
// them to plain text or wedging them into the destination block where
// the schema then lands them as a single code block.
//
// This extension installs a higher-priority ProseMirror plugin whose
// `clipboardTextParser` inspects the source text and picks block vs
// inline mode. The default extension (lower priority) never sees
// the call, so we don't need to coordinate with it.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMParser as PMDOMParser, Slice } from '@tiptap/pm/model'

const BLOCK_MARKERS = [
  /^\s{0,3}#{1,6}\s/m,    // ATX heading
  /^\s{0,3}[-*+]\s/m,     // bullet list
  /^\s{0,3}\d+\.\s/m,     // ordered list
  /^\s{0,3}>\s/m,         // blockquote
  /^\s{0,3}```/m,         // fenced code
  /^\s{0,3}~~~/m,         // alt fenced code
  /^\s{0,3}---\s*$/m,     // hr / setext underline
  /^\s{0,3}===\s*$/m,     // setext underline
  /^\s{0,3}\|.*\|/m,      // table row
]

function looksBlockLevel(text: string): boolean {
  // Blank-line separator implies multiple paragraphs → block.
  if (/\n\s*\n/.test(text)) return true
  for (const re of BLOCK_MARKERS) {
    if (re.test(text)) return true
  }
  return false
}

function elementFromString(html: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = html
  return wrap
}

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  // Higher priority than tiptap-markdown's `markdownClipboard` plugin
  // (default extension priority is 100). Our `clipboardTextParser`
  // returns a Slice and ProseMirror never asks the next plugin in line.
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor
    // The TS surface for `clipboardTextParser` requires returning Slice,
    // but ProseMirror at runtime accepts null to mean "fall through to
    // the default text parser" (which tiptap-markdown's lower-priority
    // plugin then receives). We rely on that runtime contract.
    return [
      new Plugin({
        key: new PluginKey('markdownPasteBlockAware'),
        props: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          clipboardTextParser: ((text: string, $context: any, plain: boolean) => {
            if (plain) return null
            const storage = editor.storage as Record<string, unknown>
            const md = storage['markdown'] as { parser?: { parse: (text: string, opts?: { inline?: boolean }) => string } } | undefined
            const parser = md?.parser
            if (!parser) return null
            const inline = !looksBlockLevel(text)
            const html = parser.parse(text, { inline })
            // BUG-127 — for BLOCK-level paste (tables, headings, code
            // fences, lists), force the slice's openStart/openEnd to
            // 0 so PM treats it as fully-closed block content. Without
            // this, the slice's natural openness (matching the cursor's
            // node depth) causes PM's `replaceSelection` to try to
            // squash the block into the destination's content model —
            // pasting a table inside a list-item collapsed the table
            // to per-line <code>-wrapped paragraphs. Closing the slice
            // forces PM to lift the enclosing nodes as needed. Inline
            // paste keeps the natural openness so a bold word lands
            // mid-sentence correctly.
            const parseOpts = inline
              ? { preserveWhitespace: true as const, context: $context }
              : { preserveWhitespace: true as const }
            const parsed = PMDOMParser.fromSchema(editor.schema).parseSlice(
              elementFromString(html),
              parseOpts
            )
            if (inline) return parsed
            return new Slice(parsed.content, 0, 0)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any
        }
      })
    ]
  }
})
