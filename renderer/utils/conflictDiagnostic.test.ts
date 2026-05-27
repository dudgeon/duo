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

describe('normalizeForEchoCompare — BUG-155 (tiptap autolink round-trip)', () => {
  it('cancels [X](http://X) → X — the exact about-duo.md repro', () => {
    // 2026-05-23 owner repro: disk has bare `prd.md`, baseline has
    // `[prd.md](http://prd.md)` (tiptap autolinker added the link form
    // on parse). 17-char divergence → false-positive conflict banner.
    const disk = 'see prd.md for details'
    const baseline = 'see [prd.md](http://prd.md) for details'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('cancels https://-scheme autolinks too', () => {
    const disk = 'visit example.com'
    const baseline = 'visit [example.com](https://example.com)'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('cancels autolinks with path segments', () => {
    const disk = 'reference docs.duo.dev/api'
    const baseline = 'reference [docs.duo.dev/api](http://docs.duo.dev/api)'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })

  it('PRESERVES links where display text differs from URL (real intent)', () => {
    const text = '[Click here](http://example.com)'
    // Should NOT collapse to "Click here" — preserving the link form
    // is correct because it represents real authoring intent.
    expect(normalizeForEchoCompare(text)).toBe(text)
  })

  it('PRESERVES links where URL has subdomain not in display text', () => {
    const text = '[example.com](http://www.example.com)'
    // Different domains — preserve.
    expect(normalizeForEchoCompare(text)).toBe(text)
  })

  it('combined: HTML-entity + autolink round-trip', () => {
    const disk = 'see <prd.md>'
    const baseline = 'see &lt;[prd.md](http://prd.md)&gt;'
    expect(normalizeForEchoCompare(disk)).toBe(normalizeForEchoCompare(baseline))
  })
})

// BUG-161 — regression coverage for the 2026-05-26 byte-exact-ref fix
// (the `lastSeenDiskBodyRef` companion to `lastSavedBodyRef` in
// `MarkdownEditor.tsx`). The cases below are the TipTap-markdown
// round-trip patterns that `normalizeForEchoCompare` does NOT cancel —
// i.e. the gaps that previously fired false-positive save-pre-reconcile
// banners on first-save-after-load. They're documented here so a future
// "let me widen normalize again" PR runs the contract first and sees
// that these are NOT supposed to normalize-equal: the right answer for
// the save-pre-reconcile path is the byte-exact ref check, not yet
// another regex. (The watcher / save paths in MarkdownEditor.tsx
// answer the "did disk drift externally?" question via byte-exact
// comparison against `lastSeenDiskBodyRef`; the normalize is only a
// fallback for content-preserving touches.)
describe('normalizeForEchoCompare — gaps that motivated the byte-exact fast-path', () => {
  it('does NOT cancel `****X**` → `\\*\\***X**` (tiptap escapes leading **** before bold)', () => {
    // tasks.md 2026-05-26 repro pattern: `> ****Reading guide.**` on disk
    // becomes `> \*\***Reading guide.**` after tiptap parse + serialize.
    // 6 chars vs 8 chars; normalize step doesn't touch backslash-escape.
    const disk = '> ****Reading guide.**'
    const baseline = '> \\*\\***Reading guide.**'
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
  })

  it('does NOT cancel relative-path autolinks ([X](X) where X is not http://)', () => {
    // Real tasks.md content: `[docs/prd/foo.md](docs/prd/foo.md)` on disk
    // becomes `` `docs/prd/foo.md` `` after tiptap (the autolinker only
    // owns the http(s):// form, but the markdown emitter strips the
    // bracket form when text == url and there's no scheme).
    const disk = '[docs/prd/foo.md](docs/prd/foo.md)'
    const baseline = '`docs/prd/foo.md`'
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
  })

  it('does NOT cancel paragraph-break insertion mid-list', () => {
    // Pattern seen in tasks.md walk: a single-paragraph list item
    // continues across a soft-break that tiptap inflates into a `\n\n`
    // (creating two paragraphs). The soft-break normalize collapses
    // `\n` between non-blank lines to space — but only when there's
    // no blank line between them. The reverse (` ` → `\n\n`) isn't
    // covered, and shouldn't be: a real paragraph break carries
    // meaning that a space doesn't.
    const disk = '- item continues here naturally'
    const baseline = '- item continues\n\nhere naturally'
    expect(normalizeForEchoCompare(disk)).not.toBe(normalizeForEchoCompare(baseline))
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
