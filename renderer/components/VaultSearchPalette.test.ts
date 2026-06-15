// ENH-208 Phase 2 (D22) — vault-search palette helper tests.
//
// Mirrors TabSearchPalette.test.ts's scope: the pure helpers (per-file
// grouping, excerpt match segmentation) are the pieces worth
// unit-testing without React rendering. (Home abbreviation moved to
// shared/path-display.ts — tested there — when the Settings → Default
// Vault menu labels started sharing it.) The overlay shell
// (debounce orchestration, stale-response guard, focus management)
// stays covered by smoke walks. The goto-match occurrence index is NOT
// computed here anymore — core/vault search emits docMatchIndex per
// hit (see core/vault/search.test.ts), computed where the raw text and
// frontmatter extent are known, so palette and editor count the same
// thing.

import { describe, it, expect } from 'vitest'
import { groupHitsByFile, segmentExcerpt } from './VaultSearchPalette'
import type { VaultSearchHitDto } from '@shared/host-api'

const hit = (path: string, line: number, excerpt: string): VaultSearchHitDto => ({
  path,
  absPath: '/vault/' + path,
  line,
  excerpt,
  docMatchIndex: 0,
  isTemplate: path.split('/').includes('templates')
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

  it('groups by adjacency — fine for real responses (path-sorted)', () => {
    // core/vault search returns hits ordered by path then line, so
    // same-file hits are always adjacent. A hypothetical interleaved
    // input produces two groups for the same file — acceptable for
    // display; the goto-match index rides each hit (docMatchIndex)
    // so grouping shape can't corrupt it.
    const hits = [hit('a.md', 1, 'x'), hit('b.md', 1, 'x'), hit('a.md', 5, 'x')]
    expect(groupHitsByFile(hits)).toHaveLength(3)
  })

  it('flags a templates/ group as isTemplate (ENH-214)', () => {
    const groups = groupHitsByFile([
      hit('templates/person.md', 3, 'type: person'),
      hit('people/alice.md', 1, 'type: person')
    ])
    expect(groups[0].isTemplate).toBe(true)
    expect(groups[1].isTemplate).toBe(false)
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
