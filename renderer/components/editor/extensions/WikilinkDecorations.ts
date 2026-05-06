// ENH-096 (B1) — Wikilink decoration extension.
//
// Recognizes `[[Page Name]]` patterns in the markdown editor and
// renders them as Atelier-styled clickable inline spans. Cmd+click
// opens the linked file from the resolved vault root.
//
// Implemented as a ProseMirror Decoration plugin (NOT a TipTap
// Node/Mark) so the markdown source stays unchanged on disk —
// `[[Foo]]` is a literal sequence that tiptap-markdown round-trips
// verbatim. No schema migration; no serializer touch; works on
// every existing markdown file with wikilinks. v2 could promote to
// a real Node if e.g. autocomplete on `[[` requires it.
//
// Vault-root resolution heuristic:
//   1. Walk up from the active file's directory until `.obsidian/`
//      is found.
//   2. Fall back to the navigator's CWD if no `.obsidian/` exists
//      anywhere in the ancestor chain.
//
// Wikilink target resolution (per Obsidian's "shortest path when
// possible" semantic):
//   1. If target contains `/`, treat as a relative path from the
//      vault root.
//   2. Otherwise: name-first match across the vault. First file
//      whose basename (without extension) equals the target wins.
//      Ambiguity is resolved by alphabetical order of relative
//      path; v2 may surface a disambiguation popup.
//
// Performance — the plugin walks the doc on every state update.
// For typical markdown notes (a few hundred KB) the regex pass is
// imperceptible. Bigger docs may want incremental updates;
// optimization deferred until profile data justifies the
// complexity.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g
const PLUGIN_KEY = new PluginKey('duo-wikilink-decorations')

/**
 * Compute decorations for the doc. Re-run on every transaction.
 *
 * Decoration shape: an inline span with `class="duo-wikilink"` and a
 * `data-duo-wikilink-target` attribute carrying the unparsed target
 * text (e.g. "Foo Page" or "subdir/Foo"). Click resolution uses the
 * target attr; styling lives in globals.css.
 */
function buildDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text
    let match: RegExpExecArray | null
    WIKILINK_RE.lastIndex = 0
    while ((match = WIKILINK_RE.exec(text)) !== null) {
      const target = match[1]
      const start = pos + match.index
      const end = start + match[0].length
      decorations.push(
        Decoration.inline(start, end, {
          class: 'duo-wikilink',
          'data-duo-wikilink-target': target
        })
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

export const WikilinkDecorations = Extension.create({
  name: 'duo-wikilink-decorations',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PLUGIN_KEY,
        state: {
          init: (_, { doc }) => buildDecorations(doc),
          apply(tr, oldSet) {
            // Cheap path: if the doc didn't change this tx, just map
            // the existing decorations through the transaction's
            // position mapping. Otherwise rebuild from scratch — the
            // wikilink regex depends only on text content, so a full
            // rebuild on doc-changing tx is correct + simple.
            if (!tr.docChanged) return oldSet.map(tr.mapping, tr.doc)
            return buildDecorations(tr.doc)
          }
        },
        props: {
          decorations(state) {
            return PLUGIN_KEY.getState(state)
          },
          handleClick(view, pos, event) {
            // Detect clicks on wikilink decorations. Only fire on
            // cmd/ctrl+click so a plain click stays "place a cursor"
            // — same convention as VS Code, IntelliJ etc.
            const meta = (event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey
            if (!meta) return false
            // Walk DOM up from the click target to find the wikilink span.
            const target = (event.target as Element | null)?.closest?.('[data-duo-wikilink-target]') as HTMLElement | null
            if (!target) return false
            const wikilinkTarget = target.getAttribute('data-duo-wikilink-target')
            if (!wikilinkTarget) return false
            // Dispatch a window event the host (App.tsx) listens for.
            // Decouples the resolution logic (which needs vault-root
            // walking + filesystem search) from this rendering layer.
            window.dispatchEvent(
              new CustomEvent('duo-wikilink-open', {
                detail: { target: wikilinkTarget }
              })
            )
            event.preventDefault()
            return true
          }
        }
      })
    ]
  }
})
