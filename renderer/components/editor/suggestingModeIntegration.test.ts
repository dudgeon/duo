// @vitest-environment jsdom
//
// ENH-260 package S4 — full-stack integration tests for the rewritten
// SuggestingMode plugin (docs/prd/enh-260-track-changes-composition.md).
// `suggestEngine.test.ts` already covers the pure kernel exhaustively
// against synthetic `EditorState`/`Transaction` pairs; this suite drives
// the SAME scenarios through a LIVE `Editor` — real dispatches, the real
// plugin's `handleKeyDown` + `appendTransaction`, and the real consumers
// (`serializeWithCriticMarkup`, `collectTrackedChanges`,
// `acceptAllTrackedChanges`/`rejectAllTrackedChanges`) — to prove the
// pieces compose correctly end to end.
//
// Four permanent regression tests implement the § 3.1 acceptance probes
// (P1-P4); a "property battery" describe block implements § 3.2.
//
// Pattern notes:
//   - Fresh `Editor` per test (`beforeEach`), mirroring `undoHistory.test.ts`
//     — undo history and doc state never leak across tests.
//   - Deletes/type-overs are dispatched as real transactions
//     (`editor.view.dispatch(editor.state.tr...)`) so `appendTransaction`
//     reconciles them exactly as production does; jsdom doesn't perform a
//     native contenteditable delete on its own, so the manual `tr.delete`
//     stands in for "the browser just removed this text" (same convention
//     as `suggestInlineCode.test.ts`).
//   - D4 caret-skip is exercised via `editor.view.someProp('handleKeyDown',
//     f => f(editor.view, new KeyboardEvent(...)))`, mirroring a real DOM
//     keydown reaching the plugin through ProseMirror's full prop
//     aggregation. NOTE: `someProp` returns `undefined` (not `false`) when
//     no plugin's handler returns a truthy value, so assertions below use
//     `Boolean(...)`/`toBeFalsy()` rather than `toBe(false)`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { closeHistory } from '@tiptap/pm/history'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { SuggestingMode } from './extensions/SuggestingMode'
import { checkSuggestionInvariant } from './suggestEngine'
import {
  serializeWithCriticMarkup,
  preprocessSubstitutions,
  applyCriticMarkupFromText
} from './markdownCriticMarkup'
import { collectTrackedChanges, acceptAllTrackedChanges, rejectAllTrackedChanges } from './trackedChanges'

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown.configure({ html: false }),
      InsertionMark,
      DeletionMark,
      HighlightMark,
      SuggestingMode
    ],
    content: ''
  })
  ;(editor.storage as any).suggestingMode.enabled = true
  ;(editor.storage as any).suggestingMode.getAuthor = () => 'tester'
})

afterEach(() => editor.destroy())

// ── shared helpers ──────────────────────────────────────────────────────

/** PRD § 3.2 — the reconciler must never leave the doc in a state
 *  `checkSuggestionInvariant` flags, after ANY step of ANY scenario. */
function assertInvariantClean(): void {
  expect(checkSuggestionInvariant(editor.state.doc)).toEqual([])
}

function setBaseline(text: string): void {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
  assertInvariantClean()
}

/** Fire the plugin's `handleKeyDown` the way a real DOM keydown would —
 *  through the full plugin-prop aggregation (`someProp`), not an isolated
 *  function call. See the file header re: `someProp`'s `undefined` vs
 *  `false` return. */
function fireKeyDown(key: 'Backspace' | 'Delete'): boolean {
  return Boolean(
    editor.view.someProp('handleKeyDown', f => f(editor.view, new KeyboardEvent('keydown', { key })))
  )
}

type JsonMark = { type: string }
type JsonTextNode = { text?: string; marks?: JsonMark[] }
function paraContent(): JsonTextNode[] {
  const para = editor.getJSON().content?.[0] as { content?: JsonTextNode[] } | undefined
  return para?.content ?? []
}
function hasMark(node: JsonTextNode | undefined, type: string): boolean {
  return !!node?.marks?.some(m => m.type === type)
}

// ── P1 — net-zero delete of your own just-typed insertion (D1) ─────────

