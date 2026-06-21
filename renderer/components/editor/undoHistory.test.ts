// @vitest-environment jsdom
//
// ENH-221 Track 1 — in-editor Cmd+Z (undo) correctness.
//
// Owner directive (2026-06-20): native undo must work as a user expects in
// EVERY scenario, independent of the history-modal feature. The reported
// "undo does nothing" symptom is undo-stack POLLUTION: programmatic passes
// that re-materialize marks after a load/reload (CriticMarkup tokens → marks,
// sidecar comments → marks) were dispatched WITHOUT `addToHistory:false`, so a
// Cmd+Z could land on an invisible mark-reapplication instead of the user's
// last visible change.
//
// These tests pin the contract with `undoDepth()` — the exact count of
// undoable steps — so a regression (dropping the guard) fails loudly. Live
// TipTap in jsdom, mirroring suggestInlineCode.test.ts / trackedDiff.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { undoDepth, closeHistory } from '@tiptap/pm/history'
import { InsertionMark } from './extensions/InsertionMark'
import { DeletionMark } from './extensions/DeletionMark'
import { HighlightMark } from './extensions/HighlightMark'
import { CommentMark } from './extensions/CommentMark'
import { SuggestingMode } from './extensions/SuggestingMode'
import { applyCriticMarkupFromText } from './markdownCriticMarkup'
import { applyCommentMarksFromSidecar } from './markdownComments'
import type { SidecarV1 } from '../Page/sidecar'

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
      CommentMark,
      SuggestingMode
    ],
    content: ''
  })
})
afterEach(() => editor.destroy())

// A single-paragraph doc with `text` (or empty paragraph when omitted).
function para(text?: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }]
  }
}
// Force a history-group boundary so undoDepth reflects discrete steps rather
// than time-coalesced typing groups.
function closeGroup() {
  editor.view.dispatch(closeHistory(editor.state.tr))
}
function hasMark(name: string): boolean {
  let found = false
  editor.state.doc.descendants((n) => {
    if (n.marks?.some((m) => m.type.name === name)) found = true
  })
  return found
}

describe('ENH-221 — undo stack correctness', () => {
  it('baseline: user edits are undoable and revert as expected', () => {
    editor.commands.setContent(para('hello'), false)
    closeGroup()
    const depth0 = undoDepth(editor.state)
    editor.commands.insertContent(' world')
    expect(undoDepth(editor.state)).toBe(depth0 + 1)
    editor.commands.undo()
    expect(editor.getText()).toBe('hello')
  })

  it('CriticMarkup materialization (load/reload pass) adds NO undo step', () => {
    // Loaded/reloaded content carrying a CriticMarkup token.
    editor.commands.setContent(para('keep {++added++} text'), false)
    closeGroup()
    const before = undoDepth(editor.state)

    const converted = applyCriticMarkupFromText(editor)
    expect(converted).toBeGreaterThan(0)                 // it really did convert
    expect(editor.getText()).not.toContain('{++')        // token → InsertionMark
    expect(hasMark('insertionMark')).toBe(true)

    // The pollution guard: materializing marks must not consume a Cmd+Z.
    expect(undoDepth(editor.state)).toBe(before)
  })

  it('comment re-anchoring from the sidecar (reload pass) adds NO undo step', () => {
    editor.commands.setContent(para('anchor word here'), false)
    closeGroup()
    const before = undoDepth(editor.state)

    const sidecar: SidecarV1 = {
      version: 1,
      comments: [{ id: 'm1', anchorId: 'c1', author: 'a', ts: 't', body: 'note', excerpt: 'anchor' }]
    }
    const applied = applyCommentMarksFromSidecar(editor, sidecar)
    expect(applied).toBe(1)
    expect(hasMark('commentMark')).toBe(true)

    expect(undoDepth(editor.state)).toBe(before)
  })

  it('user-created comment IS undoable (the guard did not over-reach)', () => {
    editor.commands.setContent(para('select me'), false)
    closeGroup()
    const before = undoDepth(editor.state)

    // Default call (no addToHistory arg) → undoable, as a human comment should be.
    editor.commands.applyCommentMark({ commentId: 'u1', author: 'me', ts: 't', body: 'b' }, 1, 7)
    expect(hasMark('commentMark')).toBe(true)
    expect(undoDepth(editor.state)).toBe(before + 1)

    editor.commands.undo()
    expect(hasMark('commentMark')).toBe(false)   // the comment is gone
    expect(editor.getText()).toBe('select me')   // the text is intact
  })
})
