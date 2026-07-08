// ENH-260 — Suggesting mode: the thin plugin.
//
// Package S4 (see docs/prd/enh-260-track-changes-composition.md § 2 + § 4).
// All the reconciliation logic — net-zero deletes of your own pending
// insertion (D1), the CM-shape transform on deleted/inserted slices
// (D3/D7/D8/D10) — lives in the pure kernel `suggestEngine.ts` (package S1).
// This file is deliberately thin: it owns only the two concerns the engine
// can't see on its own, both UI-adjacent:
//
//   1. `appendTransaction` — delegates every transaction batch to
//      `buildSuggestionTr` (which already carries its own D9 skip guards
//      and stamps `META_SUGGEST_AUTO` on whatever it returns) and hands
//      back the result unchanged.
//   2. `handleKeyDown` — records which way (Backspace vs Delete) the user
//      is deleting, for the engine's caret-placement heuristic (D4/D3), AND
//      implements the D4 caret-SKIP itself: when the character that would
//      be removed already carries a deletionMark, there's nothing left to
//      reinstate — move the caret across the whole contiguous struck run
//      instead of letting a (no-op) delete run.
//
// Lineage: this supersedes the BUG-138 Phase 4b/4c dual-intercept design (a
// `handleKeyDown`-driven "wrap the range as a deletion" path, plus a
// separate `appendTransaction` pass that only stamped insertions). That
// design double-marked net-zero deletes, hard-deleted struck text at a
// deletion's edge, and swallowed typing inside a deletion — full defect
// writeup in the PRD § 1 ("Problem"). The transaction-rewrite architecture
// (PRD D2) replaces both intercepts with the single reconciler this plugin
// now merely delegates to.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { buildSuggestionTr, findDeletionRun, type DeleteDirection } from '../suggestEngine'

export interface SuggestingModeStorage {
  enabled: boolean
  getAuthor: () => string
}

export const SuggestingMode = Extension.create<unknown, SuggestingModeStorage>({
  name: 'suggestingMode',
  // Keep our handleKeyDown ahead of StarterKit / List / Code-block / Table's
  // own handlers in the plugin dispatch order (default priority is 100) —
  // see the D4 caret-skip below, which must win before those extensions'
  // own Backspace/Delete handling (unindent list, exit code block, merge
  // node boundaries, etc.) can claim the keystroke.
  priority: 1000,

  addStorage() {
    return {
      enabled: false,
      getAuthor: () => ''
    }
  },

  addProseMirrorPlugins() {
    const ext = this
    // D4 caret-placement hint for the reconciler: which way the user just
    // pressed Backspace/Delete. Set (record-only) by `handleKeyDown` below
    // when it declines to consume the event; read AND cleared by the very
    // next `appendTransaction` call, whether or not that transaction turns
    // out to be the resulting delete (a stale value must never leak into an
    // unrelated later transaction).
    let lastDeleteDirection: DeleteDirection = null

    return [
      new Plugin({
        key: new PluginKey('duo-suggesting-mode'),

        props: {
          handleKeyDown(view, event) {
            if (!ext.storage.enabled) return false
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false

            const { state } = view
            const direction: 'backspace' | 'forward' = event.key === 'Backspace' ? 'backspace' : 'forward'

            if (state.selection.empty) {
              // D4 — is the character that would be removed already part of
              // a struck (deletionMark'ed) run? If so there's nothing to
              // (re-)delete — jump the caret across the whole contiguous run
              // instead. Pure selection move: no doc change, no META needed.
              const run = findDeletionRun(state.doc, state.selection.from, direction)
              if (run) {
                const target = direction === 'backspace' ? run.from : run.to
                const tr = state.tr.setSelection(
                  Selection.near(state.doc.resolve(target), direction === 'backspace' ? -1 : 1)
                )
                view.dispatch(tr)
                return true
              }
            }

            // Not a caret-skip case (a real selection, or a collapsed caret
            // against unmarked text). Record the direction for the
            // reconciler's caret placement and let the native delete run —
            // `appendTransaction` (below) does the actual tracking.
            lastDeleteDirection = direction
            return false
          }
        },

        appendTransaction(transactions, oldState, newState) {
          if (!ext.storage.enabled) return null
          const direction = lastDeleteDirection
          lastDeleteDirection = null
          const author = ext.storage.getAuthor() || 'agent'
          return buildSuggestionTr(oldState, transactions, newState, author, direction)
        }
      })
    ]
  }
})
