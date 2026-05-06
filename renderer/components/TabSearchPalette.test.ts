// ENH-080 — Tab-search palette scoring tests.
//
// The scoring function is the only stateful piece of the palette
// component that's worth unit-testing without React rendering. The
// rest (event listeners, focus management, useEffect orchestration)
// is more naturally covered by smoke walks.

import { describe, it, expect } from 'vitest'
import { scoreEntry, type TabSearchEntry } from './TabSearchPalette'

const entry = (title: string, subtitle?: string): TabSearchEntry => ({
  id: 'f:test',
  title,
  subtitle,
  kind: 'editor'
})

describe('scoreEntry (ENH-080 tab-search ranking)', () => {
  it('returns 0 for an empty query (all entries pass through)', () => {
    expect(scoreEntry(entry('foo.md'), '')).toBe(0)
  })

  it('returns -1 when neither title nor subtitle contain the query', () => {
    expect(scoreEntry(entry('foo.md', '/path/to/foo.md'), 'xyz')).toBe(-1)
  })

  it('exact title match scores highest', () => {
    expect(scoreEntry(entry('foo.md'), 'foo.md')).toBe(1000)
  })

  it('title prefix match scores 500', () => {
    expect(scoreEntry(entry('foobar.md'), 'foo')).toBe(500)
  })

  it('title contains match scores by position (earlier = higher)', () => {
    // "bar" in "foobar.md" starts at index 3 → 200 - 3 = 197
    expect(scoreEntry(entry('foobar.md'), 'bar')).toBe(197)
    // "bar" in "xfoobar.md" starts at index 4 → 200 - 4 = 196
    expect(scoreEntry(entry('xfoobar.md'), 'bar')).toBe(196)
  })

  it('subtitle contains match scores below title contains', () => {
    // No title match; subtitle has "foo" at index 6
    const e = entry('readme.md', '/path/foo/readme.md')
    expect(scoreEntry(e, 'foo')).toBe(50 - 6)
  })

  it('case-insensitive on both title and subtitle', () => {
    expect(scoreEntry(entry('FOO.MD'), 'foo')).toBe(500)
    expect(scoreEntry(entry('readme.md', '/PATH/FOO'), 'foo')).toBe(50 - 6)
  })

  it('ranking: title prefix beats title contains beats subtitle contains', () => {
    const prefix = entry('foobar.md', '/other')
    const contains = entry('xfoobar.md', '/other')
    const subOnly = entry('readme.md', '/foo/path')
    const q = 'foo'
    expect(scoreEntry(prefix, q)).toBeGreaterThan(scoreEntry(contains, q))
    expect(scoreEntry(contains, q)).toBeGreaterThan(scoreEntry(subOnly, q))
    expect(scoreEntry(subOnly, q)).toBeGreaterThan(-1)
  })

  it('handles entries without subtitle', () => {
    expect(scoreEntry(entry('foo.md'), 'foo')).toBe(500)
    expect(scoreEntry(entry('foo.md'), 'xyz')).toBe(-1)
  })
})
