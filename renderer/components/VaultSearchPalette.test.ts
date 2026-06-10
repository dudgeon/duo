// ENH-208 Phase 2 (D22) — vault-search palette helper tests.
//
// Mirrors TabSearchPalette.test.ts's scope: the pure helpers (per-file
// grouping, excerpt match segmentation, per-file match-index
// computation, home abbreviation) are the pieces worth unit-testing
// without React rendering. The overlay shell (debounce orchestration,
// stale-response guard, focus management) stays covered by smoke
// walks. matchIndexInFile is the load-bearing one: it feeds the
// vaultGotoMatch occurrence contract (the editor jumps to the Nth
// occurrence of the query, not a disk line), so an off-by-one here
// lands the caret on the wrong match.

import { describe, it, expect } from 'vitest'
import {
  groupHitsByFile,
  matchIndexInFile,
  segmentExcerpt,
  abbreviateHome
} from './VaultSearchPalette'
import type { VaultSearchHitDto } from '@shared/host-api'

const hit = (path: string, line: number, excerpt: string): VaultSearchHitDto => ({
  path,
  absPath: '/vault/' + path,
  line,
  excerpt
})

describe('groupHitsByFile (ENH-208 per-file result grouping)', () => {
  it('returns an empty list for no hits', () => {
    expect(groupHitsByFile([])).toEqual([])
  })

  it('groups consecutive same-file hits under one header', () => {
    const hits = [
      hit('inbox/a.md', 2, 'status: active'),
      hit('inbox/a.md', 9, 'still active'),
      hit('notes/b.md', 1, 'active item')
    ]
    const groups = groupHitsByFile(hits)
    expect(groups).toHaveLength(2)
    expect(groups[0].path).toBe('inbox/a.md')
    expect(groups[0].hits).toHaveLength(2)
    expect(groups[1].path).toBe('notes/b.md')
    expect(groups[1].hits).toHaveLength(1)
  })

  it('records each group startIdx as the flat index of its first hit', () => {
    const hits = [
      hit('a.md', 1, 'x'),
      hit('a.md', 2, 'x'),
      hit('b.md', 1, 'x'),
      hit('c.md', 7, 'x')
    ]
    const groups = groupHitsByFile(hits)
    expect(groups.map((g) => g.startIdx)).toEqual([0, 2, 3])
  })

  it('preserves per-file hit order (response order is by line, ascending)', () => {
    const hits = [hit('a.md', 3, 'first'), hit('a.md', 12, 'second')]
    const groups = groupHitsByFile(hits)
    expect(groups[0].hits.map((h) => h.line)).toEqual([3, 12])
  })

  it('groups by adjacency — fine for real responses (path-sorted), and matchIndexInFile does not depend on it', () => {
    // core/vault search returns hits ordered by path then line, so
    // same-file hits are always adjacent. A hypothetical interleaved
    // input produces two groups for the same file — acceptable for
    // display; the goto-match index is computed independently.
    const hits = [hit('a.md', 1, 'x'), hit('b.md', 1, 'x'), hit('a.md', 5, 'x')]
    expect(groupHitsByFile(hits)).toHaveLength(3)
  })
})

describe('matchIndexInFile (ENH-208 goto-match occurrence index)', () => {
  const hits = [
    hit('a.md', 2, 'alpha'), // flat 0 → a.md match 0
    hit('a.md', 8, 'alpha'), // flat 1 → a.md match 1
    hit('b.md', 1, 'alpha'), // flat 2 → b.md match 0
    hit('b.md', 4, 'alpha'), // flat 3 → b.md match 1
    hit('b.md', 9, 'alpha') // flat 4 → b.md match 2
  ]

  it('is 0 for the first hit of each file', () => {
    expect(matchIndexInFile(hits, 0)).toBe(0)
    expect(matchIndexInFile(hits, 2)).toBe(0)
  })

  it('counts only same-file predecessors', () => {
    expect(matchIndexInFile(hits, 1)).toBe(1)
    expect(matchIndexInFile(hits, 3)).toBe(1)
    expect(matchIndexInFile(hits, 4)).toBe(2)
  })

  it('stays correct for an interleaved (non-adjacent) response shape', () => {
    const interleaved = [
      hit('a.md', 1, 'x'), // a.md match 0
      hit('b.md', 1, 'x'), // b.md match 0
      hit('a.md', 5, 'x') // a.md match 1 — counted across the gap
    ]
    expect(matchIndexInFile(interleaved, 2)).toBe(1)
  })
})

describe('segmentExcerpt (ENH-208 excerpt match highlight)', () => {
  it('splits around a mid-string match', () => {
    expect(segmentExcerpt('the quick brown fox', 'quick')).toEqual([
      { text: 'the ', match: false },
      { text: 'quick', match: true },
      { text: ' brown fox', match: false }
    ])
  })

  it('handles a match at the start (no leading segment)', () => {
    expect(segmentExcerpt('quick brown', 'quick')).toEqual([
      { text: 'quick', match: true },
      { text: ' brown', match: false }
    ])
  })

  it('handles a match at the end (no trailing segment)', () => {
    expect(segmentExcerpt('brown quick', 'quick')).toEqual([
      { text: 'brown ', match: false },
      { text: 'quick', match: true }
    ])
  })

  it('matches case-insensitively but preserves the excerpt casing', () => {
    expect(segmentExcerpt('Status: BLOCKED', 'blocked')).toEqual([
      { text: 'Status: ', match: false },
      { text: 'BLOCKED', match: true }
    ])
  })

  it('highlights only the FIRST occurrence', () => {
    expect(segmentExcerpt('foo bar foo', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: ' bar foo', match: false }
    ])
  })

  it('returns one match segment when the query spans the whole excerpt', () => {
    expect(segmentExcerpt('exact', 'exact')).toEqual([{ text: 'exact', match: true }])
  })

  it('degrades to a single non-match segment when the needle is absent', () => {
    // Possible in practice: the excerpt is capped at 200 chars
    // upstream, so a match past the cap is invisible in the excerpt.
    expect(segmentExcerpt('truncated line', 'elsewhere')).toEqual([
      { text: 'truncated line', match: false }
    ])
  })

  it('returns the excerpt untouched for an empty query', () => {
    expect(segmentExcerpt('anything', '')).toEqual([{ text: 'anything', match: false }])
  })
})

describe('abbreviateHome (ENH-208 footer vault label)', () => {
  it('abbreviates a path under home', () => {
    expect(abbreviateHome('/Users/g/vault', '/Users/g')).toBe('~/vault')
  })

  it('abbreviates home itself to ~', () => {
    expect(abbreviateHome('/Users/g', '/Users/g')).toBe('~')
  })

  it('does not abbreviate a sibling that merely shares the prefix string', () => {
    // '/Users/gg' starts with '/Users/g' as a string but is NOT under
    // that home dir — the separator check prevents the false positive.
    expect(abbreviateHome('/Users/gg/vault', '/Users/g')).toBe('/Users/gg/vault')
  })

  it('leaves paths outside home untouched', () => {
    expect(abbreviateHome('/tmp/vault', '/Users/g')).toBe('/tmp/vault')
  })

  it('passes through unchanged when home is empty', () => {
    expect(abbreviateHome('/Users/g/vault', '')).toBe('/Users/g/vault')
  })
})
