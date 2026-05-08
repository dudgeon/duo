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
        // Sprint 11 walk-1 fix — explicit pluginKey distinct from
        // WikilinkSuggestion's. ProseMirror requires unique keys
        // when multiple suggestion-utility instances coexist.
        pluginKey: AT_MENTION_KEY,
        char: '@',
        // Sprint 11 walk-1 v2 fix — same allowSpaces concern as
        // WikilinkSuggestion. Pre-fix any `@agent`-style text in the
        // document fired the popover unprompted on caret moves; with
        // allowSpaces:false the trigger only fires while the user is
        // actively typing a contiguous query post-`@`. Filenames with
        // spaces become a kebab-case requirement until we migrate to
        // a Mention-NODE-based approach in a follow-up sprint.
        allowSpaces: false,
        startOfLine: false,

        items: ({ query }) => {
          // `@` doesn't have an `@`-only escape — typing `@@` would
          // start a fresh trigger. Also: an `@` immediately followed
          // by whitespace + character ("@ foo") would be ambiguous,
          // but TipTap's suggestion utility dismisses on space-after-
          // trigger by default, so we get that for free.
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
          return {
            onStart(props: SuggestionProps) {
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
              component?.updateProps({
                items: props.items,
                command: (item: VaultFile) => props.command(item),
                clientRect: props.clientRect ?? null,
                loading: opts.isLoading?.() ?? false
              })
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === 'Escape') {
                component?.destroy()
                component = null
                return true
              }
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit() {
              component?.destroy()
              component = null
            }
          }
        }
      })
    ]
  }
})
