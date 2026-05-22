// BUG-122 — normalizeForEchoCompare regression coverage.
//
// This helper is the load-bearing equality check in the save-pre-reconcile
// path. Every false-positive banner that's ever hit production has been a
// gap in this normalize step. Pin down the contract.

import { describe, it, expect } from 'vitest'
import { normalizeForEchoCompare, computeFirstDiffOffset } from './conflictDiagnostic'

describe('normalizeForEchoCompare — pre-fix invariants (BUG-107 / BUG-122 v0.6.15)', () => {
  it('strips a leading UTF-8 BOM', () => {
    const withBom = '﻿hello'
    expect(normalizeForEchoCompare(withBom)).toBe('hello')
  })

  it('normalizes CRLF to LF', () => {
    const crlf = 'line one\r\nline two'
    expect(normalizeForEchoCompare(crlf)).toBe('line one line two')
    // (Soft-break collapse downstream merges the two lines into one space.)
  })

  it('strips per-line trailing whitespace', () => {
    // BUG-107 case: an editor adds trailing spaces that the watcher echo path
    // should ignore.
    const trail = 'foo   \nbar   '
    expect(normalizeForEchoCompare(trail)).toBe('foo bar')
  })

  it('strips document-end trailing whitespace', () => {
    expect(normalizeForEchoCompare('body\n\n\n')).toBe('body')
  })
})

describe('normalizeForEchoCompare — BUG-122 hypothesis 4 (soft-break ≡ space)', () => {
  it('collapses single newline between non-blank lines to a space', () => {
    // The exact v0.7.2 walk repro: disk has soft-break, baseline has space.
    const disk = '`description` row\nshould pretty-print'
    const baseline = '`description` row should pretty-print'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('preserves paragraph breaks (double newline)', () => {
    const twoParas = 'para one\n\npara two'
    expect(normalizeForEchoCompare(twoParas)).toBe('para one\n\npara two')
  })

  it('preserves triple-newline runs as the same byte sequence on both sides', () => {
    const triple = 'a\n\n\nb'
    // Triple-newline is unusual but not equivalent to double-newline — left as-is.
    expect(normalizeForEchoCompare(triple)).toBe('a\n\n\nb')
  })

  it('soft-break-vs-space normalized equal on both sides', () => {
    const a = 'word1\nword2'
    const b = 'word1 word2'
    expect(normalizeForEchoCompare(a)).toBe(normalizeForEchoCompare(b))
  })

  it('REAL external edit still surfaces — added paragraph break shows as diff', () => {
    const baseline = 'word1 word2 word3'   // tiptap-flattened soft-breaks
    const disk     = 'word1 word2\n\nword3' // external editor inserted a paragraph break
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
  })

  it('REAL external edit — added content shows as diff', () => {
    const baseline = 'lead text'
    const disk     = 'lead text plus more from someone else'
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
  })

  it('REAL external edit — content changed shows as diff', () => {
    const baseline = 'foo\nbar'
    const disk     = 'foo\nbaz'
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
  })

  it('soft-break followed by paragraph break stays distinct from pure paragraph break', () => {
    // disk has soft-break before the paragraph break; baseline has the same.
    const a = 'line1\nline2\n\npara2'
    const b = 'line1 line2\n\npara2'
    expect(normalizeForEchoCompare(a)).toBe(normalizeForEchoCompare(b))
  })
})

describe('normalizeForEchoCompare — BUG-122 hypothesis 6 (HTML-entity escape)', () => {
  it('repro from docs/about-duo.md (2026-05-22): disk literal `-->` ≡ baseline `--&gt;`', () => {
    const disk = '<!-- Feature deep dives — coming soon. -->'
    const baseline = '&lt;!-- Feature deep dives — coming soon. --&gt;'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('decodes &lt; / &gt; / &amp; / &quot; / &#39; consistently on both sides', () => {
    const disk = `<select> & "quotes" 'apos'`
    const baseline = `&lt;select&gt; &amp; &quot;quotes&quot; &#39;apos&#39;`
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('doubly-encoded &amp;lt; preserves one level of encoding (does not collapse to <)', () => {
    // If the user's source really had `&lt;` (as literal characters), tiptap
    // serializes that as `&amp;lt;`. Decoding once should give `&lt;`, not `<`.
    expect(normalizeForEchoCompare('&amp;lt;')).toBe('&lt;')
  })

  it('does NOT mask real divergence in content alongside entities', () => {
    const before = '<div>same</div>'
    const after = '<div>DIFFERENT</div>'
    expect(normalizeForEchoCompare(before)).not.toBe(normalizeForEchoCompare(after))
  })

  it('combined: soft-break + HTML-entity divergence still normalizes equal', () => {
    const disk = 'line1\nline2 <tag>'
    const baseline = 'line1 line2 &lt;tag&gt;'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })
})

describe('computeFirstDiffOffset', () => {
  it('returns null when strings are identical', () => {
    expect(computeFirstDiffOffset('abc', 'abc')).toBeNull()
  })

  it('finds the first differing character', () => {
    expect(computeFirstDiffOffset('abcdef', 'abcxef')).toBe(3)
  })

  it('returns length when one string is a prefix of the other', () => {
    expect(computeFirstDiffOffset('abc', 'abcdef')).toBe(3)
    expect(computeFirstDiffOffset('abcdef', 'abc')).toBe(3)
  })
})
