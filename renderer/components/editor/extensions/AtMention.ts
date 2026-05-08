// Sprint 11 ENH-105 — `@` filename autocomplete.
//
// Triggers on `@`, opens the SuggestionPopover anchored at the
// caret, fuzzy-matches against the vault index. Tab/Enter inserts
// `[[<basename>]]` — the canonical wikilink form, so vault round-
// trip is unified (the user can `@`-pick or `[[`-pick; both produce
// the same source representation).
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
  type SuggestionPopoverHandle,
  type SuggestionPopoverProps
} from '../primitives/SuggestionPopover'
import type { VaultFile } from '../wikilinkResolver'
import { findAtMentionMatch } from './suggestionMatchers'

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
          return opts.rank(all, query)
        },

        command: ({ editor, range, props }) => {
          const item = props as VaultFile
          // `@` inserts the canonical wikilink form so the source on
          // disk reads `[[Foo]]` regardless of which trigger the
          // user opened the popover with. WikilinkDecorations then
          // renders + click-handles it on the next render.
          const insert = `[[${item.basename}]]`
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
                  command: (item: VaultFile) => props.command(item),
                  clientRect: props.clientRect ?? null,
                  loading: opts.isLoading?.() ?? false
                },
                editor: props.editor
              })
            },
            onUpdate(props: SuggestionProps) {
              if (dismissed) return
              component?.updateProps({
                items: props.items,
                command: (item: VaultFile) => props.command(item),
                clientRect: props.clientRect ?? null,
                loading: opts.isLoading?.() ?? false
              })
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (dismissed) return false
              if (props.event.key === 'Escape') {
                dismissed = true
                component?.destroy()
                component = null
                return true
              }
              const handled = component?.ref?.onKeyDown(props.event) ?? false
              if (handled && (props.event.key === 'Enter' || props.event.key === 'Tab')) {
                dismissed = true
                component?.destroy()
                component = null
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
