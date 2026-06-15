// FOLLOWUP-050 — trigger matcher for the frontmatter raw-YAML `[[ ]]`
// autocomplete. Parity with the body matcher's rules (suggestionMatchers).

import { describe, it, expect } from 'vitest'
import { findFmWikilinkMatch } from './frontmatterWikilinkMatch'

describe('findFmWikilinkMatch', () => {
  it('matches an open [[query immediately left of the caret', () => {
    const v = 'owner: [[Ali'
    expect(findFmWikilinkMatch(v, v.length)).toEqual({ start: 7, query: 'Ali' })
  })

  it('matches a bare [[ (empty query — files-only list)', () => {
    const v = 'owner: [['
    expect(findFmWikilinkMatch(v, v.length)).toEqual({ start: 7, query: '' })
  })

  it('uses the caret, not end-of-value (mid-line edit)', () => {
    const v = 'a: [[Foo more text'
    // caret right after "Foo"
    expect(findFmWikilinkMatch(v, 8)).toEqual({ start: 3, query: 'Foo' })
  })

  it('returns null when there is no [[', () => {
    expect(findFmWikilinkMatch('owner: Alice', 12)).toBeNull()
  })

  it('rejects a query containing whitespace', () => {
    const v = 'owner: [[Alice P'
    expect(findFmWikilinkMatch(v, v.length)).toBeNull()
  })

  it('rejects a closed / closing wikilink (query has ])', () => {
    const v = 'owner: [[Foo]]'
    expect(findFmWikilinkMatch(v, v.length)).toBeNull()
    // caret just before the closing ]] still has a ] in the query slice
    expect(findFmWikilinkMatch('owner: [[Foo]', 13)).toBeNull()
  })

  it('picks the [[ closest to the caret', () => {
    const v = '[[Done]] and [[Wip'
    expect(findFmWikilinkMatch(v, v.length)).toEqual({ start: 13, query: 'Wip' })
  })

  it('rejects an over-long query (stray [[ far back)', () => {
    const v = '[[' + 'x'.repeat(90)
    expect(findFmWikilinkMatch(v, v.length)).toBeNull()
  })

  it('guards an out-of-range caret', () => {
    expect(findFmWikilinkMatch('[[Foo', -1)).toBeNull()
    expect(findFmWikilinkMatch('[[Foo', 999)).toBeNull()
  })
})