describe('ENH-260 P1 — net-zero delete of your own just-typed insertion', () => {
  it('type "XY", backspace over "Y" -> "Hello {++X++}world"; rail shows one insertion "X"', () => {
    setBaseline('Hello world')

    editor.commands.setTextSelection(7)
    editor.view.dispatch(editor.state.tr.insertText('XY', 7))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello XYworld')

    // Caret after "XY" (position 9), about to Backspace over "Y" — mirror
    // the browser sequence: handleKeyDown sees it first (records
    // direction, declines — "Y" isn't itself struck, nothing to
    // caret-skip), THEN the native delete happens.
    editor.commands.setTextSelection(9)
    expect(fireKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(8, 9))
    assertInvariantClean()

    expect(editor.getText()).toBe('Hello Xworld')
    expect(serializeWithCriticMarkup(editor)).toBe('Hello {++X++}world')
    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({ kind: 'insertion', text: 'X' })
  })

  it('a single undo reverts the whole net-zero sequence cleanly (no orphaned marks)', () => {
    setBaseline('Hello world')
    editor.view.dispatch(closeHistory(editor.state.tr)) // scope undo to what follows

    editor.commands.setTextSelection(7)
    editor.view.dispatch(editor.state.tr.insertText('XY', 7))
    editor.commands.setTextSelection(9)
    fireKeyDown('Backspace')
    editor.view.dispatch(editor.state.tr.delete(8, 9))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello Xworld')

    editor.commands.undo()
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello world')
    const json = JSON.stringify(editor.getJSON())
    expect(json).not.toContain('insertionMark')
    expect(json).not.toContain('deletionMark')
  })
})

// ── P2 — type-over a plain selection (reading order + save-time fold) ──

describe('ENH-260 P2 — type-over a plain selection', () => {
  it('select "world", type "planet" -> struck "world" then inserted "planet", in that order', () => {
    setBaseline('Hello world')

    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.view.dispatch(editor.state.tr.insertText('planet', 7, 12))
    assertInvariantClean()

    const nodes = paraContent()
    expect(nodes.map(n => n.text)).toEqual(['Hello ', 'world', 'planet'])
    expect(hasMark(nodes.find(n => n.text === 'world'), 'deletionMark')).toBe(true)
    expect(hasMark(nodes.find(n => n.text === 'planet'), 'insertionMark')).toBe(true)

    // The RAW (pre-fold) doc shape is exactly the PRD § 3.1 P2 illustration
    // `Hello {--world--}{++planet++}` — the two assertions above pin it.
    // At save time `serializeWithCriticMarkup` folds the adjacent
    // del-then-ins pair into a `{~~old~>new~~}` substitution token. The
    // fold is emitted in control-char sentinel form and restored AFTER
    // tiptap-markdown's serializer runs, so the token's `~`/`>` delimiters
    // are never markdown-escaped (ENH-260 fold fix in
    // markdownCriticMarkup.ts — pre-fix this line observed the corrupted
    // `{\~\~world\~&gt;planet\~\~}`).
    expect(serializeWithCriticMarkup(editor)).toBe('Hello {~~world~>planet~~}')
  })

  it('the folded substitution round-trips: save -> load -> save is stable', () => {
    setBaseline('Hello world')
    editor.commands.setTextSelection({ from: 7, to: 12 })
    editor.view.dispatch(editor.state.tr.insertText('planet', 7, 12))
    const saved = serializeWithCriticMarkup(editor)
    expect(saved).toBe('Hello {~~world~>planet~~}')

    // Reload the saved source through the real load path: sentinel
    // preprocess -> setContent (parses as literal text) -> token-to-marks
    // walker. Suggesting stays enabled; the walker's addToHistory:false
    // meta must keep the reconciler out of the programmatic pass.
    editor.commands.setContent(preprocessSubstitutions(saved), false)
    applyCriticMarkupFromText(editor)
    assertInvariantClean()
    expect(serializeWithCriticMarkup(editor)).toBe(saved)
  })
})

// ── P3 — D4 caret-skip at a deletion-run edge, then extend leftward ────

