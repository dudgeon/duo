// Regression coverage for BUG-072 root cause (v0.6.5 Phase 5 walk).
//
// Why this file exists:
//   The owner's BUG-072 smoke walk surfaced a pre-existing canvas
//   bug that masqueraded as a Phase 5 regression. Owner typed
//   `> hello world` expecting a blockquote; what rendered was plain
//   text with NO conversion. DOM inspection (via `duo selection
//   --pane canvas`) revealed the user's caret was inside a `<span>`
//   directly under `<main>` — no `<p>` wrapper. `findBlockAncestor`
//   walked up looking for a block-tag match; the BLOCK_TAGS set was
//   `[P, H1-6, BLOCKQUOTE, PRE, LI, DIV]` — `MAIN` was absent, so
//   the walk fell through all the way to `<body>`. The matcher then
//   tested `body.textContent` (the entire document — every paragraph,
//   every list item, every heading concatenated together) against
//   the trigger regexes. Of course `> ` never matched the whole
//   document text; the trigger silently dropped.
//
//   Fix: add `MAIN`, `ARTICLE`, `SECTION` to BLOCK_TAGS. The boiler-
//   plate uses `<main>`; the other two are defensive for hand-
//   authored / pasted HTML.
//
//   Why `ARTICLE` + `SECTION` even though the boilerplate doesn't
//   use them: users paste HTML from elsewhere all the time. A
//   pasted blog snippet wrapped in `<article>` would have the SAME
//   class of bug. Adding them now costs nothing and pre-empts the
//   future bug report.
//
// Per the owner memory rule "Recurring regressions need durable
// test coverage" — this file is the anchor that prevents a future
// refactor from regressing BLOCK_TAGS to its pre-Phase-5 shape.
//
// `findBlockAncestor` itself isn't directly tested here because it
// requires a Document and the repo's vitest config is Node-only
// (no jsdom). The membership check is the load-bearing assertion;
// the walk logic is a one-liner over the membership set.

import { describe, it, expect } from 'vitest'
import { isBlockTag } from './blockOps'

describe('BLOCK_TAGS membership (BUG-072 regression anchor)', () => {
  describe('section roots — added in v0.6.5 Phase 5', () => {
    // BUG-072 root cause. Without these, `findBlockAncestor` walked
    // past `<main>` (and would-pasted `<article>` / `<section>`)
    // straight to `<body>`, breaking trigger detection for any
    // content typed outside a wrapping `<p>`.
    it('MAIN is a block tag', () => {
      expect(isBlockTag('MAIN')).toBe(true)
    })

    it('ARTICLE is a block tag (defensive — pasted HTML)', () => {
      expect(isBlockTag('ARTICLE')).toBe(true)
    })

    it('SECTION is a block tag (defensive — pasted HTML)', () => {
      expect(isBlockTag('SECTION')).toBe(true)
    })
  })

  describe('established block tags — must keep working', () => {
    // These are the original BLOCK_TAGS members. A regression to the
    // pre-Phase-5 shape would still need to keep these — the test
    // catches accidental wholesale replacements (e.g. someone
    // refactors to a different list shape and drops one).
    it.each([
      'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'BLOCKQUOTE', 'PRE', 'LI', 'DIV'
    ])('%s is a block tag', (tag) => {
      expect(isBlockTag(tag)).toBe(true)
    })
  })

  describe('non-block tags', () => {
    // Defensive negative tests — make sure the set didn't bloat
    // accidentally. Inline tags must NOT count as blocks; otherwise
    // `findBlockAncestor` would stop at the wrong level and break
    // trigger detection in different ways.
    it.each([
      'SPAN', 'A', 'STRONG', 'EM', 'CODE', 'IMG', 'BR', 'INPUT'
    ])('%s is NOT a block tag', (tag) => {
      expect(isBlockTag(tag)).toBe(false)
    })

    it('case sensitivity — lowercase rejected (DOM tagName is uppercase)', () => {
      // `Element.tagName` is uppercase in HTML documents. The set
      // stores uppercase. A lowercase lookup must miss — otherwise
      // we'd silently match nothing because we'd be comparing
      // against the wrong key.
      expect(isBlockTag('main')).toBe(false)
      expect(isBlockTag('p')).toBe(false)
    })

    it('empty string rejected', () => {
      expect(isBlockTag('')).toBe(false)
    })
  })
})
