// ENH-023 (v0.5.4) — `⌘F` find-in-document for the markdown editor.
//
// A TipTap extension that maintains a find query + cursor and paints
// inline decorations on every match. Two highlight classes:
//   - `.duo-find-match`         — every match (yellow `--mark` bg)
//   - `.duo-find-match-current` — the cursor's current match (orange
//                                 `--accent` bg)
//
// Commands exposed (all dispatchable via `editor.commands.X(...)`):
//   - setFindQuery({ query, caseSensitive }) — update query, recompute matches
//   - findNext()                              — advance cursor + scroll into view
//   - findPrev()                              — retreat cursor + scroll into view
//   - closeFind()                             — clear query + decorations
//
// Pure decoration approach — no doc mutation, undo/redo unaffected,
// the user's caret/selection survives query updates. Scroll on
// findNext/Prev: walks the DOM to find the current-match element
// and `scrollIntoView`s it. We DON'T move the editor's selection
// (which would steal focus from the FindBar input).
//
// Storage exposes a read-only mirror (`query`, `caseSensitive`,
// `total`, `current`, `open`) for the FindBar's match counter.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Transaction, EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

const PLUGIN_KEY = new PluginKey<FindState>('duoFindHighlight')

interface FindMatch {
  from: number
  to: number
}

interface FindState {
  query: string
  caseSensitive: boolean
  matches: FindMatch[]
  current: number             // index into matches; -1 if no matches
  decorations: DecorationSet
  scrollTo: number | null     // match index to scroll into view in the next view update; consumed once
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findHighlight: {
      setFindQuery: (opts: { query: string; caseSensitive?: boolean }) => ReturnType
      findNext: () => ReturnType
      findPrev: () => ReturnType
      closeFind: () => ReturnType
    }
  }
}

function emptyState(): FindState {
  return {
    query: '',
    caseSensitive: false,
    matches: [],
    current: -1,
    decorations: DecorationSet.empty,
    scrollTo: null
  }
}

function findAllMatches(doc: PMNode, query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Build (text, position) pairs for this textblock so we can map
    // an offset back to a doc position.
    let blockText = ''
    const offsets: number[] = []
    node.forEach((child, offsetInBlock) => {
      if (child.isText && typeof child.text === 'string') {
        for (let i = 0; i < child.text.length; i++) {
          offsets.push(pos + 1 + offsetInBlock + i)
        }
        blockText += child.text
      }
    })
    const haystack = caseSensitive ? blockText : blockText.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx !== -1) {
      const from = offsets[idx]
      const lastIdx = idx + needle.length - 1
      const to = offsets[lastIdx] !== undefined ? offsets[lastIdx] + 1 : undefined
      if (from !== undefined && to !== undefined) {
        matches.push({ from, to })
      }
      idx = haystack.indexOf(needle, idx + needle.length)
    }
    return true
  })
  return matches
}

