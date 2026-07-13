// @vitest-environment jsdom
//
// Regression — Suggesting mode must not swallow edits inside an inline
// `code` span. StarterKit's inline `code` mark has `excludes: '_'`, so the
// CriticMarkup insertion/deletion marks can never coexist with it.
//
// ENH-260 rework (package S4) — the BUG-138-era `wrapAsDeletionWithView`
// helper this suite used to call directly is gone. `SuggestingMode.ts` is
// now a thin plugin: `handleKeyDown` only records Backspace/Delete
// direction + does the D4 caret-skip; ALL actual tracking decisions —
// including the code-context skip rules (D10) — are the pure
// `suggestEngine.buildSuggestionTr` reconciler's, via `appendTransaction`.
// So these tests drive real transactions (`editor.view.dispatch(...)`)
// instead of calling an isolated helper, mirroring what a real keystroke
// produces: jsdom doesn't perform the native contenteditable delete a
// browser would on Backspace/Delete, so a `tr.delete(from, to)` dispatch
// stands in for "the browser just removed this character/range" — exactly
// the sequence `appendTransaction` reconciles in production.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { AddMarkStep } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { SuggestingMode } from './extensions/SuggestingMode'

const editor = new Editor({
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

afterAll(() => editor.destroy())

// "a code b" with "code" as an inline-code span.
const inlineCodeDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
      { type: 'text', text: ' b' }
    ]
  }]
}

// Reach the installed SuggestingMode plugin instance and call its
// `handleKeyDown` prop directly — the same function the real keydown path
// invokes — without going through ProseMirror's full plugin-array
// aggregation. Deliberately NOT `view.someProp('handleKeyDown', ...)` here:
// StarterKit's own `Keymap` extension also registers a `handleKeyDown` prop
// (its Backspace/Delete bindings ultimately call `deleteSelection`), and for
// a NON-collapsed selection that binding actually deletes — which would
// race with the manual `tr.delete` these tests issue right after to pin the
// exact simulated range. Looking the plugin up by its (module-unique) key
// isolates the call to SuggestingMode's own decision.
function suggestingModeHandleKeyDown(key: 'Backspace' | 'Delete'): boolean {
  const plugin = editor.state.plugins.find(p => (p as unknown as { key: string }).key === 'duo-suggesting-mode$')
  const handler = plugin?.props.handleKeyDown as
    | ((view: EditorView, event: KeyboardEvent) => boolean | void)
    | undefined
  if (!handler) throw new Error('suggestingMode plugin not installed')
  return !!handler(editor.view, new KeyboardEvent('keydown', { key }))
}

beforeEach(() => {
  ;(editor.storage as any).suggestingMode.enabled = true
  ;(editor.storage as any).suggestingMode.getAuthor = () => 'tester'
  editor.commands.setContent(inlineCodeDoc)
})

