// ENH-195 — tests for the pure plainReplace operation (literal,
// non-CriticMarkup surgical replace for `duo doc edit`).

import { describe, it, expect } from 'vitest'
import { plainReplace } from './plainEdit'

describe('plainReplace — empty find', () => {
  it('refuses an empty find string', () => {
    const result = plainReplace('some text', '', 'x')
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.reason).toBe('find text is empty')
    expect(result.body).toBe('some text')
  })
})

describe('plainReplace — not found', () => {
  it('returns changed=false when find is absent', () => {
    const result = plainReplace('hello world', 'missing', 'x')
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.reason).toBe('find text not found')
    expect(result.body).toBe('hello world')
  })
})

describe('plainReplace — single match', () => {
  it('replaces the only occurrence with no flags', () => {
    const result = plainReplace('the quick fox', 'quick', 'slow')
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.reason).toBe('')
    expect(result.body).toBe('the slow fox')
  })

  it('does NOT wrap the replacement in CriticMarkup tokens', () => {
    const result = plainReplace('use the wrong word', 'wrong', 'correct')
    expect(result.body).toBe('use the correct word')
    expect(result.body).not.toContain('{~~')
    expect(result.body).not.toContain('~>')
  })
})

describe('plainReplace — ambiguous (>1, no flag)', () => {
  it('refuses when more than one match and neither flag is set', () => {
    const result = plainReplace('foo bar foo bar foo', 'foo', 'x')
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.reason).toBe('ambiguous: 3 matches — pass --occurrence N or --all')
    expect(result.body).toBe('foo bar foo bar foo')
  })
})

describe('plainReplace — all', () => {
  it('replaces every occurrence and reports the count', () => {
    const result = plainReplace('foo bar foo bar foo', 'foo', 'x', { all: true })
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(3)
    expect(result.body).toBe('x bar x bar x')
  })

  it('all takes precedence over occurrence', () => {
    const result = plainReplace('a a a', 'a', 'b', { all: true, occurrence: 2 })
    expect(result.replacements).toBe(3)
    expect(result.body).toBe('b b b')
  })
})

describe('plainReplace — occurrence', () => {
  it('replaces only the Nth (1-indexed) match', () => {
    const result = plainReplace('foo foo foo', 'foo', 'bar', { occurrence: 2 })
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.body).toBe('foo bar foo')
  })

  it('occurrence 1 replaces the first match', () => {
    const result = plainReplace('one two one two', 'one', 'X', { occurrence: 1 })
    expect(result.body).toBe('X two one two')
  })

  it('refuses when occurrence is out of range', () => {
    const result = plainReplace('foo foo', 'foo', 'bar', { occurrence: 5 })
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.reason).toBe('occurrence 5 of 2 not found')
    expect(result.body).toBe('foo foo')
  })

  it('refuses a zero / negative occurrence', () => {
    const result = plainReplace('foo foo', 'foo', 'bar', { occurrence: 0 })
    expect(result.changed).toBe(false)
    expect(result.reason).toBe('occurrence 0 of 2 not found')
  })
})

describe('plainReplace — atLine scoping', () => {
  it('replaces only within the targeted line', () => {
    const body = 'foo here\nfoo there\nfoo everywhere'
    const result = plainReplace(body, 'foo', 'bar', { atLine: 2 })
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.body).toBe('foo here\nbar there\nfoo everywhere')
  })

  it('reconstructs the body preserving other lines exactly', () => {
    const body = 'line 1\nline 2\nline 3'
    const result = plainReplace(body, 'line 2', 'CHANGED', { atLine: 2 })
    expect(result.body).toBe('line 1\nCHANGED\nline 3')
  })

  it('counts matches only within the scoped line for ambiguity', () => {
    // 'x' appears on multiple lines, but line 1 has exactly one — so a
    // line-scoped replace with no flag succeeds rather than being
    // flagged ambiguous against the whole-body count.
    const body = 'x once\nx twice x'
    const result = plainReplace(body, 'x', 'Y', { atLine: 1 })
    expect(result.changed).toBe(true)
    expect(result.body).toBe('Y once\nx twice x')
  })

  it('respects --all within a single line', () => {
    const body = 'keep\nfoo foo foo\nkeep'
    const result = plainReplace(body, 'foo', 'bar', { atLine: 2, all: true })
    expect(result.replacements).toBe(3)
    expect(result.body).toBe('keep\nbar bar bar\nkeep')
  })

  it('refuses an out-of-range line with a count of the lines', () => {
    const body = 'line 1\nline 2'
    const result = plainReplace(body, 'line', 'x', { atLine: 9 })
    expect(result.changed).toBe(false)
    expect(result.replacements).toBe(0)
    expect(result.reason).toBe('line 9 out of range (2 lines)')
    expect(result.body).toBe(body)
  })

  it('reports not-found when the line exists but lacks the find text', () => {
    const body = 'alpha\nbeta\ngamma'
    const result = plainReplace(body, 'missing', 'x', { atLine: 2 })
    expect(result.changed).toBe(false)
    expect(result.reason).toBe('find text not found')
  })
})

describe('plainReplace — deletion (empty replace)', () => {
  it('deletes the matched text when replace is empty', () => {
    const result = plainReplace('remove this word', 'this ', '')
    expect(result.changed).toBe(true)
    expect(result.replacements).toBe(1)
    expect(result.body).toBe('remove word')
  })

  it('deletes every occurrence with --all', () => {
    const result = plainReplace('a-b-c-d', '-', '', { all: true })
    expect(result.replacements).toBe(3)
    expect(result.body).toBe('abcd')
  })

  it('deletes the Nth occurrence with --occurrence', () => {
    const result = plainReplace('x.x.x', '.', '', { occurrence: 2 })
    expect(result.body).toBe('x.xx')
  })
})
