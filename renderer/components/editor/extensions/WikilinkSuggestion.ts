// Sprint 11 ENH-096 B.2 — wikilink autocomplete.
//
// Triggers on `[[`, opens the SuggestionPopover anchored at the
// caret, fuzzy-matches against the vault index. Tab/Enter inserts
// `[[<basename>]]`; the existing WikilinkDecorations plugin (Sprint
// 8) handles rendering + cmd+click navigation post-insertion.
//
// ENH-208 Phase 2 (D4) — when the typed query names no existing note
// (and the vault root is known), a synthetic final row offers
// `New: "<query>" — pick type…`. Picking it inserts the wikilink
// exactly like a normal pick, then hands the name + the caret rect to
// `onCreateStub` so the host (MarkdownEditor) can open the
// TypePickerPopover. The caret never leaves the note.
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
  type SuggestionItem,
  type SuggestionPopoverHandle,
  type SuggestionPopoverProps
} from '../primitives/SuggestionPopover'
import type { VaultFile } from '../wikilinkResolver'
import { findWikilinkMatch } from './suggestionMatchers'
import { isCreateNoteItem, withCreateNoteRow, type CreateNoteItem } from './createNoteRow'

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
  /** ENH-208 D4 — the host's vault root (null when the active file
   *  isn't in a vault). Read through a ref closure like getItems so
   *  the static extension list sees fresh values. The create row is
   *  only offered when this returns non-null. */
  getVaultRoot?: () => string | null
  /** ENH-208 D4 — fired AFTER the create row's wikilink insert, with
   *  the stub name + the post-insert caret rect (null if the rect
   *  couldn't be measured). The host opens the TypePickerPopover. */
  onCreateStub?: (payload: { name: string; rect: DOMRect | null }) => void
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
          // D4 — append the `New: "<query>"…` row when nothing in the
          // index has this basename and we know where a stub would go.
          // Suppressed mid-walk too: an incomplete index can't answer
          // "does this note exist", and offering New: for an existing
          // note would mislead (the stub itself is idempotent, so the
          // damage would be cosmetic — but don't offer it).
          return withCreateNoteRow(
            opts.rank(all, query),
            all,
            query,
            !!opts.getVaultRoot?.() && !(opts.isLoading?.() ?? false)
          )
        },

        // Replace `[[<query>` with `[[<basename>]]`. The matcher's
        // `range.from` points at the first `[` of `[[`, so replacing
        // [from, to] cleanly swaps the user's in-progress trigger
        // for the canonical wikilink form.
        command: ({ editor, range, props }) => {
          const item = props as VaultFile | CreateNoteItem
          // D4 — the create row inserts `[[<query>]]` with the SAME
          // range mechanics as a normal pick (caret lands after the
          // closing brackets), then asks the host to open the type
          // picker anchored at that caret.
          const insert = isCreateNoteItem(item)
            ? `[[${item.query}]]`
            : `[[${item.basename}]]`
          editor
            .chain()
            .focus()
            .insertContentAt({ from: range.from, to: range.to }, insert)
            .run()
          if (isCreateNoteItem(item)) {
            let rect: DOMRect | null = null
            try {
              // coordsAtPos gives viewport coords for the post-insert
              // caret — the anchor the TypePickerPopover positions on.
              const c = editor.view.coordsAtPos(editor.state.selection.from)
              rect = new DOMRect(c.left, c.top, 0, c.bottom - c.top)
            } catch {
              rect = null
            }
            opts.onCreateStub?.({ name: item.query, rect })
          }
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
                command: (item: SuggestionItem) => props.command(item),
                clientRect: props.clientRect ?? null,
                loading: opts.isLoading?.() ?? false,
                visible: true
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
              // Walk-2 v2 — even when dismissed, keep updateProps
              // running with visible:false so the React tree stays
              // alive but the popover renders null. Lets onExit
              // do the real teardown when the plugin's state
              // changes; visible:false ensures the user sees the
              // popover dismiss IMMEDIATELY on Escape.
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
                // Walk-2 v3 — directly destroy + remove DOM element.
                // ReactRenderer's destroy() unmounts via the editor's
                // contentComponent registry — but the registry's
                // re-render is async (subscriber notification +
                // React commit), so a stale DOM element can linger
                // for a frame or two. We immediately hide via
                // visible:false (so the next render returns null)
                // AND queue a destroy. Both belt-and-braces.
                component?.updateProps({
                  items: [],
                  command: () => {},
                  clientRect: null,
                  loading: false,
                  visible: false
                })
                // Explicitly destroy after the visible-update propagates.
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
