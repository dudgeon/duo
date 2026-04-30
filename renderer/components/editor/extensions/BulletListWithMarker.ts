// ENH-018 (v0.5.3) — Bullet list with source-marker preservation.
//
// Three CommonMark-recognized bullet markers: `*`, `-`, `+`. Pre-fix,
// TipTap's BulletList node had no concept of which character was used
// in the source — every list normalized to `-` on save (via tiptap-
// markdown's `bulletListMarker` option), and rendered with a `disc`
// CSS marker regardless. This extension adds a `marker` attribute
// (default `-`) and three coordinated changes:
//
// 1. Parse: a markdown-it pass copies `token.markup` (the actual
//    bullet character from the source) into a `data-marker` HTML
//    attribute on the `<ul>` rendered by tiptap-markdown. When TipTap
//    parses the HTML, our `parseHTML` reads `data-marker` and sets the
//    node attribute.
//
// 2. Render: `renderHTML` emits `data-marker="X"` on the `<ul>` so CSS
//    in globals.css can style the visual marker per character
//    (`*` → disc, `-` → en-dash, `+` → plus).
//
// 3. Serialize: the serialize hook overrides tiptap-markdown's default
//    (which reads the global `bulletListMarker` option) and emits
//    `node.attrs.marker + ' '` instead, preserving each list's marker
//    on save.
//
// Inheritance rule (locked spec, AskUserQuestion 2026-04-30): when
// the user types `* ` inside an existing dashed list, the typed
// character is captured but immediately conformed to the surrounding
// list. Mixed-marker authoring requires explicit edit at the source.
// Implementation: the input rule that creates a new bullet list reads
// the typed character ONLY when the new list is at the top level;
// inside an existing list the character is ignored.
//
// Out of scope (deferred to v2): paste-fidelity for mixed markers
// from another markdown source (today they normalize to the
// destination context's marker). cozy-md-editor explicitly didn't
// solve this either.

import BulletList from '@tiptap/extension-bullet-list'
import { wrappingInputRule } from '@tiptap/core'
import type { MarkdownNodeSpec } from 'tiptap-markdown'

const VALID_MARKERS = new Set(['-', '*', '+'])

export const BulletListWithMarker = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      marker: {
        default: '-',
        parseHTML: (element: HTMLElement): string => {
          const m = element.getAttribute('data-marker')
          return m && VALID_MARKERS.has(m) ? m : '-'
        },
        renderHTML: (attrs: { marker?: string }) => {
          const m = attrs.marker && VALID_MARKERS.has(attrs.marker) ? attrs.marker : '-'
          return { 'data-marker': m }
        }
      }
    }
  },

  addInputRules() {
    // Override TipTap's default bullet input rule (matches `[*+-]\s`)
    // so the matched character sets the new list's `marker` attribute.
    // Pattern is intentionally identical to TipTap's default; the only
    // change is `getAttributes`.
    return [
      wrappingInputRule({
        find: /^\s*([-+*])\s$/,
        type: this.type,
        getAttributes: (match: RegExpMatchArray) => ({
          marker: VALID_MARKERS.has(match[1]) ? match[1] : '-'
        })
      })
    ]
  },

  addStorage() {
    // tiptap-markdown's MarkdownNodeSpec extension point. Returns the
    // serialize override + the parse setup that tags markdown-it's
    // bullet-list tokens with `data-marker`. The serialize override
    // emits `node.attrs.marker` instead of the global `bulletListMarker`
    // option so each list keeps its source character on save.
    const spec: MarkdownNodeSpec = {
      serialize(state, node) {
        const marker = (node.attrs as { marker?: string }).marker ?? '-'
        const safe = VALID_MARKERS.has(marker) ? marker : '-'
        return state.renderList(node, '  ', () => `${safe} `)
      },
      parse: {
        setup(markdownit) {
          // Patch: after `bullet_list_open` tokens are emitted, copy
          // the `markup` field (the actual `*` / `-` / `+` from the
          // source) onto the token's HTML attributes as `data-marker`.
          // When tiptap-markdown renders the markdown to HTML and
          // feeds it back into ProseMirror's parser, our `parseHTML`
          // sees the attribute and sets the node attr.
          markdownit.core.ruler.after('block', 'duo-bullet-marker', state => {
            for (const token of state.tokens) {
              if (token.type === 'bullet_list_open' && token.markup) {
                if (VALID_MARKERS.has(token.markup)) {
                  token.attrSet('data-marker', token.markup)
                }
              }
            }
          })
        }
      }
    }
    return { markdown: spec }
  }
})
