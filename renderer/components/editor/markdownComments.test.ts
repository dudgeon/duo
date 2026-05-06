// FOLLOWUP-009 — markdown comment reconciliation regression coverage.
//
// `findExcerptIndex` is the load-bearing primitive for re-anchoring
// markdown comments on file load: it locates a comment's excerpt
// inside the current doc text, using contextBefore + contextAfter as
// disambiguators when the same excerpt occurs multiple times. If this
// function regresses (e.g. context window is computed with the wrong
// slice bounds, exact-match logic forgets to compare), comments
// silently re-anchor to the wrong place after file reload.

import { describe, it, expect } from 'vitest'
import { findExcerptIndex } from './markdownComments'

describe('findExcerptIndex (FOLLOWUP-009 — comment re-anchor reconciliation)', () => {
  it('finds the only occurrence of a unique excerpt without context', () => {
    const doc = 'Phase 4 retest\n\nFirst paragraph.\n\nSecond paragraph.'
    expect(findExcerptIndex(doc, 'First paragraph')).toBe(16)
  })

  it('finds the first occurrence when there are multiple and no context is given', () => {
    const doc = 'paragraph one\nparagraph two\nparagraph three'
    expect(findExcerptIndex(doc, 'paragraph')).toBe(0)
  })

  it('disambiguates between multiple occurrences using contextBefore', () => {
    const doc = 'foo paragraph bar\nbaz paragraph quux'
    // First occurrence: "foo " before; second: "baz " before
    expect(findExcerptIndex(doc, 'paragraph', 'foo ', '')).toBe(4)
    expect(findExcerptIndex(doc, 'paragraph', 'baz ', '')).toBe(22)
  })

  it('disambiguates between multiple occurrences using contextAfter', () => {
    const doc = 'first match here\nsecond match there'
    expect(findExcerptIndex(doc, 'match', '', ' here')).toBe(6)
    expect(findExcerptIndex(doc, 'match', '', ' there')).toBe(24)
  })

  it('combines contextBefore + contextAfter for tighter disambiguation', () => {
    const doc = 'A then B then A then B'
    // "B" appears twice; only the second has " then A" before AND nothing after... wait
    // First B at index 7; preceded by "A then ", followed by " then A then B" (length 14)
    // Second B at index 21 (last char); preceded by " then ", followed by "" (end of string)
    expect(findExcerptIndex(doc, 'B', 'A then ', ' then A then B')).toBe(7)
  })

  it('returns -1 when the excerpt is not in the doc', () => {
    const doc = 'Phase 4 retest\n\nFirst paragraph.'
    expect(findExcerptIndex(doc, 'missing excerpt')).toBe(-1)
  })

  it('returns -1 when context disambiguators eliminate every match', () => {
    const doc = 'paragraph one\nparagraph two'
    // No occurrence of "paragraph" has "WRONG" before it
    expect(findExcerptIndex(doc, 'paragraph', 'WRONG', '')).toBe(-1)
  })

  it('returns -1 on empty excerpt (defensive guard)', () => {
    expect(findExcerptIndex('any doc text', '')).toBe(-1)
  })

  it('falls back to first occurrence when context is undefined (no disambiguation requested)', () => {
    const doc = 'foo bar foo bar foo'
    expect(findExcerptIndex(doc, 'foo')).toBe(0)
  })

  it('handles excerpt at the very start of the doc (no contextBefore available)', () => {
    const doc = 'header\n\nbody'
    // Note: contextBefore is empty string, so beforeOk passes trivially
    expect(findExcerptIndex(doc, 'header', '', '\n\nbody')).toBe(0)
  })

  it('handles excerpt at the very end of the doc (no contextAfter available)', () => {
    const doc = 'body\nfooter'
    // contextAfter empty → afterOk passes trivially
    expect(findExcerptIndex(doc, 'footer', 'body\n', '')).toBe(5)
  })

  it('correctly disambiguates the canvas regression-shape case (3 paragraphs same word)', () => {
    // Mirrors the v067r6-md.md scaffold from the rev6 walk —
    // "First paragraph", "Second paragraph", "Third paragraph" with
    // "paragraph" common. Sidecar excerpts are "First paragraph" /
    // "Second paragraph" / "Third paragraph"; context picks the right one.
    const doc = '# Phase 4 retest\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.'
    // Compute reference indices from the doc literal (so the test
    // doesn't drift if the literal changes).
    const firstIdx = doc.indexOf('First paragraph')
    const secondIdx = doc.indexOf('Second paragraph')
    const thirdIdx = doc.indexOf('Third paragraph')
    expect(findExcerptIndex(doc, 'First paragraph', '\n\n', '.\n\n')).toBe(firstIdx)
    expect(findExcerptIndex(doc, 'Second paragraph', '.\n\n', '.\n\n')).toBe(secondIdx)
    expect(findExcerptIndex(doc, 'Third paragraph', '.\n\n', '.')).toBe(thirdIdx)
  })
})
