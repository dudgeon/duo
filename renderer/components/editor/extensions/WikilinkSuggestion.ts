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
import { findWikilinkMatch } from './suggestionMatchers'

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
        // `char` is required by the suggestion config but unused
        // when a custom findSuggestionMatch is provided. We pass the
        // canonical first character anyway for clarity.
        char: '[',
        allowSpaces: false,
        startOfLine: false,
        // Sprint 11 walk-1 v3 fix — custom match function that requires
        // `[[` (two consecutive `[` chars) immediately before the
        // caret with no whitespace / `]` / closing pair in between.
        // Default findSuggestionMatch couldn't express this — see
        // suggestionMatchers.ts for the full rationale.
        findSuggestionMatch: findWikilinkMatch,

        items: ({ query }) => {
          // With our custom matcher, `query` is the text strictly
          // AFTER `[[` (no leading bracket to strip). Empty query is
          // valid — that's the "user just typed `[[`, show me all
          // vault files" state.
          if (query.includes(']')) return []
          const all = opts.getItems()
          return opts.rank(all, query)
        },

        // Replace `[[<query>` with `[[<basename>]]`. The matcher's
        // `range.from` points at the first `[` of `[[`, so replacing
        // [from, to] cleanly swaps the user's in-progress trigger
        // for the canonical wikilink form.
        command: ({ editor, range, props }) => {
          const item = props as VaultFile
          const insert = `[[${item.basename}]]`
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, insert)
            .run()
        },

        render: () => {
          let component: ReactRenderer<SuggestionPopoverHandle, SuggestionPopoverProps> | null = null
          // Walk-1 v4 fix — dismissed flag survives across the
          // suggestion plugin's onUpdate calls. When Escape is
          // pressed (or Enter selects an item), the popover destroys
          // its React tree but the suggestion plugin may still be
          // "active" until the next state change makes
          // findSuggestionMatch return null. Without dismissed=true,
          // the next onUpdate would re-mount the component (because
          // we aggressively re-create on null component reference).
          // Reset on onStart for the next suggestion session.
          let dismissed = false
          const mountComponent = (props: SuggestionProps) => {
            component = new ReactRenderer(SuggestionPopover, {
              props: {
                items: props.items,
                command: (item: VaultFile) => props.command(item),
                clientRect: props.clientRect ?? null,
                loading: opts.isLoading?.() ?? false
              },
              editor: props.editor
            })
          }
          return {
            onStart(props: SuggestionProps) {
              dismissed = false
              mountComponent(props)
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
              // Walk-1 v4 — defensively destroy after a successful
              // Enter/Tab. The suggestion plugin SHOULD fire onExit
              // after our command() inserts text (because the new
              // doc state no longer matches), but in practice the
              // popover persisted post-insert. Destroying here is
              // belt-and-braces; onExit's destroy is a no-op then.
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