describe('Suggesting mode + inline code', () => {
  it('typing inside inline code keeps the char (untracked, not swallowed)', () => {
    editor.commands.setTextSelection(5) // "co|de"
    editor.commands.insertContent('X')
    expect(editor.getText()).toBe('a coXde b')
    // No insertion mark inside the code span — tracking is impossible there.
    expect(JSON.stringify(editor.getJSON())).not.toContain('insertionMark')
  })

  // Falsifiable at the transaction level: pre-fix the extension's
  // appendTransaction emitted a META_AUTO transaction carrying a no-op
  // AddMarkStep over the code-marked insert (the redraw that swallowed
  // the typed char on the native-input path). Post-fix it must append
  // NOTHING when the whole inserted range is code-marked. Asserting on
  // the appended transactions (via state.applyTransaction) catches the
  // bug that doc-level assertions miss — the schema silently refuses
  // the mark either way, so the doc looks identical pre/post fix.
  it('insert fully inside inline code appends NO auto-mark transaction', () => {
    const tr = editor.state.tr.insertText('X', 5) // inside "code"
    const { transactions } = editor.state.applyTransaction(tr)
    const appended = transactions.filter(t => t.getMeta('duo-suggesting-auto'))
    const markSteps = appended.flatMap(t => t.steps).filter(s => s instanceof AddMarkStep)
    expect(markSteps).toHaveLength(0)
    expect(appended).toHaveLength(0)
  })

  // Mixed insert (plain text + code span in one paste): the insertion
  // mark is applied unconditionally; Mark.addToSet enforces the code
  // mark's excludes:'_' per text node, so the plain fragment is tracked
  // and the code fragment is left untracked.
  it('mixed paste tracks the plain fragment but not the code fragment', () => {
    editor.commands.setTextSelection(8) // inside " b", after the space
    editor.commands.insertContent([
      { type: 'text', text: 'plain' },
      { type: 'text', text: 'span', marks: [{ type: 'code' }] }
    ])
    const para = editor.getJSON().content![0]
    const textNodes = (para.content ?? []) as Array<{ text?: string; marks?: Array<{ type: string }> }>
    const plainNode = textNodes.find(n => n.text?.includes('plain'))
    const codeNode = textNodes.find(n => n.text === 'span')
    expect(plainNode?.marks?.some(m => m.type === 'insertionMark')).toBe(true)
    expect(codeNode?.marks?.some(m => m.type === 'code')).toBe(true)
    expect(codeNode?.marks?.some(m => m.type === 'insertionMark')).toBeFalsy()
  })

  it('Backspace fully inside inline code performs a NATIVE untracked delete', () => {
    editor.commands.setTextSelection(5) // "co|de" — Backspace removes "o"
    // The plugin declines (no deletion run sits at this caret) — it only
    // records direction and lets the (simulated) native delete proceed.
    expect(suggestingModeHandleKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(4, 5))
    expect(editor.getText()).toBe('a cde b')
    expect(JSON.stringify(editor.getJSON())).not.toContain('deletionMark')
  })

  it('forward-delete fully inside inline code performs a NATIVE untracked delete', () => {
    editor.commands.setTextSelection(4) // "c|ode" — Delete removes "o"
    expect(suggestingModeHandleKeyDown('Delete')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(4, 5))
    expect(editor.getText()).toBe('a cde b')
    expect(JSON.stringify(editor.getJSON())).not.toContain('deletionMark')
  })

  it('selection-delete fully inside inline code performs a NATIVE untracked delete', () => {
    editor.commands.setTextSelection({ from: 4, to: 6 }) // "od" within code
    expect(suggestingModeHandleKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(4, 6))
    expect(editor.getText()).toBe('a ce b')
    expect(JSON.stringify(editor.getJSON())).not.toContain('deletionMark')
  })

  // ENH-260 supersedes the old whole-range-declines rule. Previously a
  // selection straddling a code-span boundary declined tracking for the
  // WHOLE range (a native, untracked delete of everything selected). The
  // new engine tracks the PLAIN slice (struck, reinstated) and leaves the
  // CODE slice untracked — D10's mixed-slice rule reinstates the code
  // portion bare (verbatim, unmarked, since CriticMarkup can't wrap code)
  // alongside the struck plain portion, rather than discarding tracking
  // for the whole range. This is the PRD-correct mixed-slice disposition
  // and matches Tiptap Pro's documented handling of a suggestion straddling
  // an uneditable/unmarkable span.
  it('selection-delete straddling a code boundary tracks the plain slice, leaves the code slice untracked', () => {
    editor.commands.setTextSelection({ from: 2, to: 5 }) // " co" — plain space + "co"
    expect(suggestingModeHandleKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(2, 5))
    // Net text is unchanged: the struck space is still present (a pending
    // suggestion, not a removal) and the code slice was reinstated bare.
    expect(editor.getText()).toBe('a code b')
    const para = editor.getJSON().content![0]
    const nodes = (para.content ?? []) as Array<{ text?: string; marks?: Array<{ type: string }> }>
    // No code-marked text carries a deletionMark — D10 keeps code untracked.
    for (const n of nodes) {
      if (n.marks?.some(m => m.type === 'code')) {
        expect(n.marks?.some(m => m.type === 'deletionMark')).toBeFalsy()
      }
    }
    // The plain (non-code) slice DOES carry a deletionMark — the struck space.
    expect(
      nodes.some(n => !n.marks?.some(m => m.type === 'code') && n.marks?.some(m => m.type === 'deletionMark'))
    ).toBe(true)
  })
})

describe('Suggesting mode outside inline code (no regression)', () => {
  beforeEach(() => {
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }]
    })
  })

  it('Backspace on plain text is tracked as a deletion via the reconciler', () => {
    editor.commands.setTextSelection(6) // after "hello"
    // The plugin itself never wraps a deletion anymore — it only records
    // direction. The reconciler (appendTransaction) does the tracking once
    // the (simulated) native delete actually removes the character.
    expect(suggestingModeHandleKeyDown('Backspace')).toBe(false)
    editor.view.dispatch(editor.state.tr.delete(5, 6))
    expect(JSON.stringify(editor.getJSON())).toContain('deletionMark')
  })

  it('typing plain text is tracked as an insertion', () => {
    editor.commands.setTextSelection(6)
    editor.commands.insertContent('X')
    expect(JSON.stringify(editor.getJSON())).toContain('insertionMark')
  })
})
