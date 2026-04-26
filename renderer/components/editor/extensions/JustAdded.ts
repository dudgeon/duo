// Stage 13a — Just-added highlight: the markdown-editor binding.
//
// The visual layer is the `duo-just-added` keyframe in
// `renderer/styles/globals.css`. This extension is the data binding:
// it exposes a `markJustAdded(from, to)` command that paints the class
// onto the given range for ~6 seconds, then drops the decoration.
//
// Range positions are mapped through subsequent transactions so the
// highlight follows the underlying text if the user edits before the
// fade completes. After the fade, the decoration is cleaned up so the
// decoration set doesn't grow without bound.
//
// Stage 17 H20 will add a parallel canvas-side binding that calls
// `iframeEl.classList.add('duo-just-added')` on the affected element —
// same CSS, different binding. See `primitives/README.md` for the
// visual-layer / data-layer contract.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface JustAddedRange {
  /** Stable id so cleanup transactions can target a specific range. */
  id: number
  from: number
  to: number
}

interface PluginState {
  ranges: JustAddedRange[]
}

interface MetaPayload {
  type: 'add' | 'remove'
  id: number
  /** Required for `type === 'add'`. */
  from?: number
  to?: number
}

const justAddedKey = new PluginKey<PluginState>('duoJustAdded')

/** Total wash + fade duration, kept in lock-step with the keyframe. */
const HIGHLIGHT_MS = 6000
/** Drop the decoration shortly after the fade so the set stays small.
 *  A small grace window prevents flicker if the animation hasn't
 *  finished painting on slower paint queues. */
const CLEANUP_MS = HIGHLIGHT_MS + 500

let nextId = 1

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    justAdded: {
      /** Mark a range as "just-added" — paints `.duo-just-added` for
       *  ~6s, then drops the decoration. Returns true if the range was
       *  valid for the current document. */
      markJustAdded: (from: number, to: number) => ReturnType
    }
  }
}

export const JustAdded = Extension.create({
  name: 'justAdded',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: justAddedKey,
        state: {
          init: () => ({ ranges: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(justAddedKey) as MetaPayload | undefined

            // Map existing ranges through this transaction first so
            // they follow text edits.
            let next = value.ranges.map(r => ({
              id: r.id,
              from: tr.mapping.map(r.from, -1),
              to: tr.mapping.map(r.to, 1)
            })).filter(r => r.to > r.from)

            if (meta?.type === 'add' && meta.from !== undefined && meta.to !== undefined) {
              next = [...next, { id: meta.id, from: meta.from, to: meta.to }]
            } else if (meta?.type === 'remove') {
              next = next.filter(r => r.id !== meta.id)
            }

            if (next === value.ranges) return value
            return { ranges: next }
          }
        },
        props: {
          decorations(state) {
            const ps = justAddedKey.getState(state)
            if (!ps || ps.ranges.length === 0) return DecorationSet.empty
            const docSize = state.doc.content.size
            return DecorationSet.create(
              state.doc,
              ps.ranges
                // Clamp to the current doc and skip empty/inverted ranges.
                .map(r => ({
                  ...r,
                  from: Math.max(0, Math.min(r.from, docSize)),
                  to: Math.max(0, Math.min(r.to, docSize))
                }))
                .filter(r => r.to > r.from)
                .map(r => Decoration.inline(r.from, r.to, { class: 'duo-just-added' }))
            )
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      markJustAdded: (from: number, to: number) => ({ tr, dispatch, view }) => {
        if (to <= from) return false
        const docSize = tr.doc.content.size
        const clampedFrom = Math.max(0, Math.min(from, docSize))
        const clampedTo = Math.max(0, Math.min(to, docSize))
        if (clampedTo <= clampedFrom) return false

        const id = nextId++
        if (dispatch) {
          dispatch(tr.setMeta(justAddedKey, {
            type: 'add',
            id,
            from: clampedFrom,
            to: clampedTo
          } satisfies MetaPayload))

          // Schedule cleanup. The timer outlives the dispatch; capturing
          // `view` is fine because PM's view is stable for the editor
          // instance's lifetime (we cleared in destroy of MarkdownEditor).
          window.setTimeout(() => {
            // Guard against the editor being destroyed before the timer
            // fires. PM throws if you dispatch on a disposed view.
            if (!view || (view as unknown as { docView: unknown }).docView == null) return
            view.dispatch(
              view.state.tr.setMeta(justAddedKey, {
                type: 'remove',
                id
              } satisfies MetaPayload)
            )
          }, CLEANUP_MS)
        }
        return true
      }
    }
  }
})
