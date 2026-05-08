// Sprint 11 ENH-096 B.2 — wikilink autocomplete.
//
// Triggers on `[[`, opens the SuggestionPopover anchored at the
// caret, fuzzy-matches against the vault index. Tab/Enter inserts
// `[[<basename>]]`; the existing WikilinkDecorations plugin (Sprint
// 8) handles rendering + cmd+click navigation post-insertion.
//
// Architecture: TipTap Extension wrapping the first-party Suggestion
// utility. The renderer state (popover items, active idx) lives in a
// ReactRenderer-mounted SuggestionPopover; the extension is purely
// the bridge between TipTap's transaction lifecycle and that React
// component.

import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

// Sprint 11 walk-1 fix — distinct PluginKey is mandatory when two
// Suggestion-utility instances live in the same editor (one for
// WikilinkSuggestion, one for AtMention). Pre-fix both used the
// utility's default `'suggestion'` key, which ProseMirror rejects
// at editor-init time with `RangeError: Adding different instances
// of a keyed plugin (suggestion$)` — the renderer crashed in
// MarkdownEditor's mount and bubbled up through the working pane.
const WIKILINK_SUGGESTION_KEY = new PluginKey('wikilinkSuggestion')
import {
  SuggestionPopover,
  type SuggestionPopoverHandle,
  type SuggestionPopoverProps
} from '../primitives/SuggestionPopover'
import type { VaultFile } from '../wikilinkResolver'

export interface WikilinkSuggestionOptions {
  /** Returns the current vault file list. Called once per trigger
   *  open + on every query update. The host owns the vault index
   *  (built via useVaultIndex) and threads the latest list in via
   *  this getter so the extension doesn't need to subscribe to React
   *  state directly. */
  getItems: () => VaultFile[]
  /** Returns true while the vault index is still walking — drives
   *  the "Searching vault…" hint in the popover. */
  isLoading?: () => boolean
  /** Filter + rank the items against the query. Defaults to
   *  `rankVaultFiles` from vaultIndex.ts; tests can swap. */
  rank: (items: VaultFile[], query: string) => VaultFile[]
}

export const WikilinkSuggestion = Extension.create<WikilinkSuggestionOptions>({
  name: 'wikilinkSuggestion',

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
        // Sprint 11 walk-1 fix — explicit pluginKey avoids the
        // `Adding different instances of a keyed plugin (suggestion$)`
        // crash when AtMention is also loaded.
        pluginKey: WIKILINK_SUGGESTION_KEY,
        // `[[` trigger. The `char` field on the suggestion config is
        // a single character; we use `[` and require allowSpaces:false
        // + an extra startOfLine guard via the items() filter below.
        // Net behavior: typing "[[" opens the popover; typing
        // "[" alone does NOT.
        char: '[',
        // Allow spaces in the query (filenames have spaces).
        allowSpaces: true,
        // The popover's match regex captures everything between the
        // second `[` and the caret. We require the prefix to start
        // with `[` (the second of `[[`), matched in items() below.
        startOfLine: false,

        items: ({ query }) => {
          // The suggestion utility passes everything between the
          // trigger char + the caret. We want `[foo` after `[[foo`,
          // so query starts with `[`. Strip it.
          if (!query.startsWith('[')) return []
          const stripped = query.slice(1)
          // Bail if the next char would close the wikilink (user
          // typed `[[]]`) — empty stripped is fine, that's the
          // "show all files" state.
          if (stripped.includes(']')) return []
          const all = opts.getItems()
          return opts.rank(all, stripped)
        },

        // Replace `[[<query>` with `[[<basename>]]`. The selected
        // basename is what becomes the wikilink; WikilinkDecorations
        // handles the click / hover styling on subsequent renders.
        command: ({ editor, range, props }) => {
          const item = props as VaultFile
          const insert = `[[${item.basename}]]`
          editor
            .chain()
            .focus()
            // The range starts at `[` (the trigger). We want to
            // replace `[[<query>` with `[[<basename>]]`, so the
            // replace range starts ONE char before the trigger
            // (capturing the first `[` of `[[`).
            .insertContentAt({ from: range.from - 1, to: range.to }, insert)
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
