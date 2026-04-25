// Stage 11 § (selection persistence) — keep the visible text selection
// painted even when the editor loses focus.
//
// Browsers don't render `::selection` styling on a blurred contenteditable.
// That's an OS-level convention but a bad fit for an agent-pair workflow:
// the user wants to select text, click into the terminal to ask Claude
// "summarize this", and still see what's selected. We solve it with a
// ProseMirror decoration that's only painted while the editor is blurred.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface PluginState {
  focused: boolean
}

const persistentSelectionKey = new PluginKey<PluginState>('duoPersistentSelection')

export const PersistentSelection = Extension.create({
  name: 'persistentSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: persistentSelectionKey,
        state: {
          init: () => ({ focused: false }),
          apply: (tr, value) => {
            const next = tr.getMeta(persistentSelectionKey)
            if (next !== undefined) return next as PluginState
            return value
          }
        },
        props: {
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(persistentSelectionKey, { focused: true }))
              return false
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(persistentSelectionKey, { focused: false }))
              return false
            }
          },
          decorations(state) {
            const ps = persistentSelectionKey.getState(state)
            if (!ps || ps.focused) return DecorationSet.empty
            const { from, to, empty } = state.selection
            if (empty) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.inline(from, to, { class: 'duo-blurred-selection' })
            ])
          }
        }
      })
    ]
  }
})
