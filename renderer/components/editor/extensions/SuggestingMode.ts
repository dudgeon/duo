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
import { Plugin, PluginKey, Selection, type Transaction } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Mapping } from '@tiptap/pm/transform'

export interface SuggestingModeStorage {
  enabled: boolean
  getAuthor: () => string
}

const META_AUTO = 'duo-suggesting-auto'

export const SuggestingMode = Extension.create<unknown, SuggestingModeStorage>({
  name: 'suggestingMode',
  // BUG-138 Phase 4c walk-1 fix — bump priority so Backspace/Delete
  // reach our keymap handler BEFORE StarterKit / List / Code-block /
  // Table extensions claim them. Default priority is 100; many
  // built-in extensions register handlers for Backspace (unindent
  // list, exit code block, merge node boundaries, etc.) and would
  // shadow our handler silently. Priority 1000 keeps us at the
  // front of the keymap dispatch order when Suggesting is ON; our
  // handler returns `false` when Suggesting is OFF so default
  // behavior remains untouched in that path.
  priority: 1000,

  addStorage() {
    return {
      enabled: false,
      getAuthor: () => ''
    }
  },

  // Phase 4c — Backspace + Delete intercept. When Suggesting is on,
  // instead of removing characters, wrap them with DeletionMark so
  // they stay visible struck-through. The parser's substitution
  // fold (adjacent del+ins → `{~~old~>new~~}`) handles the
  // type-over-selection case automatically at serialize time.
  // Phase 4c handled inside the PM plugin's `handleKeyDown` (below)
  // rather than via `addKeyboardShortcuts`. Walk-2 surfaced that the
  // TipTap keymap aggregation can be shadowed by peer extensions even
  // at high priority — `handleKeyDown` is a per-plugin hook that runs
  // BEFORE the keymap pipeline, giving us a clean intercept.

  addProseMirrorPlugins() {
    const ext = this
    return [
      new Plugin({
        key: new PluginKey('duo-suggesting-mode'),

        props: {
          // BUG-138 Phase 4c walk-2 fix — capture Backspace/Delete here
          // (props.handleKeyDown), which fires BEFORE PM's keymap plugin
          // chain. Returns true when handled (default is suppressed) and
          // false when Suggesting is off or the cursor is in a code
          // block etc., so default behavior runs in those paths.
          handleKeyDown(view, event) {
            if (!ext.storage.enabled) return false
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false
            const direction: 'backspace' | 'delete' = event.key === 'Backspace' ? 'backspace' : 'delete'
            return wrapAsDeletionWithView(ext, view, direction)
          }
        },

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

          // BUG-138 walk-1 fix — DON'T stamp `ts` per-TR. PM compares
          // marks by type + attrs deep-equality; a fresh `ts` per
          // character makes every char's mark distinct, which breaks
          // text-node merging and produces `{++a++}{++b++}{++c++}` on
          // serialize instead of one `{++abc++}`. Only `author` ever
          // varies across a real Suggesting session; ts on non-comment
          // CM ops isn't even part of the standard tokens, so we drop
          // it here and let the schema default (`ts: null`) merge.
          const author = storage.getAuthor() || 'agent'

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
              tr.addMark(finalStart, finalEnd, insMark.create({ author }))
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

/**
 * Phase 4c — implement Backspace/Delete as "wrap with DeletionMark"
 * when Suggesting is on. Returns `true` to swallow the keystroke
 * (so the default delete doesn't run), `false` to pass through.
 *
 * Walk-2 refactor: takes an `EditorView` directly (callable from
 * `props.handleKeyDown` in the PM plugin) rather than reaching for
 * the editor via `ext.editor`. Same logic, cleaner signature.
 *
 * Behavior:
 *   - Suggesting off → return false (default delete behavior).
 *   - In a code block → return false (CM tokens don't belong in
 *     fenced code; let the user delete normally).
 *   - Non-empty selection → wrap the range with DeletionMark, then
 *     move the cursor past the marked range. Return true.
 *   - Empty selection on Backspace → select the previous character +
 *     wrap with DeletionMark + park cursor right after.
 *   - Empty selection on Delete → select the next character + wrap +
 *     park cursor right before.
 *   - No previous/next character (boundary) → return false (let
 *     default delete handle node-merging logic).
 */
function wrapAsDeletionWithView(
  ext: { storage: SuggestingModeStorage },
  view: EditorView,
  direction: 'backspace' | 'delete'
): boolean {
  if (!ext.storage.enabled) return false
  const state = view.state
  const schema = state.schema
  const DelMark = schema.marks.deletionMark
  if (!DelMark) return false

  const { from, to, $from } = state.selection
  // Code block check: don't wrap deletions inside code blocks.
  const parent = $from.parent
  if (parent.type.name === 'codeBlock') return false

  // BUG-138 walk-1 fix — same merge-killing concern as Phase 4b. Don't
  // stamp ts on the deletion mark; same-author single mark merges
  // across consecutive Backspace strokes.
  const author = ext.storage.getAuthor() || 'agent'
  const mark = DelMark.create({ author })

  if (from !== to) {
    // Non-empty selection. Wrap with DeletionMark + collapse cursor
    // to the end of the marked range.
    const tr = state.tr.addMark(from, to, mark).setSelection(
      Selection.near(state.doc.resolve(to))
    )
    tr.setMeta(META_AUTO, true)
    view.dispatch(tr)
    return true
  }

  if (direction === 'backspace') {
    if (from <= 1) return false  // doc start; let default handle
    const prevPos = from - 1
    // If the previous character is already inside a deletion mark, fall
    // through to the default delete (so the user can actually back out
    // of the marked range).
    const $prev = state.doc.resolve(prevPos)
    if (DelMark.isInSet($prev.marks())) return false
    const tr = state.tr.addMark(prevPos, from, mark).setSelection(
      Selection.near(state.doc.resolve(prevPos))
    )
    tr.setMeta(META_AUTO, true)
    view.dispatch(tr)
    return true
  } else {
    // delete-forward
    const nextPos = to + 1
    if (nextPos > state.doc.content.size) return false  // doc end
    const $next = state.doc.resolve(to)
    if (DelMark.isInSet($next.marks())) return false
    const tr = state.tr.addMark(to, nextPos, mark).setSelection(
      Selection.near(state.doc.resolve(nextPos))
    )
    tr.setMeta(META_AUTO, true)
    view.dispatch(tr)
    return true
  }
}
