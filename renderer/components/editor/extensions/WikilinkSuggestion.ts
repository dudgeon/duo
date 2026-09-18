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

// Sprint 11 walk-1 fix — distinct PluginKey is mandatory when two
// Suggestion-utility instances live in the same editor (one for
// WikilinkSuggestion, one for AtMention). Pre-fix both used the
// utility's default `'suggestion'` key, which ProseMirror rejects
// at editor-init time with `RangeError: Adding different instances
// of a keyed plugin (suggestion$)` — the renderer crashed in
// MarkdownEditor's mount and bubbled up through the working pane.
const WIKILINK_SUGGESTION_KEY = new PluginKey('wikilinkSuggestion')
import { ITEM_LIMIT_VISIBLE } from '../primitives/SuggestionPopover'
import type { VaultFile } from '../wikilinkResolver'
import type { VaultMode } from '../../../../core/markdown/vaultLinks'
import { okfLinkInsert } from '../okfLinks'
import { createSuggestionLifecycle } from './suggestionLifecycle'
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
  /** ENH-216 (U7) — the active vault's at-rest link mode (D4). Read
   *  through a ref closure (like getItems) so the static extension list
   *  sees fresh values. OKF branches command() onto standard markdown
   *  relative links; Obsidian (the default) keeps the [[ ]] form. */
  getMode?: () => VaultMode
  /** ENH-216 (U7) — the active document's path (the SOURCE note), used
   *  as the rel-link base in OKF mode. Null when unknown — the extension
   *  falls back to the legacy wikilink insert. */
  getDocPath?: () => string | null
  /** ENH-208 D4 / ENH-216 (U7) — fired AFTER the create row's insert.
   *  `name` is the human name the user typed; `rect` is the post-insert
   *  caret rect (null if unmeasurable). `range` is the inserted
   *  PLACEHOLDER's range (OKF mode only — the host rewrites it to a
   *  markdown link once the stub's path is known via onCreated); null in
   *  Obsidian mode (the [[ ]] is already its final form). The host opens
   *  the TypePickerPopover from this. */
  onCreateStub?: (payload: {
    name: string
    rect: DOMRect | null
    range: { from: number; to: number } | null
  }) => void
}

export const WikilinkSuggestion = Extension.create<WikilinkSuggestionOptions, { suspend: () => void }>({
  name: 'wikilinkSuggestion',

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
          // D4 — offer the `New: "<query>"…` row when nothing in the
          // index has this basename and we know where a stub would go.
          // Suppressed mid-walk too: an incomplete index can't answer
          // "does this note exist", and offering New: for an existing
          // note would mislead (the stub itself is idempotent, so the
          // damage would be cosmetic — but don't offer it). The row pins
          // inside the popover's render window (ITEM_LIMIT_VISIBLE) so a
          // many-match query can't push the entry point off-screen.
          return withCreateNoteRow(
            opts.rank(all, query),
            all,
            query,
            !!opts.getVaultRoot?.() && !(opts.isLoading?.() ?? false),
            ITEM_LIMIT_VISIBLE
          )
        },

        // The matcher's `range.from` points at the first `[` of `[[`, so
        // replacing [from, to] cleanly swaps the user's in-progress
        // trigger for the resolved link.
        //
        //   Obsidian (default): insert `[[basename]]` / `[[query]]` (the
        //     create row's [[query]] is already its final form).
        //   OKF (D3 expand-on-resolve): NO double-bracket link ever
        //     persists. An EXISTING-note pick inserts a standard markdown
        //     relative link with the on-disk SLUG as link text (D6). The
        //     CREATE row inserts a plain-text PLACEHOLDER (the human name)
        //     and hands its range to the host, which rewrites it to a
        //     markdown link once the stub's path is known (onCreated).
        command: ({ editor, range, props }) => {
          const item = props as VaultFile | CreateNoteItem
          const mode = opts.getMode?.() ?? 'obsidian'
          const docPath = opts.getDocPath?.() ?? null
          const okf = mode === 'okf' && !!docPath

          let insert: string
          if (isCreateNoteItem(item)) {
            // OKF: a bare-text placeholder (the human name) that the host
            // rewrites to a markdown link on stub-create. Obsidian: the
            // canonical [[query]] form, already final.
            insert = okf ? item.query : `[[${item.query}]]`
          } else if (okf) {
            // Existing-note pick — link text = the on-disk slug (D6).
            insert = okfLinkInsert(item.basename, docPath as string, item.absPath)
          } else {
            insert = `[[${item.basename}]]`
          }

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
            // OKF: the placeholder occupies [range.from, range.from +
            // insert.length]; the host rewrites that span once the stub
            // path is known. Obsidian: no rewrite needed (range null).
            const placeholderRange = okf
              ? { from: range.from, to: range.from + insert.length }
              : null
            opts.onCreateStub?.({ name: item.query, rect, range: placeholderRange })
          }
        },

        // BUG-271 — the popover lifecycle (dismissed / suspended state
        // machine) is shared with the sibling suggester; see
        // suggestionLifecycle.ts.
        render: lifecycle.render
      })
    ]
  }
})
