// @vitest-environment jsdom
//
// ENH-208 Phase 2 (D22) — the occurrence scan + jump the vault-search
// palette relies on. The scanner contract under test: case-insensitive
// substring, document order across blocks, Nth-occurrence addressing
// with first-match / top-of-doc fallbacks (the disk hit can live in
// frontmatter, which the doc body doesn't contain).

import { describe, it, expect, afterAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { findAllMatches } from './extensions/FindHighlight'
import { jumpToMatch, pickGotoTarget } from './gotoMatchJump'

// Attached element — jumpToMatch chains .focus(), and ProseMirror's
// focus path needs the view's DOM in the document.
const host = document.createElement('div')
document.body.appendChild(host)

const editor = new Editor({
  element: host,
  extensions: [StarterKit]
})

afterAll(() => editor.destroy())

// Doc text (PM positions): p1 "Alpha beta ALPHA" → "Alpha"@1, "ALPHA"@12;
// p2 "alpha end" → "alpha"@19. Three case-variant occurrences in
// document order.
function loadFixture() {
  editor.commands.setContent('<p>Alpha beta ALPHA</p><p>alpha end</p>')
}

describe('findAllMatches — the scan semantics the jump reuses', () => {
  it('matches case-insensitively in document order with PM positions', () => {
    loadFixture()
    const matches = findAllMatches(editor.state.doc, 'alpha', false)
    expect(matches).toEqual([
      { from: 1, to: 6 },
      { from: 12, to: 17 },
      { from: 19, to: 24 }
    ])
  })

  it('returns [] when the query is absent', () => {
    loadFixture()
    expect(findAllMatches(editor.state.doc, 'zzz', false)).toEqual([])
  })
})

describe('pickGotoTarget — Nth occurrence with fallbacks', () => {
  const matches = [
    { from: 1, to: 6 },
    { from: 12, to: 17 }
  ]

  it('picks the Nth match (0-based)', () => {
    expect(pickGotoTarget(matches, 1)).toEqual({ from: 12, to: 17 })
  })

  it('falls back to the FIRST match when matchIndex overshoots', () => {
    expect(pickGotoTarget(matches, 7)).toEqual({ from: 1, to: 6 })
  })

  it('returns null when there are no matches', () => {
    expect(pickGotoTarget([], 0)).toBeNull()
  })
})

describe('jumpToMatch — selection lands on the occurrence', () => {
  it('selects the Nth occurrence', () => {
    loadFixture()
    expect(jumpToMatch(editor, { query: 'alpha', matchIndex: 2 })).toBe(true)
    expect(editor.state.selection.from).toBe(19)
    expect(editor.state.selection.to).toBe(24)
  })

  it('is case-insensitive on the query side too', () => {
    loadFixture()
    expect(jumpToMatch(editor, { query: 'ALPHA', matchIndex: 1 })).toBe(true)
    expect(editor.state.selection.from).toBe(12)
  })

  it('overshooting matchIndex falls back to the first occurrence', () => {
    loadFixture()
    expect(jumpToMatch(editor, { query: 'alpha', matchIndex: 9 })).toBe(true)
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
  })

  it('no matches at all → top-of-doc, returns false', () => {
    loadFixture()
    expect(jumpToMatch(editor, { query: 'qqq-not-here', matchIndex: 0 })).toBe(false)
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.empty).toBe(true)
  })
})
