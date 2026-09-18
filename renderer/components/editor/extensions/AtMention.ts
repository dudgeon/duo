// Sprint 11 ENH-105 — `@` filename autocomplete.
//
// Triggers on `@`, opens the SuggestionPopover anchored at the
// caret, fuzzy-matches against the vault index. Tab/Enter inserts
// `[[<basename>]]` — the canonical wikilink form, so vault round-
// trip is unified (the user can `@`-pick or `[[`-pick; both produce
// the same source representation).
//
// ENH-208 Phase 2 (D21) — smart tokens (`@today` / `@tomorrow` /
// `@yesterday` / `@now`) rank FIRST in the same popover. They only
// appear once the query matches a keyword (smartTokensFor returns []
// on empty query, so a bare `@` stays files-only) and insert their
// resolved PLAIN TEXT (an ISO date by default), not a wikilink.
//
// Sibling to WikilinkSuggestion. Same render lifecycle, same vault
// index source, different trigger shape + insertion shape.

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'

// Sprint 11 walk-1 fix — distinct PluginKey from WikilinkSuggestion's
// (see that file for the full ProseMirror-keyed-plugin rationale).
const AT_MENTION_KEY = new PluginKey('atMention')
import type { VaultFile } from '../wikilinkResolver'
import type { VaultMode } from '../../../../core/markdown/vaultLinks'
import { okfLinkInsert } from '../okfLinks'
import { createSuggestionLifecycle } from './suggestionLifecycle'
import { findAtMentionMatch } from './suggestionMatchers'
import { isSmartToken, mergeSuggestionItems, smartTokensFor, type SmartToken } from '../smartTokens'

export interface AtMentionOptions {
  getItems: () => VaultFile[]
  isLoading?: () => boolean
  rank: (items: VaultFile[], query: string) => VaultFile[]
  /** ENH-216 (U7) — the active vault's at-rest link mode (D4). OKF
   *  inserts a standard markdown relative link; Obsidian (the default)
   *  keeps the [[ ]] form. Read through a ref closure for fresh values. */
  getMode?: () => VaultMode
  /** ENH-216 (U7) — the active document's path (SOURCE note), the
   *  rel-link base in OKF mode. Null → fall back to the wikilink insert. */
  getDocPath?: () => string | null
}

export const AtMention = Extension.create<AtMentionOptions, { suspend: () => void }>({
  name: 'atMention',

  addOptions() {
    return {
      getItems: () => [],
      isLoading: () => false,
      rank: (items) => items,
      getMode: () => 'obsidian' as VaultMode,
      getDocPath: () => null
    }
  },

  // BUG-271 — 'suspend' is the host hook MarkdownEditor calls when its tab
  // goes inactive (editor.storage.<name>.suspend()). Replaced with the live
  // lifecycle's handle once the plugin is built.
  addStorage() {
    return { suspend: () => {} }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    const lifecycle = createSuggestionLifecycle(() => opts.isLoading?.() ?? false)
    this.storage.suspend = lifecycle.suspend
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: AT_MENTION_KEY,
        char: '@',
        allowSpaces: false,
        startOfLine: false,
        // Sprint 11 walk-1 v3 fix — custom match function rejects
        // mid-word `@` (so `email@example` doesn't trigger) and
        // existing `@agent` text near caret. See suggestionMatchers.ts
        // for the rationale.
        findSuggestionMatch: findAtMentionMatch,

        items: ({ query }) => {
          const all = opts.getItems()
          // D21 — tokens first, files after, capped at the existing
          // limit. smartTokensFor is [] for an empty query, so the
          // bare-`@` list is unchanged.
          return mergeSuggestionItems(smartTokensFor(query), opts.rank(all, query))
        },

        command: ({ editor, range, props }) => {
          const item = props as VaultFile | SmartToken
          // A file pick inserts the resolved link in the vault's at-rest
          // form: Obsidian → `[[basename]]` (WikilinkDecorations renders +
          // click-handles it); OKF → a standard markdown relative link with
          // the on-disk slug as link text (D3/D6). Smart tokens (D21) are
          // unaffected — they land their resolved plain text (an ISO date)
          // regardless of mode, with the same range mechanics.
          const mode = opts.getMode?.() ?? 'obsidian'
          const docPath = opts.getDocPath?.() ?? null
          const insert = isSmartToken(item)
            ? item.insertText
            : (mode === 'okf' && docPath)
              ? okfLinkInsert(item.basename, docPath, item.absPath)
              : `[[${item.basename}]]`
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, insert)
            .run()
        },

        // BUG-271 — the popover lifecycle (dismissed / suspended state
        // machine) is shared with the sibling suggester; see
        // suggestionLifecycle.ts.
        render: lifecycle.render
      })
    ]
  }
})
