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
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

// Sprint 11 walk-1 fix — distinct PluginKey from WikilinkSuggestion's
// (see that file for the full ProseMirror-keyed-plugin rationale).
const AT_MENTION_KEY = new PluginKey('atMention')
import {
  SuggestionPopover,
  type SuggestionItem,
  type SuggestionPopoverHandle,
  type SuggestionPopoverProps
} from '../primitives/SuggestionPopover'
import type { VaultFile } from '../wikilinkResolver'
import { findAtMentionMatch } from './suggestionMatchers'
import { isSmartToken, mergeSuggestionItems, smartTokensFor, type SmartToken } from '../smartTokens'

export interface AtMentionOptions {
  getItems: () => VaultFile[]
  isLoading?: () => boolean
  rank: (items: VaultFile[], query: string) => VaultFile[]
}

export const AtMention = Extension.create<AtMentionOptions>({
  name: 'atMention',

  addOptions() {
    return {
      getItems: () => [],
      isLoading: () => false,
      rank: (items) => items
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
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
          // `@` inserts the canonical wikilink form so the source on
          // disk reads `[[Foo]]` regardless of which trigger the
          // user opened the popover with. WikilinkDecorations then
          // renders + click-handles it on the next render. Smart
          // tokens (D21) instead land their resolved plain text —
          // same range mechanics (replace the `@query` trigger), no
          // trailing space, different content.
          const insert = isSmartToken(item) ? item.insertText : `[[${item.basename}]]`
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, insert)
            .run()
        },

        render: () => {
          let component: ReactRenderer<SuggestionPopoverHandle, SuggestionPopoverProps> | null = null
          // Walk-1 v4 fix — see WikilinkSuggestion.ts for the full
          // dismissed-flag rationale. AT-MENTION specifically reproduced
          // the persistent-popover bug at walk-2 (visible in user's
          // screenshot — popover with "Foo" stayed up after Enter).
          let dismissed = false
          return {
            onStart(props: SuggestionProps) {
              dismissed = false
              component = new ReactRenderer(SuggestionPopover, {
                props: {
                  items: props.items,
                  command: (item: SuggestionItem) => props.command(item),
                  clientRect: props.clientRect ?? null,
                  loading: opts.isLoading?.() ?? false,
                  visible: true
                },
                editor: props.editor
              })
            },
            onUpdate(props: SuggestionProps) {
              component?.updateProps({
                items: props.items,
                command: (item: SuggestionItem) => props.command(item),
                clientRect: props.clientRect ?? null,
                loading: opts.isLoading?.() ?? false,
                visible: !dismissed
              })
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === 'Escape') {
                if (dismissed) return false
                dismissed = true
                component?.updateProps({
                  items: [],
                  command: () => {},
                  clientRect: null,
                  loading: false,
                  visible: false
                })
                queueMicrotask(() => {
                  component?.destroy()
                  component = null
                })
                return true
              }
              if (dismissed) return false
              const handled = component?.ref?.onKeyDown(props.event) ?? false
              if (handled && (props.event.key === 'Enter' || props.event.key === 'Tab')) {
                dismissed = true
                component?.updateProps({
                  items: [],
                  command: () => {},
                  clientRect: null,
                  loading: false,
                  visible: false
                })
              }
              return handled
            },
            onExit() {
              dismissed = false
              component?.destroy()
              component = null
            }
          }
        }
      })
    ]
  }
})
