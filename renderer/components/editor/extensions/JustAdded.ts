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
// ENH-195 D3 — added a PERSIST lifetime for the change-highlight painted
// when the editor reloads from disk (an agent/external write reconciled by
// `useDiskReconciliation`). Unlike the 6s timed wash used by `duo doc write`,
// a persist range HOLDS (no timer) and clears on the user's first
// doc-changing edit — "here's what changed while you were away," dismissed
// the moment you engage with the doc. Deletions render as a thin left-margin
// tick (a widget decoration) since absent text can't be washed. Markdown
// only; the canvas parity port is tracked as ENH-196.
//
// Stage 17 H20 added the parallel canvas-side binding
// (`renderer/components/Page/justAddedPage.ts`) — same CSS, different binding.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

interface JustAddedRange {
  /** Stable id so cleanup transactions can target a specific range. */
  id: number
  from: number
  to: number
  /** 'timed' fades after ~6s (CLI doc-write); 'persist' holds until the
   *  user's next doc-changing edit (ENH-195 D3 reload highlight). */
  lifetime: 'timed' | 'persist'
  /** 'insert' paints an inline wash over [from,to]; 'delete' renders a
   *  collapsed left-margin tick at `from` (to === from). */
  kind: 'insert' | 'delete'
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
  lifetime?: 'timed' | 'persist'
  kind?: 'insert' | 'delete'
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
      /** ENH-195 D3 — paint an inserted range that HOLDS (no 6s timer) and
       *  clears on the user's first doc-changing edit. */
      markJustAddedPersist: (from: number, to: number) => ReturnType
      /** ENH-195 D3 — paint a collapsed deletion tick at `pos` (also persist). */
      markDeletedAtPersist: (pos: number) => ReturnType
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

            // ENH-195 D3 — the user's first real edit clears the reload
            // highlight. A doc-changing transaction that is NOT one of our
            // own add/remove dispatches drops every persist range. The
            // reload itself uses setContent(emitUpdate=false) + our own
            // markJustAddedPersist dispatch (which carries the meta), so the
            // wash survives the reload and only this branch — a genuine
            // subsequent keystroke — clears it.
            let working = value.ranges
            if (tr.docChanged && !meta) {
              const filtered = working.filter(r => r.lifetime !== 'persist')
              if (filtered.length !== working.length) working = filtered
            }

            // Map existing ranges through this transaction so they follow
            // text edits.
            let next = working.map(r => ({
              ...r,
              from: tr.mapping.map(r.from, -1),
              to: tr.mapping.map(r.to, 1)
            })).filter(r => r.kind === 'delete' ? true : r.to > r.from)

            if (meta?.type === 'add' && meta.from !== undefined && meta.to !== undefined) {
              next = [...next, {
                id: meta.id,
                from: meta.from,
                to: meta.to,
                lifetime: meta.lifetime ?? 'timed',
                kind: meta.kind ?? 'insert'
              }]
            } else if (meta?.type === 'remove') {
              next = next.filter(r => r.id !== meta.id)
            }

            if (next === working && next === value.ranges) return value
            return { ranges: next }
          }
        },
        props: {
          decorations(state) {
            const ps = justAddedKey.getState(state)
            if (!ps || ps.ranges.length === 0) return DecorationSet.empty
            const docSize = state.doc.content.size
            const decos: Decoration[] = []
            for (const r of ps.ranges) {
              if (r.kind === 'delete') {
                const pos = Math.max(0, Math.min(r.from, docSize))
                decos.push(Decoration.widget(pos, () => {
                  const el = document.createElement('span')
                  el.className = 'duo-reload-deleted-tick'
                  el.setAttribute('aria-hidden', 'true')
                  return el
                }, { side: -1, key: `del-${r.id}` }))
                continue
              }
              const from = Math.max(0, Math.min(r.from, docSize))
              const to = Math.max(0, Math.min(r.to, docSize))
              if (to <= from) continue
              decos.push(Decoration.inline(from, to, {
                class: r.lifetime === 'persist' ? 'duo-reload-added' : 'duo-just-added'
              }))
            }
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
          }
        }
      })
    ]
  },

  addCommands() {
    const addRange = (
      from: number,
      to: number,
      lifetime: 'timed' | 'persist',
      kind: 'insert' | 'delete',
      withTimer: boolean
    ) => ({ tr, dispatch, view }: { tr: Transaction; dispatch?: (tr: Transaction) => void; view: EditorView }) => {
      const docSize = tr.doc.content.size
      const clampedFrom = Math.max(0, Math.min(from, docSize))
      const clampedTo = Math.max(0, Math.min(to, docSize))
      if (kind === 'insert' && clampedTo <= clampedFrom) return false

      const id = nextId++
      if (dispatch) {
        dispatch(tr.setMeta(justAddedKey, {
          type: 'add', id, from: clampedFrom, to: clampedTo, lifetime, kind
        } satisfies MetaPayload))

        if (withTimer) {
          // Schedule cleanup. The timer outlives the dispatch; capturing
          // `view` is fine because PM's view is stable for the editor
          // instance's lifetime (we cleared in destroy of MarkdownEditor).
          window.setTimeout(() => {
            if (!view || (view as unknown as { docView: unknown }).docView == null) return
            view.dispatch(
              view.state.tr.setMeta(justAddedKey, { type: 'remove', id } satisfies MetaPayload)
            )
          }, CLEANUP_MS)
        }
      }
      return true
    }

    return {
      markJustAdded: (from, to) => addRange(from, to, 'timed', 'insert', true),
      markJustAddedPersist: (from, to) => addRange(from, to, 'persist', 'insert', false),
      markDeletedAtPersist: (pos) => addRange(pos, pos, 'persist', 'delete', false),
    }
  }
})