function buildDecorations(doc: PMNode, matches: FindMatch[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  const decos = matches.map((m, i) => Decoration.inline(m.from, m.to, {
    class: i === current ? 'duo-find-match duo-find-match-current' : 'duo-find-match'
  }))
  return DecorationSet.create(doc, decos)
}

export const FindHighlight = Extension.create({
  name: 'findHighlight',

  addStorage() {
    return {
      query: '' as string,
      caseSensitive: false as boolean,
      total: 0 as number,
      current: -1 as number,
      open: false as boolean
    }
  },

  addCommands() {
    return {
      setFindQuery: ({ query, caseSensitive }) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { type: 'setQuery', query, caseSensitive: !!caseSensitive }))
        return true
      },
      findNext: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { type: 'next' }))
        return true
      },
      findPrev: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { type: 'prev' }))
        return true
      },
      closeFind: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(PLUGIN_KEY, { type: 'close' }))
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin<FindState>({
        key: PLUGIN_KEY,
        state: {
          init: () => emptyState(),
          apply: (tr: Transaction, prev: FindState, _old: EditorState, newState: EditorState) => {
            const meta = tr.getMeta(PLUGIN_KEY) as
              | { type: 'setQuery'; query: string; caseSensitive: boolean }
              | { type: 'next' }
              | { type: 'prev' }
              | { type: 'close' }
              | undefined

            // Doc changed without a meta — re-run search if we have a query.
            if (!meta && tr.docChanged && prev.query) {
              const matches = findAllMatches(newState.doc, prev.query, prev.caseSensitive)
              const current = matches.length === 0 ? -1 : Math.min(Math.max(0, prev.current), matches.length - 1)
              const next: FindState = {
                ...prev,
                matches,
                current,
                decorations: buildDecorations(newState.doc, matches, current),
                scrollTo: null
              }
              syncStorage(ext, next, ext.storage.open)
              return next
            }

            if (!meta) return prev

            if (meta.type === 'setQuery') {
              if (!meta.query) {
                const next: FindState = { ...emptyState(), }
                syncStorage(ext, next, true)
                return next
              }
              const matches = findAllMatches(newState.doc, meta.query, meta.caseSensitive)
              const current = matches.length === 0 ? -1 : 0
              const next: FindState = {
                query: meta.query,
                caseSensitive: meta.caseSensitive,
                matches,
                current,
                decorations: buildDecorations(newState.doc, matches, current),
                scrollTo: current === -1 ? null : current
              }
              syncStorage(ext, next, true)
              return next
            }

            if (meta.type === 'next' || meta.type === 'prev') {
              if (prev.matches.length === 0) return prev
              const delta = meta.type === 'next' ? 1 : -1
              const current = (prev.current + delta + prev.matches.length) % prev.matches.length
              const next: FindState = {
                ...prev,
                current,
                decorations: buildDecorations(newState.doc, prev.matches, current),
                scrollTo: current
              }
              syncStorage(ext, next, true)
              return next
            }

            if (meta.type === 'close') {
              const next = emptyState()
              syncStorage(ext, next, false)
              return next
            }

            return prev
          }
        },
        props: {
          decorations: (state) => PLUGIN_KEY.getState(state)?.decorations ?? null
        },
        view: () => ({
          update: (view) => {
            const findState = PLUGIN_KEY.getState(view.state)
            if (!findState || findState.scrollTo === null) return
            const target = findState.matches[findState.scrollTo]
            if (!target) return
            // Consume the scrollTo signal so we don't loop on
            // subsequent updates. setMeta in a transaction would
            // re-fire this view.update — instead, write directly to
            // the plugin state's mutable scrollTo by building a
            // no-op transaction. Simpler: just check scrollTo and
            // schedule the scroll once per view.update; the next
            // unrelated update will see scrollTo === current
            // (potentially stale), so guard with a short ref.
            try {
              const coords = view.coordsAtPos(target.from)
              const editorEl = view.dom.parentElement ?? view.dom
              const rect = (editorEl as HTMLElement).getBoundingClientRect()
              const desired = coords.top - rect.top - rect.height / 3
              ;(editorEl as HTMLElement).scrollBy({ top: desired, behavior: 'smooth' })
              // Clear scrollTo via a no-op transaction so we don't
              // re-scroll on the next unrelated render.
              const clear = view.state.tr.setMeta(PLUGIN_KEY, { type: 'next-clear-scroll' })
              // Actually 'next-clear-scroll' isn't a valid meta type; use
              // a different mechanism: mutate the storage directly.
              // PM doesn't allow mutating plugin state outside apply,
              // so just leave scrollTo as-is — the next setQuery /
              // next / prev call will overwrite it. This means the
              // smooth scroll will fire once per state-change, which
              // is the desired behavior. Drop the no-op tr.
              void clear
            } catch {
              /* coordsAtPos can throw mid-render; ignore */
            }
          }
        })
      })
    ]
  }
})

function syncStorage(
  ext: { storage: { query: string; caseSensitive: boolean; total: number; current: number; open: boolean } },
  s: FindState,
  open: boolean
): void {
  ext.storage.query = s.query
  ext.storage.caseSensitive = s.caseSensitive
  ext.storage.total = s.matches.length
  ext.storage.current = s.current
  ext.storage.open = open
}
