// BUG-139 — coverage for the defensive YAML frontmatter parser.

import { describe, it, expect } from 'vitest'
import {
  parseFrontmatter,
  serializeFrontmatter,
  displayValue
} from './frontmatterParser'

describe('parseFrontmatter', () => {
  it('returns empty + valid on null input', () => {
    const r = parseFrontmatter(null)
    expect(r.valid).toBe(true)
    expect(r.empty).toBe(true)
    expect(r.parsed).toEqual({})
  })

  it('returns empty + valid on whitespace-only input', () => {
    const r = parseFrontmatter('   \n\t  ')
    expect(r.valid).toBe(true)
    expect(r.empty).toBe(true)
    expect(r.parsed).toEqual({})
  })

  it('parses a simple key:value block', () => {
    const r = parseFrontmatter('title: Hello world\npublished: true')
    expect(r.valid).toBe(true)
    expect(r.empty).toBe(false)
    expect(r.parsed).toEqual({ title: 'Hello world', published: true })
  })

  it('preserves numbers + booleans + null', () => {
    const r = parseFrontmatter('count: 42\nactive: true\nnote: null')
    expect(r.parsed).toEqual({ count: 42, active: true, note: null })
  })

  it('parses nested objects + arrays', () => {
    const r = parseFrontmatter('tags:\n  - foo\n  - bar\nmeta:\n  author: dudgeon')
    expect(r.parsed).toEqual({ tags: ['foo', 'bar'], meta: { author: 'dudgeon' } })
  })

  it('returns invalid + error message on malformed YAML', () => {
    const r = parseFrontmatter('title: "unclosed quote')
    expect(r.valid).toBe(false)
    expect(r.parsed).toBeNull()
    expect(r.error.length).toBeGreaterThan(0)
  })

  it('returns invalid when the root is a top-level array (not a mapping)', () => {
    const r = parseFrontmatter('- one\n- two')
    expect(r.valid).toBe(false)
    expect(r.parsed).toBeNull()
    expect(r.error).toContain('mapping')
  })

  it('returns invalid when the root is a bare scalar', () => {
    const r = parseFrontmatter('"just a string"')
    expect(r.valid).toBe(false)
    expect(r.parsed).toBeNull()
  })

  it('handles trailing newlines defensively', () => {
    const r = parseFrontmatter('title: foo\n\n')
    expect(r.valid).toBe(true)
    expect(r.parsed).toEqual({ title: 'foo' })
  })
})

describe('serializeFrontmatter', () => {
  it('returns empty string for an empty record', () => {
    expect(serializeFrontmatter({})).toBe('')
  })

  it('round-trips a simple mapping through parse → serialize', () => {
    const text = 'title: Hello\ncount: 5\n'
    const parsed = parseFrontmatter(text).parsed!
    const reSerialized = serializeFrontmatter(parsed)
    const reParsed = parseFrontmatter(reSerialized).parsed!
    expect(reParsed).toEqual(parsed)
  })

  it('serializes nested values', () => {
    const text = serializeFrontmatter({
      title: 'demo',
      tags: ['a', 'b'],
      meta: { author: 'dudgeon' }
    })
    // Order isn't guaranteed but the lines should all be present.
    expect(text).toContain('title: demo')
    expect(text).toContain('tags:')
    expect(text).toMatch(/-\s+a/)
    expect(text).toMatch(/-\s+b/)
    expect(text).toContain('meta:')
    expect(text).toContain('author: dudgeon')
  })

  it('produces no trailing newline (joinFrontmatter adds one)', () => {
    const text = serializeFrontmatter({ title: 'x' })
    expect(text.endsWith('\n')).toBe(false)
  })
})

describe('displayValue', () => {
  it('shows null/undefined as ∅', () => {
    expect(displayValue(null)).toBe('∅')
  })
  it('shows strings verbatim', () => {
    expect(displayValue('hello')).toBe('hello')
  })
  it('shows booleans + numbers', () => {
    expect(displayValue(true)).toBe('true')
    expect(displayValue(42)).toBe('42')
  })
  it('compacts arrays + objects as JSON', () => {
    expect(displayValue(['a', 'b'])).toBe('["a","b"]')
    expect(displayValue({ x: 1 })).toBe('{"x":1}')
  })
})
