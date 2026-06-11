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