describe('ENH-260 P3 — D4 caret-skip at a deletion-run edge', () => {
  it('Backspace at the run edge skips the caret; the next Backspace extends the run leftward', () => {
    setBaseline('Hello world')

    // Establish "world" as an already-struck deletion (a whole-word
    // Backspace at the doc's plain tail — declines at pos 12 since nothing
    // is struck yet, then the native delete reinstates it, reconciled).
    editor.commands.setTextSelection(12)
    expect(fireKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(7, 12))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello world')
    expect(hasMark(paraContent().find(n => n.text === 'world'), 'deletionMark')).toBe(true)

    // Re-anchor the caret to the struck run's RIGHT edge (position 12) to
    // exercise "Backspace at its right edge" independent of wherever the
    // reconciler's own D3/D4 caret placement left it after the step above.
    editor.commands.setTextSelection(12)
    expect(fireKeyDown('Backspace')).toBe(true) // consumed — caret-skip, no doc change
    assertInvariantClean()
    expect(editor.state.selection.from).toBe(7)
    expect(editor.state.selection.to).toBe(7)
    expect(editor.getText()).toBe('Hello world') // doc unchanged by the skip

    // The char before the NEW caret position (7) is the plain space, not
    // struck — the plugin declines (records direction) and the ensuing
    // native delete extends the tracked run leftward.
    expect(fireKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(6, 7))
    assertInvariantClean()

    const ranges = collectTrackedChanges(editor.state.doc)
    expect(ranges).toHaveLength(1)
    expect(ranges[0]).toMatchObject({ kind: 'deletion', text: ' world' })
  })
})

// ── P4 — typing inside an existing deletion relocates after the run ────

describe('ENH-260 P4 — D3 relocate: typing inside a deletion run', () => {
  it('insert "Z" mid-{--world--} relocates it after the run; caret lands after Z', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'deletionMark', attrs: { author: 'tester', ts: null } }] }
        ]
      }]
    })
    assertInvariantClean()

    editor.commands.setTextSelection(9) // "wo|rld" — strictly inside the struck run
    editor.view.dispatch(editor.state.tr.insertText('Z', 9))
    assertInvariantClean()

    expect(editor.getText()).toBe('Hello worldZ')
    const nodes = paraContent()
    const worldNode = nodes.find(n => n.text === 'world')
    const zNode = nodes.find(n => n.text === 'Z')
    expect(hasMark(worldNode, 'deletionMark')).toBe(true)
    expect(hasMark(worldNode, 'insertionMark')).toBe(false)
    expect(hasMark(zNode, 'insertionMark')).toBe(true)
    expect(hasMark(zNode, 'deletionMark')).toBe(false)

    // Caret sits right after "Z" — the end of the paragraph's content.
    const endPos = 1 + editor.state.doc.firstChild!.content.size
    expect(editor.state.selection.from).toBe(endPos)
    expect(editor.state.selection.to).toBe(endPos)

    // Raw shape is `{--world--}{++Z++}` (PRD § 3.1 P4); the save-time
    // fold emits the clean substitution token (see P2's fold-fix note).
    expect(serializeWithCriticMarkup(editor)).toBe('Hello {~~world~>Z~~}')
  })
})

// ── § 3.2 property battery ──────────────────────────────────────────────

describe('ENH-260 § 3.2 — property battery: accept/reject round-trip a scripted sequence', () => {
  // type "XY"; backspace over "Y" (own insertion, nets to zero); delete
  // "world" (plain, reinstated struck); type over "X" (own insertion) with
  // "planet". Mirrors `suggestEngine.test.ts`'s pure-kernel property
  // battery, replayed here through the live editor/plugin/dispatch path.
  function runScript(): void {
    editor.commands.setTextSelection(7)
    editor.view.dispatch(editor.state.tr.insertText('XY', 7))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello XYworld')

    editor.commands.setTextSelection(9)
    fireKeyDown('Backspace')
    editor.view.dispatch(editor.state.tr.delete(8, 9))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello Xworld')

    editor.commands.setTextSelection(13)
    fireKeyDown('Backspace')
    editor.view.dispatch(editor.state.tr.delete(8, 13))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello Xworld') // struck "world" still visible

    editor.commands.setTextSelection({ from: 7, to: 8 })
    editor.view.dispatch(editor.state.tr.insertText('planet', 7, 8))
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello planetworld')
  }

  it('acceptAllTrackedChanges reproduces the plain (no-tracking) script result', () => {
    setBaseline('Hello world')
    runScript()

    const accepted = acceptAllTrackedChanges(editor)
    expect(accepted).toBeGreaterThan(0)
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello planet')
  })

  it('rejectAllTrackedChanges reproduces the pre-script baseline', () => {
    setBaseline('Hello world')
    runScript()

    const rejected = rejectAllTrackedChanges(editor)
    expect(rejected).toBeGreaterThan(0)
    assertInvariantClean()
    expect(editor.getText()).toBe('Hello world')
  })
})
