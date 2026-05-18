// BUG-138 Phase 4b/4c — Suggesting mode auto-wrap intercept.
//
// When Suggesting is ON (per-doc state in sidecar.suggestingMode):
//   - Typed text → wrapped as `{++text++}` insertion (InsertionMark)
//   - Backspace/Delete with selection → wrapped as `{--text--}`
//     deletion (DeletionMark) instead of being removed
//   - Type-over-selection → emits substitute (parser auto-folds
//     adjacent del+ins into `{~~old~>new~~}` at serialize time)
//
// The extension stores its enabled flag + the current author resolver
// on `editor.storage.suggestingMode` so the MarkdownEditor can flip
// it on every render without re-creating the extension. The
// ProseMirror plugin reads from storage each transaction.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Mapping } from '@tiptap/pm/transform'

export interface SuggestingModeStorage {
  enabled: boolean
  getAuthor: () => string
}

const META_AUTO = 'duo-suggesting-auto'

export const SuggestingMode = Extension.create<unknown, SuggestingModeStorage>({
  name: 'suggestingMode',

  addStorage() {
    return {
      enabled: false,
      getAuthor: () => ''
    }
  },

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin({
        key: new PluginKey('duo-suggesting-mode'),

        // Phase 4b — appendTransaction watches for user-driven inserts
        // and stamps InsertionMark on the newly-inserted ranges. PM's
        // mark stickyness handles the contiguous-typing case (typing
        // "abc" extends the mark naturally), but appendTransaction
        // catches the boundary cases too (paste, autocorrect, IME).
        appendTransaction(transactions, _oldState, newState) {
          const storage = ext.storage
          if (!storage.enabled) return null
          if (transactions.length === 0) return null

          const insMark = newState.schema.marks.insertionMark
          if (!insMark) return null

          // Look at the last transaction in the batch (the user's
          // most recent edit). Our own appended transactions carry
          // META_AUTO; skip them to avoid an infinite loop.
          const userTr = transactions[transactions.length - 1] as Transaction
          if (!userTr.docChanged) return null
          if (userTr.getMeta(META_AUTO)) return null
          // History (undo/redo) sets `addToHistory: false` via PM's
          // history plugin. Don't re-stamp marks on undo.
          if (userTr.getMeta('addToHistory') === false) return null
          // tiptap-markdown's setContent path sets a meta we shouldn't
          // re-mark (it's a programmatic load, not a user edit).
          if (userTr.getMeta('preventUpdate')) return null

          const author = storage.getAuthor() || 'agent'
          const ts = new Date().toISOString()

          const tr = newState.tr
          let modified = false

          // Walk each step; for each that inserted text, stamp
          // InsertionMark on the inserted range. The range in newState
          // coordinates is computed by mapping forward through later
          // steps in the same transaction.
          for (let i = 0; i < userTr.steps.length; i++) {
            const step = userTr.steps[i]
            const map = step.getMap()
            const rest = new Mapping(
              userTr.steps.slice(i + 1).map(s => s.getMap())
            )
            map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
              if (newEnd <= newStart) return  // pure delete; handled by Phase 4c
              const finalStart = rest.map(newStart, 1)
              const finalEnd = rest.map(newEnd, -1)
              if (finalEnd <= finalStart) return
              // Skip if the inserted text spans a node we shouldn't
              // mark (code blocks, fenced code). InsertionMark is
              // configured `allowedIn` to exclude inline-code already,
              // but the schema doesn't enforce on code_block kids —
              // walk the range and skip if any node is a code block.
              let skip = false
              newState.doc.nodesBetween(finalStart, finalEnd, (node) => {
                if (node.type.name === 'codeBlock') {
                  skip = true
                  return false
                }
                return !skip
              })
              if (skip) return
              tr.addMark(finalStart, finalEnd, insMark.create({ author, ts }))
              modified = true
            })
          }

          if (!modified) return null
          tr.setMeta(META_AUTO, true)
          return tr
        }
      })
    ]
  }
})
