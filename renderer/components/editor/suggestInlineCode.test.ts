// @vitest-environment jsdom
//
// Regression — Suggesting mode must not swallow edits inside an inline
// `code` span. StarterKit's inline `code` mark has `excludes: '_'`, so
// the CriticMarkup insertion/deletion marks can never coexist with it.
// Before the fix, the suggesting-mode interceptors consumed the
// keystroke and applied a no-op mark: the caret moved but the text was
// neither edited nor tracked. The fix mirrors the existing fenced-code
// exclusion — bail out of the interception so the NATIVE (untracked)
// insert/delete runs inside inline code.

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { AddMarkStep } from '@tiptap/pm/transform'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { SuggestingMode, wrapAsDeletionWithView } from './extensions/SuggestingMode'

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

// Call the suggesting-mode delete interceptor in isolation (the same
// function the plugin's handleKeyDown delegates to). Returns true when
// it consumes the keystroke (wraps as a tracked deletion), false when it
// declines and lets ProseMirror's native delete run.
function suggestDelete(direction: 'backspace' | 'delete' = 'backspace'): boolean {
  const ext = { storage: (editor.storage as any).suggestingMode }
  return wrapAsDeletionWithView(ext, editor.view, direction)
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

  it('Backspace inside inline code is NOT consumed by the suggesting handler', () => {
    editor.commands.setTextSelection(6) // after "cod" inside the code span
    // Handler must decline (return false) so ProseMirror's native delete runs
    // instead of swallowing the keystroke.
    expect(suggestDelete('backspace')).toBe(false)
  })

  it('forward-delete inside inline code is NOT consumed by the handler', () => {
    editor.commands.setTextSelection(4) // "c|ode" — next char is inside code
    expect(suggestDelete('delete')).toBe(false)
  })

  it('selection-delete inside inline code is NOT consumed by the handler', () => {
    editor.commands.setTextSelection({ from: 4, to: 6 }) // "od" within code
    expect(suggestDelete('backspace')).toBe(false)
  })

  // Deliberate disposition — a selection straddling a code-span boundary
  // (plain text + code) declines tracking for the WHOLE range; a
  // half-tracked deletion would be semantically confusing.
  it('selection-delete straddling a code boundary declines (whole range untracked)', () => {
    editor.commands.setTextSelection({ from: 2, to: 5 }) // " co" — plain space + "co"
    expect(suggestDelete('backspace')).toBe(false)
    // Handler left the document untouched (native delete would run instead).
    expect(editor.getText()).toBe('a code b')
    expect(JSON.stringify(editor.getJSON())).not.toContain('deletionMark')
  })
})

describe('Suggesting mode outside inline code (no regression)', () => {
  beforeEach(() => {
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }]
    })
  })

  it('Backspace on plain text IS consumed and tracked as a deletion', () => {
    editor.commands.setTextSelection(6) // after "hello"
    expect(suggestDelete('backspace')).toBe(true)
    expect(JSON.stringify(editor.getJSON())).toContain('deletionMark')
  })

  it('typing plain text is tracked as an insertion', () => {
    editor.commands.setTextSelection(6)
    editor.commands.insertContent('X')
    expect(JSON.stringify(editor.getJSON())).toContain('insertionMark')
  })
})
